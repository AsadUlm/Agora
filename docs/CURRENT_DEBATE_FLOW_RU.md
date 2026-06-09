# Как сейчас устроены раунды и выполнение дебата в AGORA

Дата актуализации: 9 июня 2026 года

## 1. Короткий ответ

Новый дебат в AGORA состоит из **5 основных стадий**:

1. `Stage 1: Initial Positions`
2. `Stage 2: Cross-Critiques`
3. `Stage 3: Responses to Critiques`
4. `Stage 4: Revised Positions`
5. `Stage 5: Final Synthesis`

После завершения основного дебата пользователь может задавать follow-up вопросы. Каждый follow-up добавляет еще **3 раунда**:

1. Follow-up Response
2. Follow-up Critique
3. Updated Synthesis

Таким образом:

```text
Количество раундов = 5 + 3 × количество follow-up вопросов
```

Примеры:

| Сценарий | Всего записей Round |
|---|---:|
| Новый дебат без follow-up | 5 |
| Новый дебат + 1 follow-up | 8 |
| Новый дебат + 2 follow-up | 11 |
| Новый дебат + 3 follow-up | 14 |

В backend сущность по-прежнему называется `Round`, поэтому термины `Stage` и `Round` относятся к одной записи базы. Для основного цикла в пользовательском интерфейсе используется слово `Stage`, чтобы ясно показывать пятистадийную модель.

---

## 2. Основные сущности

### ChatSession

`ChatSession` представляет всю дискуссию:

- тему;
- выбранных агентов;
- прикрепленные документы;
- основной дебат;
- follow-up вопросы.

### ChatTurn

`ChatTurn` представляет один исполняемый debate lifecycle.

Сейчас основной дебат и его follow-up циклы прикрепляются к одному `ChatTurn`. При запуске follow-up тот же turn временно снова переводится в `queued`, затем в `running`, а после завершения возвращается в terminal status.

Основные статусы turn:

```text
queued
running
partially_completed
completed
failed
cancelled
```

Дополнительно отдельно хранится статус synthesis:

```text
pending
running
completed
failed
skipped
```

### Round

Каждая стадия сохраняется как отдельная запись `Round`.

У нее есть:

- `round_number` — сквозной номер внутри turn;
- `cycle_number` — номер цикла;
- `round_type` — семантический тип стадии;
- `status` — состояние выполнения;
- связанные сообщения агентов;
- связанные записи LLM-вызовов.

Статусы round:

```text
queued
running
partially_completed
completed
failed
```

### Message

Каждый результат агента сохраняется как `Message`.

Основные типы:

```text
user_input
agent_response
critique
final_summary
system_notice
```

Финальный verdict модератора тоже сохраняется как `final_summary`, но имеет:

```text
sender_type = judge
chat_agent_id = null
payload.message_type = synthesis_verdict
payload.agent_role = moderator
```

---

## 3. Что происходит при старте дебата

Frontend отправляет:

```http
POST /debates/start
```

В запросе находятся:

- вопрос пользователя;
- список агентов;
- модели и настройки агентов;
- режим выполнения `auto` или `manual`;
- документы, назначенные агентам.

Backend выполняет следующие шаги:

1. Проверяет, что указан хотя бы один агент.
2. Проверяет тему через Topic Guard.
3. Создает или переиспользует `ChatSession`.
4. Создает активных `ChatAgent`.
5. Создает связи агентов с документами.
6. Создает `ChatTurn` со статусом `queued`.
7. Сохраняет вопрос пользователя как `Message` с `sequence_no=0`.
8. Делает commit.
9. Запускает `ChatEngine` в background task.
10. Немедленно возвращает frontend идентификаторы debate/turn и WebSocket URL.

То есть HTTP-запрос старта не ждет завершения всех пяти стадий.

---

## 4. Кто управляет выполнением

### ChatEngine

`ChatEngine` управляет полным основным циклом:

```text
load turn
  -> build TurnContext
  -> turn = running
  -> Stage 1
  -> Stage 2
  -> Stage 3
  -> Stage 4
  -> Stage 5
  -> turn = completed / partially_completed / failed
```

`TurnContext` содержит:

- вопрос;
- session и turn identifiers;
- активных агентов;
- роль, модель, provider и temperature каждого агента;
- reasoning style/depth;
- knowledge mode;
- назначенные документы;
- состояние RAG.

### RoundManager

`RoundManager` выполняет конкретную стадию:

1. Создает `Round`.
2. Переводит его из `queued` в `running`.
3. Создает task plan для каждого агента.
4. Запускает агентов параллельно с ограничением concurrency.
5. Для каждого агента получает RAG-контекст.
6. Строит prompt.
7. Вызывает LLM.
8. Нормализует и проверяет результат.
9. Сохраняет `LLMCall` и `Message`.
10. Отправляет WebSocket события.
11. Вычисляет итоговый статус round.

---

## 5. Параллельность агентов

Внутри одной стадии агенты обычно выполняются параллельно.

```text
Stage N
 ├─ Agent A task
 ├─ Agent B task
 ├─ Agent C task
 └─ Agent D task
```

Максимальная параллельность задается:

```env
LLM_MAX_CONCURRENT_AGENT_CALLS=3
```

Фактическая параллельность:

```text
min(количество агентов, LLM_MAX_CONCURRENT_AGENT_CALLS)
```

Например, при четырех агентах и лимите `3`:

1. первые три агента запускаются одновременно;
2. четвертый начинает работу после освобождения одного слота.

Между основными стадиями порядок последовательный:

```text
Stage 2 не стартует до завершения Stage 1.
Stage 3 не стартует до завершения Stage 2.
Stage 4 не стартует до завершения Stage 3.
Stage 5 не стартует до завершения Stage 4.
```

В режиме `manual` concurrency принудительно равен `1`, и каждый следующий agent task ожидает команды `/next-step`.

---

## 6. Stage 1: Initial Positions

Тип в базе:

```text
round_number = 1
cycle_number = 1
round_type = initial
```

Каждый агент получает:

- исходный вопрос;
- собственную роль/persona;
- reasoning style/depth;
- доступный RAG-контекст;
- инструкцию сформировать самостоятельную начальную позицию.

Агенты не видят позиции друг друга на этой стадии.

Цель:

- получить независимые точки зрения;
- не допустить преждевременного консенсуса;
- зафиксировать исходную позицию каждого агента.

Каждый успешный агент создает одно сообщение типа:

```text
sender_type = agent
message_type = agent_response
```

Результаты Stage 1 передаются в Stage 2, Stage 3, Stage 4 и Stage 5.

---

## 7. Stage 2: Cross-Critiques

Тип в базе:

```text
round_number = 2
cycle_number = 1
round_type = critique
```

Каждый агент получает:

- собственную исходную позицию;
- все успешные позиции остальных агентов;
- вопрос;
- RAG-контекст;
- инструкцию найти конкретную слабость.

Важно: backend не выбирает одну цель критики жестко. В prompt передается список всех успешных оппонентов, после чего модель формирует critique и указывает `target_agent`.

Ожидаемое содержание:

- какой тезис атакуется;
- какая скрытая предпосылка найдена;
- где аргумент может сломаться;
- контраргумент;
- конкретный target agent.

Если успешных оппонентов нет, агент не вызывает LLM для обычной peer critique, а получает сохраненный `skipped`-результат с критикой общей позиции.

Пограничный случай с одним агентом: peer opponent отсутствует, поэтому Stage 2 сохраняет `skipped` critique. При этом pipeline продолжает следующие стадии.

Сообщение:

```text
message_type = critique
```

---

## 8. Stage 3: Responses to Critiques

Тип в базе:

```text
round_number = 3
cycle_number = 1
round_type = critique_response
```

Backend группирует успешные критики Stage 2 по полю `target_agent`.

Для каждого агента формируется список критик, направленных на его роль:

```text
target_agent == agent.role
```

Агент получает:

- собственную исходную позицию;
- критики, направленные на него;
- автора каждой критики;
- атакованный тезис;
- найденную слабость;
- контраргумент.

Агент должен:

- явно принять или отклонить конкретные замечания;
- объяснить причины;
- описать план изменения позиции.

Результат Stage 3 используется в Stage 4.

---

## 9. Stage 4: Revised Positions

Тип в базе:

```text
round_number = 4
cycle_number = 1
round_type = revised_position
```

Каждый агент получает:

- свою исходную позицию Stage 1;
- исходные ключевые тезисы;
- критики Stage 2;
- собственный ответ на критику Stage 3.

Цель Stage 4:

- зафиксировать реальное изменение позиции;
- либо явно доказать, почему позиция не изменилась;
- сформировать итоговую позицию агента после дебата.

Главные поля:

```text
revised_position
change_summary
changed
change_type
reason_for_change
key_claims
remaining_uncertainties
```

Именно Stage 4 дает возможность сравнивать:

```text
позиция до критики -> критика -> ответ -> позиция после критики
```

---

## 10. Stage 5: Final Synthesis

Тип в базе:

```text
round_number = 5
cycle_number = 1
round_type = final
```

Stage 5 состоит из **двух разных подфаз**.

### Подфаза A: synthesis каждого агента

Каждый агент получает общий digest, построенный из:

- исходного вопроса;
- успешных позиций Stage 1;
- успешных критик Stage 2;
- пересмотренных позиций Stage 4.

Пересмотренные позиции Stage 4 являются главным входом для финального ответа.

Каждый агент формирует собственный final synthesis:

```text
message_type = final_summary
sender_type = agent
```

### Подфаза B: единый moderator verdict

После agent syntheses выполняется еще один отдельный LLM-вызов специального модератора.

Модель модератора задается независимо:

```env
MODERATOR_PROVIDER
MODERATOR_MODEL
MODERATOR_TEMPERATURE
MODERATOR_MAX_TOKENS
```

Модератор получает успешные финальные syntheses агентов и формирует единый пользовательский ответ.

Он сохраняется как judge message:

```text
sender_type = judge
message_type = final_summary
agent_role = moderator
message_type discriminator = synthesis_verdict
```

Именно этот moderator verdict является общим итогом дебата.

---

## 11. Сколько создается LLM-вызовов и сообщений

Пусть:

```text
N = количество агентов
F = количество follow-up вопросов
```

### Основной дебат

При успешном выполнении без retry:

```text
Stage 1: N вызовов
Stage 2: N вызовов
Stage 3: N вызовов
Stage 4: N вызовов
Stage 5 agent syntheses: N вызовов
Moderator verdict: 1 вызов
```

Итого:

```text
5N + 1 LLM-вызов
```

Примеры:

| Агенты | Обычные LLM-вызовы |
|---:|---:|
| 1 | 6 |
| 2 | 11 |
| 3 | 16 |
| 4 | 21 |

Количество сохраняемых сообщений основного дебата:

```text
1 user question + 5N agent messages + 1 judge verdict
```

Например, для трех агентов:

```text
1 + 15 + 1 = 17 сообщений
```

### Почему фактических LLM-вызовов иногда больше

Один agent task может выполнить дополнительные вызовы:

- повтор при пустом ответе;
- восстановление невалидного JSON;
- повтор при утечке prompt/schema;
- строгий structured-output retry;
- JSON repair через moderator model.

Поэтому `5N + 1` — нормальный минимальный сценарий, а не жесткий максимум.

---

## 12. RAG и документы

Перед каждым agent LLM-вызовом backend пытается получить документы, релевантные вопросу.

Используются:

- `knowledge_mode`;
- документы, назначенные агенту;
- роль агента;
- retrieval strategy;
- до трех chunks (`RETRIEVAL_TOP_K = 3`);
- evidence packets с citation labels.

Если документов нет, дебат продолжается в reasoning-only режиме. Это не считается ошибкой.

Если документы назначены, но релевантные chunks не найдены, backend пишет предупреждение, но также продолжает выполнение.

Moderator verdict работает по успешным agent syntheses и определяет наличие evidence по payload агентов.

---

## 13. Проверка и нормализация ответов

После ответа модели backend не сохраняет его вслепую.

Для каждого ответа выполняются:

1. JSON parsing.
2. Нормализация полей под тип стадии.
3. Создание readable `display_content`.
4. Проверка prompt/schema leakage.
5. Проверка обязательных structured fields.
6. При необходимости recovery/retry.
7. Сохранение результата или structured failure.

Если результат не удалось восстановить, конкретный агент получает:

```text
generation_status = failed
```

Его некорректный ответ не должен использоваться как нормальный вход следующих стадий.

---

## 14. Частичные и полные ошибки

### Один агент упал, остальные успешны

Дебат продолжается.

Статус текущей стадии:

```text
partially_completed
```

Успешные сообщения сохраняются и передаются дальше.

### Все агенты упали на обязательной Stage 1-4

Текущая стадия:

```text
failed
```

Turn:

```text
failed
```

Следующие стадии не запускаются.

### Agent syntheses Stage 5 существуют, но moderator verdict упал

Stage 5:

```text
partially_completed
```

Turn:

```text
partially_completed
```

Synthesis:

```text
failed
```

Ответы агентов и граф сохраняются. UI показывает предупреждение, а не общий fatal error.

### Все agent syntheses Stage 5 упали

Turn также получает `partially_completed`, потому что Stages 1-4 уже содержат полезные результаты.

### Закрылся WebSocket

Закрытие stream не изменяет backend status.

Frontend:

1. показывает `Connection interrupted. Checking saved status…`;
2. один раз загружает REST snapshot;
3. показывает fatal failure только если backend действительно сохранил `failed`.

---

## 15. WebSocket события

Во время выполнения frontend получает события:

```text
turn_started
round_started
agent_started
message_created
round_completed
round_failed
turn_completed
turn_partially_completed
turn_failed
```

Событие `message_created` отправляется после commit сообщения агента. Поэтому frontend может постепенно строить граф, не дожидаясь завершения всей стадии.

REST snapshot остается источником сохраненного состояния и используется для reconciliation после потери stream.

---

## 16. Auto и Manual режимы

### Auto

Backend самостоятельно выполняет все пять стадий. Агенты внутри стадии работают параллельно в рамках concurrency limit.

### Manual

Перед каждым agent task backend ожидает разрешение StepController.

Команда:

```http
POST /debates/{debate_id}/next-step
```

В manual режиме concurrency принудительно равен `1`, чтобы шаги выполнялись предсказуемо.

Важно: manual mode управляет реальным backend-выполнением. Отдельно frontend имеет visual playback, который управляет только моментом показа уже сохраненных узлов.

---

## 17. Как работают follow-up циклы

После завершения основного дебата пользователь может отправить:

```http
POST /debates/{debate_id}/follow-ups
```

Follow-up:

- не создает новый `ChatTurn`;
- создает `DebateFollowUp`;
- сохраняет follow-up вопрос в `DebateFollowUp.question`, а не как новый `user_input` message;
- увеличивает `cycle_number`;
- добавляет три новых `Round` к существующему turn;
- использует память предыдущего дебата.

### Нумерация

После пяти основных стадий первый follow-up получает:

```text
Round 6: followup_response
Round 7: followup_critique
Round 8: updated_synthesis
```

Второй follow-up:

```text
Round 9: followup_response
Round 10: followup_critique
Round 11: updated_synthesis
```

Номер вычисляется как:

```text
existing_max_round + 1
existing_max_round + 2
existing_max_round + 3
```

### Память follow-up

Перед циклом backend строит `DebateMemory`:

- исходный вопрос;
- предыдущий synthesis;
- consensus;
- main conflict;
- strongest arguments;
- unresolved questions;
- последние позиции агентов;
- compact summaries предыдущих follow-up циклов;
- история изменения итоговой позиции;
- использованные и спорные evidence.

Это позволяет продолжать дебат, а не начинать его заново.

---

## 18. Три раунда follow-up

### Follow-up Response

Каждый агент отвечает на новый вопрос с учетом:

- исходной темы;
- предыдущего synthesis;
- своей последней позиции;
- предыдущих cycle summaries;
- evidence memory.

### Follow-up Critique

Агенты критикуют follow-up ответы друг друга.

Есть оптимизация streaming overlap:

1. follow-up response запускается для всех агентов;
2. как только готовы минимум два успешных ответа, начинается follow-up critique;
3. оставшиеся response tasks продолжают выполняться параллельно;
4. перед updated synthesis backend дожидается завершения обоих наборов.

Для одного агента threshold автоматически уменьшается до одного.

### Updated Synthesis

Каждый агент получает:

- все успешные follow-up ответы;
- все успешные follow-up critiques;
- предыдущий synthesis;
- debate memory.

После agent updated syntheses снова вызывается отдельный moderator verdict.

После завершения сохраняется compact `cycle_summary`, который используется следующим follow-up циклом.

---

## 19. Количество вызовов с follow-up

Один обычный follow-up цикл требует:

```text
N follow-up responses
+ N follow-up critiques
+ N updated syntheses
+ 1 moderator verdict
= 3N + 1 LLM-вызов
```

Общая формула:

```text
Основной дебат + F follow-ups
= (5N + 1) + F × (3N + 1)
```

Пример для трех агентов и двух follow-up:

```text
Основной дебат: 5 × 3 + 1 = 16
Follow-up 1:   3 × 3 + 1 = 10
Follow-up 2:   3 × 3 + 1 = 10
Итого: 36 обычных LLM-вызовов
```

Recovery и retry могут увеличить фактическое число.

---

## 20. Полная схема

```text
POST /debates/start
  |
  v
Topic Guard
  |
  v
Create Session + Agents + Turn + User Message
  |
  v
Turn: queued -> running
  |
  v
Stage 1: Initial Positions
  |  N agent calls in parallel
  v
Stage 2: Cross-Critiques
  |  N agent calls in parallel
  v
Stage 3: Responses to Critiques
  |  N agent calls in parallel
  v
Stage 4: Revised Positions
  |  N agent calls in parallel
  v
Stage 5A: Agent Final Syntheses
  |  N agent calls in parallel
  v
Stage 5B: Moderator Verdict
  |  1 moderator call
  v
Turn: completed / partially_completed / failed
  |
  +------ optional follow-up ------+
  |                                |
  v                                |
Follow-up Response                 |
  |                                |
  v                                |
Follow-up Critique                 |
  |                                |
  v                                |
Updated Syntheses                  |
  |                                |
  v                                |
Moderator Updated Verdict          |
  |                                |
  +--------------------------------+
```

---

## 21. Важные технические замечания

1. В некоторых старых docstrings и комментариях еще встречается формулировка `3-round debate`. Это устаревшие комментарии. Фактический основной pipeline в `ChatEngine` выполняет пять стадий.
2. Старый метод `execute_round_3()` для трехраундовой модели все еще существует для совместимости, но новый основной `ChatEngine` его не вызывает.
3. Первый follow-up фактически использует номера `6/7/8`, а не `4/5/6`, потому что основной pipeline уже занимает номера `1-5`.
4. `Stage 5` — это не только moderator verdict. Сначала каждый агент создает свой final synthesis, затем модератор объединяет успешные syntheses.
5. `partially_completed` означает, что результат неполный, но полезные данные сохранены и должны оставаться видимыми.

---

## 22. Основные файлы реализации

```text
server/app/api/routes/debate.py
server/app/services/chat_engine.py
server/app/services/debate_engine/round_manager.py
server/app/services/followup_runner.py
server/app/services/debate_engine/debate_memory.py
server/app/services/debate_engine/response_normalizer.py
server/app/services/debate_engine/quality_guards.py
server/app/models/chat_turn.py
server/app/models/round.py
server/app/models/message.py
server/app/models/debate_follow_up.py
```

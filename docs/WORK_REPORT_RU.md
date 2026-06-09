# Отчет: исправление lifecycle и синхронизации состояния дебатов

Дата: 9 июня 2026 года  
Проект: AGORA

## Итог

Исправлена модель частичного завершения дебата, согласование REST/stream-состояния и отображение статуса во frontend. Пятистадийный pipeline не рефакторился, новые UX-панели и промпты не добавлялись.

Теперь сбой финального синтеза после сохраненных ответов агентов не уничтожает полезный результат и не переводит весь дебат в `failed`. Turn получает `partially_completed`, граф сохраняется, а интерфейс показывает:

> Final synthesis failed. Agent responses are available. Retry synthesis.

Закрытие WebSocket само по себе также больше не считается фатальной ошибкой: frontend показывает `Connection interrupted. Checking saved status…`, один раз загружает REST snapshot и принимает fatal-состояние только после подтверждения backend.

## Root cause

Проблема состояла из четырех связанных причин:

1. Backend имел только terminal-статусы `completed` и `failed`, поэтому поздний сбой финального синтеза ошибочно обнулял смысл уже сохраненных результатов агентов.
2. Ошибки не содержали достаточного lifecycle-контекста: frontend не знал, какая фаза упала, доступны ли частичные результаты и можно ли повторить операцию.
3. Banner, badge, timeline, graph, overview и progress независимо интерпретировали REST status, WebSocket events и локальные overrides.
4. Закрытие stream могло восприниматься как доказательство сбоя генерации, хотя backend продолжал работу или уже сохранил terminal snapshot.

Дополнительно обнаружен конкретный источник ложных сбоев Stage 5: `response_normalizer` не распознавал `round_type="final"` в пятистадийном режиме и помечал корректный ответ как unsupported output.

## Lifecycle model: до и после

### До

```text
turn:  queued -> running -> completed | failed | cancelled
round: queued -> running -> completed | failed

stream close -> frontend мог показать fatal failed
final synthesis failure -> весь turn failed
```

### После

```text
turn:      queued -> running -> completed
                         |--> partially_completed
                         |--> failed
                         |--> cancelled

round:     queued -> running -> completed
                         |--> partially_completed
                         |--> failed

synthesis: pending -> running -> completed | failed | skipped
stream:    connecting -> connected -> interrupted -> reconciled snapshot
```

Правила:

- один агент упал, остальные успешны: stage получает `partially_completed`, debate продолжается;
- все агенты упали на обязательной стадии: turn получает `failed`;
- финальный синтез упал после успешных agent stages: turn получает `partially_completed`, `synthesis_status=failed`;
- stream закрылся: backend status не меняется, frontend выполняет один REST reload;
- граф и сохраненные nodes не переводятся в fatal-state при наличии partial results.

## Структурированная ошибка

В `DebateSafeError` добавлены поля:

```text
severity
phase
failed_agents
successful_agents
partial_results_available
retryable
request_id
last_successful_stage
```

Пример сбоя финального синтеза:

```json
{
  "code": "FINAL_SYNTHESIS_FAILED",
  "message": "Final synthesis failed after agent responses were generated.",
  "user_message": "Final synthesis failed. Agent responses are available. Retry synthesis.",
  "severity": "partial",
  "phase": "final_synthesis",
  "failed_agents": ["Moderator"],
  "successful_agents": ["Economist", "Ethicist"],
  "partial_results_available": true,
  "retryable": true,
  "request_id": "turn-request-id",
  "last_successful_stage": 4
}
```

Пример фатального сбоя обязательной стадии:

```json
{
  "code": "ROUND_ALL_AGENTS_FAILED",
  "severity": "fatal",
  "phase": "critique",
  "failed_agents": ["Economist", "Ethicist"],
  "successful_agents": [],
  "partial_results_available": false,
  "retryable": true,
  "request_id": "turn-request-id",
  "last_successful_stage": 1
}
```

## Frontend selector design

Единая функция `deriveDebateViewState(debate)` объединяет persisted REST snapshot, текущий turn status, generation error и stream status.

Она возвращает единый контракт для всех видимых компонентов:

```text
derivedStatus
backendStatus
banner
statusLabel
currentStage / visibleStageLabel
stages
graphState
progress
canRetry / canRetrySynthesis / canReloadStatus
error
```

`useDebateViewState()` является React-оберткой над selector. Старый `useDebateExecutionState()` оставлен только как compatibility adapter и получает данные из того же selector. UI-компоненты больше не читают `turnStatus` напрямую.

## Stream reconciliation

`debate.ws.ts` публикует отдельные состояния соединения, включая `interrupted`. Store при первом interruption:

1. не устанавливает `turnStatus=failed`;
2. показывает checking-state через selector;
3. выполняет ровно один silent `loadDebate`;
4. использует fatal banner только если REST snapshot подтверждает `failed`.

## Пятистадийные labels

Во всех пользовательских lifecycle-подписях используются:

1. `Stage 1: Initial Positions`
2. `Stage 2: Cross-Critiques`
3. `Stage 3: Responses to Critiques`
4. `Stage 4: Revised Positions`
5. `Stage 5: Final Synthesis`

Legacy-тип `1 | 2 | 3` удален из execution state. Видимые `Round/Rounds` для основного lifecycle заменены на `Stage/Stages`.

## Raw debug block

Во вкладку Raw добавлен lifecycle debug block:

```text
debate_id
backend status
derived frontend status
current stage
last event received
last event timestamp
request_id
error code
failed phase
successful agents
failed agents
partial_results_available
retryable
```

## Точные файлы lifecycle-изменений

### Backend

- `server/alembic/versions/0015_add_partial_lifecycle_metadata.py`
- `server/app/api/routes/debate.py`
- `server/app/models/chat_turn.py`
- `server/app/models/round.py`
- `server/app/schemas/contracts.py`
- `server/app/schemas/debate.py`
- `server/app/schemas/serializers.py`
- `server/app/services/chat_engine.py`
- `server/app/services/debate_engine/lifecycle.py`
- `server/app/services/debate_engine/response_normalizer.py`
- `server/app/services/debate_engine/round_manager.py`
- `server/app/services/llm/provider_error_classifier.py`

### Frontend

- `client/package.json`
- `client/scripts/test-debate-lifecycle.mjs`
- `client/src/features/debate/api/debate.types.ts`
- `client/src/features/debate/api/debate.ws.ts`
- `client/src/features/debate/model/debate.store.ts`
- `client/src/features/debate/model/debate-view-state.ts`
- `client/src/features/debate/model/execution-state.ts`
- `client/src/features/debate/model/execution-ux.ts`
- `client/src/features/debate/model/useDebateExecutionState.ts`
- `client/src/features/debate/model/useDebateViewState.ts`
- `client/src/features/debate/ui/DebateGraphCanvas.tsx`
- `client/src/features/debate/ui/DebateLayout.tsx`
- `client/src/features/debate/ui/DebateOverviewPanel.tsx`
- `client/src/features/debate/ui/DebateStepTimeline.tsx`
- `client/src/features/debate/ui/DebateTimeline.tsx`
- `client/src/features/debate/ui/FollowUpInput.tsx`
- `client/src/features/debate/ui/ModeratorPanel.tsx`
- `client/src/features/debate/ui/NodeDetailDrawer.tsx`
- `client/src/features/debate/ui/PlaybackBar.tsx`
- `client/src/features/debate/ui/RawOutputPanel.tsx`
- `client/src/features/debate/ui/TopTopicBar.tsx`
- `client/src/pages/DebateWorkspacePage.tsx`

### Tests

- `server/tests/test_partial_lifecycle.py`
- `server/tests/test_generation_failure_e2e.py`
- `server/tests/test_chat_engine.py`
- `client/scripts/test-debate-lifecycle.mjs`

## Добавленные тесты

Backend покрывает:

- final synthesis failure после успешных agent stages -> `partially_completed`;
- один agent failure при успешных остальных -> stage partial, debate продолжается;
- все agents failed на required stage -> `failed`;
- stream disconnect не меняет backend turn на `failed`;
- structured metadata и partial event.

Frontend lifecycle-check покрывает:

- partial warning вместо fatal banner;
- сохранение graph state;
- единый selector для UI lifecycle;
- interruption -> один REST reload до fatal-state;
- отсутствие прямого чтения `turnStatus` UI-компонентами;
- отсутствие legacy `1 | 2 | 3`;
- каноническую подпись Stage 5.

## Как воспроизвести и проверить

1. Применить миграции:

```powershell
cd server
python -m alembic upgrade head
```

2. Запустить focused backend tests:

```powershell
pytest -q tests/test_chat_engine.py tests/test_partial_lifecycle.py tests/test_generation_failure_e2e.py tests/test_provider_error_classifier.py
```

Ожидаемый результат: `58 passed`.

3. Проверить frontend:

```powershell
cd ..\client
npm run test:lifecycle
npm run build
```

Ожидаемый результат: lifecycle checks passed, production build successful.

4. Для ручной проверки partial synthesis:

- успешно завершить Stages 1-4;
- заставить provider/moderator упасть на Stage 5;
- открыть debate через REST snapshot;
- убедиться, что статус `partially_completed`, граф виден, banner warning, а не `Debate failed`;
- открыть Raw и проверить structured metadata.

5. Для проверки stream reconciliation:

- во время running debate закрыть WebSocket;
- убедиться, что появляется `Connection interrupted. Checking saved status…`;
- проверить один REST reload;
- убедиться, что fatal banner появляется только при backend snapshot со статусом `failed`.

## Результаты проверок и известный baseline

Успешно:

```text
python -m compileall -q app
focused backend lifecycle suite: 58 passed
npm run test:lifecycle
npm run build
```

Полный backend suite на текущем рабочем дереве:

```text
516 passed, 33 failed, 20 warnings
```

Оставшиеся 33 падения находятся преимущественно в старых API/round-manager/follow-up/config/auth тестах и включают прежние трехраундовые ожидания и независимые baseline-проблемы. Они не затрагивают успешно пройденный focused lifecycle suite, но должны быть отдельно актуализированы для полностью зеленого общего suite.

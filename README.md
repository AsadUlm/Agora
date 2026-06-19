# AGORA

## Multi-Agent AI Debate Platform

AGORA는 하나의 질문에 여러 AI agent가 독립적인 입장을 제시하고, 서로의 논거를 비판하며, 비판에 응답하고, 입장을 수정한 뒤 최종 종합 결론을 생성하는 다중 agent 토론 플랫폼이다. 사용자는 agent별 역할·모델·추론 방식·문서 접근 범위를 설정하고, 토론 진행 과정과 근거 사용 내역을 단계별로 확인할 수 있다.

이 문서는 AGORA의 최종 캡스톤 보고서이자 신규 개발자를 위한 설치·실행·테스트·배포 가이드이다. 아래 내용은 현재 저장소의 source code, migration, test, Dockerfile, GitHub Actions workflow를 기준으로 작성되었다.

## 목차

- [1. 프로젝트 개요](#1-프로젝트-개요)
- [2. 핵심 기능](#2-핵심-기능)
- [3. 사용자 시나리오](#3-사용자-시나리오)
- [4. 사용 방법](#4-사용-방법)
- [5. 시스템 아키텍처](#5-시스템-아키텍처)
- [6. Debate Pipeline](#6-debate-pipeline)
- [7. RAG Pipeline](#7-rag-pipeline)
- [8. 기술 스택](#8-기술-스택)
- [9. Repository 구조](#9-repository-구조)
- [10. 로컬 개발 환경 설정](#10-로컬-개발-환경-설정)
- [11. 환경 변수](#11-환경-변수)
- [12. API 개요](#12-api-개요)
- [13. 데이터 모델](#13-데이터-모델)
- [14. 테스트](#14-테스트)
- [15. DevSecOps 및 배포](#15-devsecops-및-배포)
- [16. 알고리즘 및 설계 원칙](#16-알고리즘-및-설계-원칙)
- [17. 오류 처리 및 문제 해결](#17-오류-처리-및-문제-해결)
- [18. 제한사항 및 향후 개선](#18-제한사항-및-향후-개선)
- [19. 팀 및 기여](#19-팀-및-기여)
- [20. 라이선스 및 연락처](#20-라이선스-및-연락처)

## 1. 프로젝트 개요

일반적인 단일 LLM 응답은 하나의 생성 경로에 의존하므로, 전제 누락·과도한 확신·반대 논거 미검토·근거 추적의 어려움이 발생할 수 있다. AGORA는 서로 다른 역할과 추론 설정을 가진 agent가 동일한 질문을 검토하도록 하고, 비판과 수정 과정을 데이터로 보존하여 최종 답변이 만들어진 경로를 사용자에게 공개한다.

프로젝트의 주요 목표는 다음과 같다.

- 하나의 답만 제시하는 대신 초기 입장, 상호 비판, 대응, 수정, 종합의 과정을 제공한다.
- agent별 model, temperature, reasoning style/depth, RAG 범위를 구성할 수 있게 한다.
- 업로드 문서에서 검색한 근거와 citation을 토론 결과에 연결한다.
- WebSocket event와 persisted round를 이용해 진행 상태와 실패 상태를 명확히 표시한다.
- 최초 토론 이후 follow-up 질문을 같은 토론 문맥에서 이어갈 수 있게 한다.

주요 대상 사용자는 복수 관점 검토가 필요한 학생, 연구자, 정책·제품 기획자, 의사결정 지원 도구를 개발하려는 개발자이다. AGORA는 답변의 정확도 향상을 보장하는 평가 시스템이 아니라, 논거의 충돌과 수정 과정을 관찰할 수 있게 하는 구조화된 토론 도구이다.

## 2. 핵심 기능

### 2.1 다중 agent 토론

- 기본 system preset은 `Policy Analyst`, `Innovation Strategist`, `Critical Challenger` 세 개이다.
- 한 토론에는 최소 1개, 최대 `MAX_DEBATE_AGENTS`개 agent가 필요하며 기본 상한은 4개이다.
- 각 stage 안의 agent 호출은 병렬로 실행하되 `LLM_MAX_CONCURRENT_AGENT_CALLS`로 동시 호출 수를 제한한다.
- agent별 실패를 격리하고, stage 전체가 진행 불가능한 경우에만 turn을 실패 처리한다.

### 2.2 Agent 구성과 preset

사용자는 agent의 role, role description, provider, model, temperature, reasoning style, reasoning depth를 설정할 수 있다. RAG mode는 다음 세 가지이다.

- `no_docs`: 문서를 검색하지 않는다.
- `shared_session_docs`: 해당 debate session의 ready 문서 전체를 검색한다.
- `assigned_docs_only`: agent에 명시적으로 연결한 문서만 검색한다.

System preset은 startup 시 database에 동기화된다. 인증된 사용자는 자신의 preset을 생성·수정·복제·기본값 지정·삭제 또는 archive할 수 있다.

### 2.3 5-stage 추적 가능한 토론

최초 cycle은 `initial → critique → critique_response → revised_position → final`의 다섯 stage로 저장된다. 각 critique는 원형 순서로 다음 agent를 대상으로 하며, 대상 agent는 다음 stage에서 자신이 받은 critique에 응답한다. 수정 전후 입장과 변경 이유는 Agent Evolution 및 debate trace에 사용된다.

### 2.4 최종 moderator verdict

Stage 5에서 각 agent가 revised position을 바탕으로 synthesis를 생성한 뒤, debate agent와 분리된 moderator 설정이 전체 결과를 종합한다. moderator 생성이 실패하더라도 앞선 결과가 보존되어 있으면 turn은 `partially_completed`로 종료될 수 있다.

### 2.5 실시간 진행 및 재생 UI

- `POST /debates/start`는 database record를 만든 뒤 즉시 `queued` 응답을 반환한다.
- 실제 생성은 FastAPI `BackgroundTasks`에서 실행된다.
- WebSocket으로 `turn_started`, `round_started`, `message_created`, `round_completed`, terminal event를 전달한다.
- frontend는 graph, timeline, process panel, raw output, debate history, agent evolution, cycle navigator를 제공한다.
- frontend의 기본 생성 flow는 backend `auto` mode를 사용하고, 시각적 playback은 client state로 제어한다. Backend에는 개발·진단용 `manual`, `next-step`, `auto-run`, `resume` API도 구현되어 있다.

### 2.6 질문 사전 검증과 언어 유지

최초 질문은 deterministic rule과 선택적 LLM classifier로 검증한다. 빈 입력, 숫자·기호·emoji만 있는 입력, greeting, 무작위 문자열, 맥락 없는 지시 표현은 거부하거나 추가 설명을 요청한다. 분류기가 실패하면 질문의 구체성에 따라 fail-safe 또는 fail-open 정책을 적용한다.

Korean, Russian, Japanese, Chinese, Arabic, Uzbek, English를 heuristic으로 감지하며, follow-up이 짧아 언어가 불명확하면 이전 cycle 언어를 상속한다. prompt의 JSON key는 English로 유지하되 사용자에게 보이는 값은 감지된 언어로 생성하도록 요구한다.

### 2.7 RAG 문서와 source 표시

- 지원 형식: `.txt`, `.md`, `.pdf`, `.docx`, `.csv`, `.json`
- 기본 제한: 파일당 20 MB, 요청당 10개
- single upload와 partial-success batch upload 지원
- local filesystem 또는 Cloudinary raw storage 지원
- pgvector cosine search와 keyword fallback 지원
- agent별 shared/assigned/no-document 검색 범위 지원
- `[E1]`, `[E2]` 형태 evidence label, source title, relevance, reliability, chunk mapping 제공

### 2.8 Follow-up cycle

완료된 토론에 follow-up을 제출하면 기존 `ChatTurn`에 새 cycle이 추가된다. 이전 synthesis, cycle summary, evolving position, evidence memory를 사용하며 다음 다섯 stage를 실행한다.

`followup_response → followup_cross_critique → followup_response_to_critique → followup_revised_position → updated_synthesis`

중간 exchange stage 일부가 실패해도 usable response가 있으면 updated synthesis를 시도하고, 결과에 따라 `completed`, `partially_completed`, `failed`를 결정한다.

> 현재 제한사항
>
> backend와 database는 follow-up을 다섯 round로 저장하지만, 현재 frontend Process Guide의 일부 표시는 이를 `Response`, `Critique`, `Updated Synthesis` 세 단계로 축약한다. 원본 round data와 결과는 보존되지만 UI 설명은 backend stage와 완전히 일치하도록 추가 정리가 필요하다.

## 3. 사용자 시나리오

1. 사용자가 회원가입 또는 로그인한다.
2. New Debate 화면에서 토론 가능한 질문을 입력한다.
3. 기본 agent preset을 사용하거나 agent의 role, model, reasoning, RAG mode를 수정한다.
4. 필요한 경우 draft session을 생성하고 문서를 업로드한다.
5. `assigned_docs_only` agent에는 사용할 문서를 선택한다.
6. backend가 질문 길이, agent 수, topic readiness를 검증한다.
7. session, agent, document binding, turn, user message를 저장하고 background execution을 시작한다.
8. Stage 1에서 agent가 독립적인 초기 입장을 병렬 생성한다.
9. Stage 2에서 agent `i`가 agent `(i + 1) mod N`의 입장을 비판한다.
10. Stage 3에서 각 agent가 자신에게 전달된 비판을 수용 또는 반박한다.
11. Stage 4에서 각 agent가 수정된 입장과 변경 이유를 제시한다.
12. Stage 5에서 agent synthesis와 moderator verdict를 생성한다.
13. 사용자는 graph, timeline, history, evolution, source/citation, 최종 verdict를 검토한다.
14. 완료 후 follow-up 질문을 제출하여 같은 session에서 다음 cycle을 실행한다.

예시 질문:

- `고위험 AI 시스템에 대한 정부 규제는 혁신을 저해하더라도 강화되어야 하는가?`
- `대학 수업에서 생성형 AI 사용을 전면 허용하는 정책이 학습 성과에 도움이 되는가?`
- `오픈소스 AI 모델의 공개가 사회 전체의 안전에 이로운가?`

거부 또는 보완 요청 가능성이 높은 입력:

- 빈 문자열, 숫자만 있는 입력, emoji만 있는 입력
- `안녕`, `hello`와 같은 greeting
- `이게 맞아?`처럼 평가 대상이 없는 질문
- 2,000자를 초과하는 최초 질문

## 4. 사용 방법

### 4.1 계정 생성

`/signup` 화면에서 email, display name, password를 입력한다. Password는 8자 이상이며 문자와 숫자를 각각 하나 이상 포함해야 한다. 로그인 후 access/refresh JWT가 browser `localStorage`에 저장된다.

### 4.2 토론 생성

1. 좌측 navigation에서 Debates로 이동한다.
2. New Debate를 연다.
3. 질문을 입력한다.
4. Agent configuration drawer에서 사용할 agent를 활성화한다.
5. 필요하면 agent를 추가하되 기본 상한 4개를 넘지 않는다.
6. Start Debate를 실행한다.

### 4.3 Agent와 model 선택

각 agent card에서 다음 값을 설정할 수 있다.

- agent preset 또는 custom 설정
- OpenRouter model catalog와 model preset
- temperature
- reasoning style와 depth
- knowledge mode와 strict grounding
- `assigned_docs_only`일 때 document binding

Model catalog의 experimental 표시는 structured JSON output 안정성에 대한 운영 분류이며, 일반적인 지능 또는 품질 순위가 아니다.

### 4.4 문서 업로드

Agent drawer의 document 영역에서 drag-and-drop 또는 file picker를 사용한다. Backend는 응답 전에 extraction, chunk 저장, embedding 시도를 완료하고 `ready` 또는 `failed` terminal status를 반환한다.

- PDF가 image scan만 포함하면 extractable text가 없어 실패할 수 있다.
- embedding 실패는 document 자체를 실패시키지 않는다. Text chunk가 저장되면 `ready`가 되며 retrieval은 keyword fallback을 사용할 수 있다.
- batch upload는 HTTP `207 Multi-Status`로 성공·실패 파일을 분리한다.
- strict grounding은 prompt behavior를 강화하지만 model이 절대적으로 외부 지식을 사용하지 않는다는 보안 보장은 아니다.

### 4.5 토론 결과 읽기

- `Stage 1`: 각 agent의 초기 관점
- `Stage 2`: 원형 routing으로 생성된 cross-critique
- `Stage 3`: 받은 비판에 대한 수용·거부·수정 계획
- `Stage 4`: revised position과 변경 여부
- `Stage 5`: agent별 synthesis와 moderator의 Overall Synthesis Verdict
- `Debate History`: 시간 순서의 전체 발언
- `Agent Evolution`: initial/revised position 비교
- `Graph`: question, agent, critique, synthesis 관계
- `Raw Output`: structured payload 확인

Citation badge는 backend가 전달한 retrieval metadata와 일치하는 label만 source로 처리한다. Model이 임의로 만든 label은 unresolved citation으로 표시될 수 있다.

### 4.6 Follow-up 질문

Turn status가 `completed`일 때 하단 follow-up composer가 나타난다. 질문을 입력하고 `Ctrl/Cmd + Enter` 또는 버튼으로 제출한다. 기존 debate memory를 유지한 새 cycle이 만들어지며 cycle navigator에서 이전 결과와 비교할 수 있다.

## 5. 시스템 아키텍처

```mermaid
flowchart LR
    U[Browser User] --> FE[React Vite Frontend]
    FE -->|REST and JWT| API[FastAPI API]
    FE <-->|Authenticated WebSocket| WS[WebSocket Manager]
    API --> AUTH[Auth and Topic Guard]
    API --> DB[(PostgreSQL and pgvector)]
    API --> STORE[Local Storage or Cloudinary]
    API --> RUNNER[Background Turn Runner]
    RUNNER --> ORCH[ChatEngine and RoundManager]
    ORCH --> RAG[Retrieval and Evidence Builder]
    RAG --> DB
    ORCH --> LLM[Provider Router]
    LLM --> OR[OpenRouter]
    LLM --> GQ[Groq optional]
    ORCH --> DB
    ORCH --> WS
    API --> STATIC[Bundled Frontend Static Files]
```

| 구성 요소 | 책임 |
|---|---|
| React/Vite frontend | 인증 UI, debate 생성, agent preset/configuration, document upload, graph/timeline/playback, follow-up |
| FastAPI API | validation, ownership check, REST/WebSocket route, static SPA serving |
| ChatEngine | initial turn lifecycle과 5-stage orchestration |
| RoundManager | round 생성, 병렬 agent 호출, retrieval, structured output normalization, message/LLM call 저장 |
| Follow-up runner | 이전 cycle memory 구성, 5-stage follow-up, terminal reconciliation |
| PostgreSQL/pgvector | 사용자·session·agent·round·message·document·chunk·LLM metadata 영속화와 vector search |
| Storage provider | local disk 또는 Cloudinary에 원본 upload 저장 |
| ProviderRouter | agent별 provider/model routing, mock fallback |
| WebSocket manager | session/turn channel에 execution event broadcast |
| Docker/Cloud Run | frontend bundle과 backend를 하나의 container로 실행 |

개발 환경에서는 frontend가 `http://localhost:5173`, backend가 `http://localhost:8000`에서 분리 실행된다. Production image에서는 frontend build가 `server/static`에 포함되며 FastAPI와 동일 origin으로 서비스된다.

## 6. Debate Pipeline

### 6.1 최초 cycle

```mermaid
sequenceDiagram
    actor User
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Engine as ChatEngine
    participant Agents as Agent Calls
    participant Moderator
    participant UI as WebSocket UI

    User->>API: POST /debates/start
    API->>API: Validate topic and agents
    API->>DB: Save session agents bindings turn question
    API-->>User: 201 queued and WebSocket URLs
    API->>Engine: Background task
    Engine-->>UI: turn_started
    Engine->>Agents: Stage 1 initial positions in parallel
    Agents->>DB: Messages and LLMCall rows
    Engine->>Agents: Stage 2 circular cross-critiques
    Engine->>Agents: Stage 3 responses to received critiques
    Engine->>Agents: Stage 4 revised positions
    Engine->>Agents: Stage 5 agent syntheses
    Engine->>Moderator: Neutral synthesis verdict
    Moderator->>DB: Verdict message
    Engine-->>UI: turn_completed or partial or failed
```

| Stage | 목적과 입력 | 상호작용 및 출력 | 저장·전이·실패 처리 |
|---|---|---|---|
| 1 `initial` | question, agent persona, reasoning, optional RAG evidence | 모든 agent가 독립적인 opening position 생성 | `Round`, agent `Message`, `LLMCall`; 전 agent 실패 시 turn 실패 |
| 2 `critique` | Stage 1 결과 | agent `i`가 다음 agent `(i+1) mod N`을 비판; agent 호출은 병렬 | critique payload에 `target_agent`; target 결과가 없으면 general-position skipped result |
| 3 `critique_response` | 자신의 initial position과 자신을 대상으로 한 critique | accepted/rejected point, planned revision, stance update 생성 | 응답 관계가 trace에 저장; 전 agent 실패 시 중단 |
| 4 `revised_position` | initial position, received critique, Stage 3 response | revised position, change summary/type/reason 생성 | Agent Evolution에 필요한 before/after data 저장 |
| 5 `final` | Stage 1·2 digest와 Stage 4 revised position | agent별 final synthesis 후 dedicated moderator verdict | moderator 실패 시 usable agent 결과를 보존하고 `partially_completed` 가능 |

Round 내부 호출은 `asyncio` task와 semaphore를 사용해 병렬 실행한다. 각 task는 독립적인 `AsyncSession`을 사용하고 sequence number는 agent 순서에 따라 미리 배정하여 완료 순서와 관계없이 deterministic ordering을 유지한다.

Structured output이 malformed 또는 incomplete하면 normalization, validation, corrective regeneration, LLM-based recovery/repair 경로를 사용한다. Provider error는 API key나 raw credential을 제거한 safe error로 변환한다.

Terminal state:

- `completed`: required stage와 moderator verdict가 완료됨
- `partially_completed`: usable agent output은 있으나 final verdict 또는 일부 follow-up stage가 실패함
- `failed`: required stage에 usable output이 없거나 복구 불가능한 오류 발생
- `cancelled`: model enum에는 존재하지만 현재 public cancel endpoint는 없다

### 6.2 Follow-up cycle

```mermaid
flowchart TD
    F[Follow-up question] --> M[Build debate memory]
    M --> A[Follow-up responses]
    A --> B[Cross-critiques]
    B --> C[Responses to critiques]
    C --> D[Revised follow-up positions]
    D --> E[Updated syntheses]
    E --> V[Moderator updated verdict]
    V --> R[Persist cycle summary and reconcile status]
```

각 follow-up은 dynamic round number를 다섯 개 할당한다. 예를 들어 최초 cycle이 round 1~5를 사용했다면 첫 follow-up은 6~10을 사용한다. Cross-critique는 최초 cycle과 같은 원형 target mapping을 사용하며, response/revision에서는 역방향 agent가 자신에게 전달한 critique를 찾는다.

Follow-up response는 최소 한 개 usable response가 있으면 synthesis 경로를 계속 시도한다. Cross-critique, critique response, revision은 degradable stage이며 실패 시 transaction을 복구하고 available response로 updated synthesis를 시도한다. 최종 reconciliation은 database에 실제 저장된 round/message 수를 기준으로 terminal status를 다시 계산한다.

### 6.3 Manual execution mode

Backend는 `execution_mode=manual`일 때 agent 호출 직전에 process-local `StepController` gate에서 대기한다. `POST /debates/{id}/next-step`이 한 step을 release하고, `POST /debates/{id}/auto-run`은 이후 gate를 계속 개방한다.

> 현재 제한사항
>
> `StepController`와 WebSocket connection registry는 process-local이다. Multi-worker 또는 여러 Cloud Run instance 사이에서 상태를 공유하지 않으므로 production scale-out 환경의 manual mode에는 Redis/queue 기반 coordination이 필요하다.

## 7. RAG Pipeline

```mermaid
flowchart TD
    UP[UploadFile] --> VAL[Extension size count validation]
    VAL --> ST[Store raw file]
    ST --> EX[Text extraction]
    EX --> CH[Multilingual chunking]
    CH --> DB[(Store plain-text chunks)]
    DB --> READY[Document status ready]
    READY --> EMB[Best-effort embeddings]
    EMB --> META[Best-effort knowledge metadata]
    META --> RET[Agent-scoped retrieval]
    RET -->|Vector available| VEC[pgvector cosine search]
    RET -->|Unavailable or empty| KEY[Keyword fallback]
    VEC --> RANK[Role-aware rerank and diversity]
    KEY --> RANK
    RANK --> EVD[Evidence packets E1 E2]
    EVD --> PROMPT[Prompt context injection]
    PROMPT --> UI[Citation and source display]
```

### 7.1 Upload와 validation

Filename은 path component를 제거하여 sanitize한다. 확장자 allowlist, empty file, file size, batch count를 검사한다. MIME signature 검증은 구현되어 있지 않으며 extension이 extractor 선택 기준이다.

### 7.2 Text extraction

| 형식 | 처리 |
|---|---|
| TXT/MD | UTF-8, UTF-8 BOM, latin-1 순서로 decode |
| PDF | `pypdf` text extraction; scanned image PDF OCR 미지원 |
| DOCX | paragraph와 table cell text 추출 |
| CSV | header 기반 row rendering, 최대 2,000 data row |
| JSON | parse 후 pretty print, 최대 200,000자 |

### 7.3 Chunking

기본값은 `CHUNK_SIZE=800`, `OVERLAP=100`, `MIN_CHUNK=80` character이다. English/Russian punctuation과 Korean/Japanese/Chinese punctuation을 처리하고, 긴 segment는 sentence → clause → whitespace → character 순으로 분리한다. 숫자, identifier, CJK/Cyrillic, heading, bullet, key/value를 포함한 짧은 chunk는 보존할 수 있다.

### 7.4 Embedding과 vector storage

`DocumentChunk.embedding`은 `Vector(768)`이다. 기본 configuration은 OpenRouter embedding endpoint, model `google/gemini-embedding-2-preview`, dimension 768을 사용한다. OpenAI, Gemini, explicit mock provider도 구현되어 있다.

Document는 text chunk가 저장되는 즉시 `ready`가 된다. Embedding은 별도 상태로 관리한다.

- `pending`: 시도 전 또는 진행 중
- `ready`: non-zero vector 저장 완료
- `failed`: provider 또는 shape 오류
- `disabled`: mock/all-zero vector

Embedding 실패 시 document는 `ready`를 유지하고 keyword retrieval로 degrade한다.

### 7.5 Retrieval과 evidence

- ready document만 검색한다.
- query embedding이 유효하면 cosine similarity `0.20` 이상인 chunk를 조회한다.
- embedding/provider/pgvector가 unavailable이거나 결과가 없으면 bounded keyword search를 수행한다.
- 기본 `top_k`는 3이다.
- role별 strategy가 candidate pool, keyword boost, preferred document type, source diversity를 조정한다.
- document 단위로 chunk를 묶고 near-duplicate를 제거한 뒤 `[E1]` 형식 label을 부여한다.
- source title, source type, relevance, reliability, confidence, chunk IDs를 message retrieval metadata에 포함한다.

Agent가 `assigned_docs_only`이면 binding된 document ID로 query를 제한한다. 모든 query는 session ID로 scope되어 다른 session의 chunk를 검색하지 않는다.

### 7.6 상태와 실패

- Storage 또는 extraction 실패: `Document.status=failed`, `error_message` 저장
- Embedding 실패: document는 `ready`, `embedding_status=failed`
- Knowledge metadata 실패: warning만 남기고 upload 성공 유지
- 오래된 `processing` row: startup 또는 list endpoint에서 timeout 후 `failed`로 복구
- 삭제: database cascade로 chunk/binding 삭제, storage object는 best-effort 삭제

진단 endpoint `GET /documents/rag-health?session_id=...`는 provider class, model, dimension, ready document 수, chunk 수, null/zero-vector sample을 반환하며 secret이나 chunk content는 반환하지 않는다.

## 8. 기술 스택

| 영역 | 기술 | 사용 목적 |
|---|---|---|
| Frontend | React 19.2.4, TypeScript 5.9.3, Vite 8.0.1 | SPA와 type-safe UI build |
| UI | MUI 7.3.9, Tailwind CSS 4.2.2, Emotion, Motion | component, styling, animation |
| Graph | `@xyflow/react` 12.10.2 | debate graph visualization |
| State | Zustand 5.0.12 | auth, debate, graph, playback state |
| HTTP | Axios 1.13.6 | REST client와 JWT refresh interceptor |
| Backend | FastAPI, Uvicorn, Pydantic 2 | async REST/WebSocket API와 validation |
| Database | PostgreSQL, pgvector | relational persistence와 vector search |
| ORM/Migration | SQLAlchemy 2 async, asyncpg, Alembic | async persistence와 schema migration |
| LLM | OpenRouter, optional Groq, internal mock | multi-model agent와 moderator generation |
| Embedding | OpenRouter/OpenAI/Gemini/mock adapter | 768-dimension embedding generation |
| Document | pypdf, python-docx, stdlib CSV/JSON | text extraction |
| Storage | Local filesystem, Cloudinary | original document storage |
| Authentication | bcrypt/passlib, python-jose JWT | password hashing과 access/refresh token |
| Testing | pytest, pytest-asyncio, httpx, aiosqlite | unit, API, integration, pipeline test |
| Container | Python 3.12 slim Docker image | backend와 bundled frontend 실행 |
| CI/CD | GitHub Actions, Docker Hub, Google Cloud Run | main push build, migrate, deploy |
| Logging | Python standard logging, Cloud Run stdout/stderr | execution과 failure diagnostics |

Python dependency는 `server/requirements.txt`에 lower bound로 선언되어 있어 exact lock file은 없다. 위 frontend version은 `package-lock.json`에서 확인한 installed resolution이다.

## 9. Repository 구조

```text
.
├── .github/workflows/deploy.yml
├── client/
│   ├── scripts/
│   ├── src/
│   │   ├── app/
│   │   ├── features/
│   │   │   ├── agent-presets/
│   │   │   ├── auth/
│   │   │   └── debate/
│   │   ├── pages/
│   │   └── shared/
│   ├── .env.example
│   ├── package.json
│   └── package-lock.json
├── server/
│   ├── alembic/versions/
│   ├── app/
│   │   ├── api/routes/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   └── services/
│   │       ├── debate_engine/
│   │       ├── documents/
│   │       ├── embeddings/
│   │       ├── llm/
│   │       ├── retrieval/
│   │       └── storage/
│   ├── tests/
│   ├── .env.example
│   ├── alembic.ini
│   └── requirements.txt
├── scripts/
│   ├── build-and-push-docker.sh
│   ├── build-and-push-docker.ps1
│   ├── migrate-cloud-run.sh
│   └── migrate-cloud-run.ps1
├── Dockerfile
├── .dockerignore
├── .gitignore
└── README.md
```

- `client/src/features/debate`: API client, WebSocket, stores, graph mapper, timeline, document, follow-up UI
- `server/app/services/debate_engine`: prompt, quality guard, round execution, traceable pipeline
- `server/app/services/documents`: extraction, chunking, ingestion
- `server/app/services/retrieval`: vector/keyword search, role-aware routing, evidence packet
- `server/alembic/versions`: schema history; current head는 `0022`
- `server/tests`: auth, API, WebSocket, debate, failure, follow-up, RAG, language, storage test
- `server/static`: production frontend bundle; local frontend source가 아니며 build script가 갱신
- `report`: 과거 개발 보고서가 local working tree에 존재하지만 root `.gitignore`에서 제외됨

## 10. 로컬 개발 환경 설정

### 10.1 사전 요구사항

- Git
- Python 3.12 권장: production Docker image가 Python 3.12를 사용
- Node.js `^20.19.0` 또는 `>=22.12.0`: Vite 8 engine requirement
- PostgreSQL
- pgvector extension: semantic vector search와 production schema에 필요
- 선택: Docker, Cloudinary account, OpenRouter/Groq/OpenAI/Gemini credential

저장소에는 `docker-compose.yml`이 없으므로 PostgreSQL은 사용자가 직접 설치하거나 별도 container/service로 실행해야 한다.

### 10.2 Clone

```bash
git clone <repository-url>
cd Agora
```

### 10.3 Backend 환경 변수

macOS/Linux:

```bash
cp server/.env.example server/.env
```

PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

`server/.env`에서 최소 `DATABASE_URL`, `JWT_SECRET`, `DEFAULT_USER_EMAIL`, `DEFAULT_USER_PASSWORD`를 변경한다. 실제 model 생성과 semantic RAG를 사용하려면 선택한 provider key도 설정한다.

### 10.4 Backend 설치와 migration

macOS/Linux:

```bash
cd server
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

PowerShell:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Startup 시 default user와 system agent preset이 seed된다. System preset만 수동 동기화하려면 다음을 실행한다.

```bash
python -m app.db.seed_system_presets
```

Backend URL은 `http://localhost:8000`이며 OpenAPI UI는 `http://localhost:8000/docs`이다. 전용 `/health` endpoint는 구현되어 있지 않으므로 local smoke check는 `/docs` 또는 `/openapi.json` 응답과 startup log를 사용한다.

### 10.5 Frontend 설치와 실행

새 terminal에서 repository root로 돌아온 뒤:

macOS/Linux:

```bash
cp client/.env.example client/.env
cd client
npm ci
npm run dev
```

PowerShell:

```powershell
Copy-Item client/.env.example client/.env
cd client
npm ci
npm run dev
```

Frontend URL은 `http://localhost:5173`이다. `VITE_API_BASE_URL`은 `http://localhost:8000`, `VITE_WS_BASE_URL`은 `ws://localhost:8000`으로 설정한다.

### 10.6 종료

각 frontend/backend terminal에서 `Ctrl+C`를 누른다. Local PostgreSQL 또는 별도 database container는 해당 운영 방식으로 종료한다.

### 10.7 Production-style Docker build

Dockerfile은 frontend를 build하지 않고 이미 존재하는 `server/static`을 복사한다. 따라서 먼저 frontend bundle을 갱신해야 한다.

macOS/Linux:

```bash
cd client
npm ci
VITE_API_BASE_URL= VITE_WS_BASE_URL= npm run build
cd ..
rm -rf server/static
mkdir -p server/static
cp -R client/dist/. server/static/
docker build -t agora:local .
docker run --rm -p 8080:8080 --env-file server/.env agora:local
```

PowerShell:

```powershell
cd client
npm ci
$env:VITE_API_BASE_URL=""
$env:VITE_WS_BASE_URL=""
npm run build
cd ..
Remove-Item -Recurse -Force server/static
New-Item -ItemType Directory server/static | Out-Null
Copy-Item -Recurse -Force client/dist/* server/static/
docker build -t agora:local .
docker run --rm -p 8080:8080 --env-file server/.env agora:local
```

Container에서 host PostgreSQL에 연결할 경우 `DATABASE_URL`의 hostname을 OS/Docker network에 맞게 조정해야 한다. Docker image는 PostgreSQL을 포함하지 않는다.

Repository의 `scripts/build-and-push-docker.*`는 frontend build, static copy, Docker build, 선택적 Docker Hub push를 자동화한다. Local build만 수행하려면 `PUSH=0`과 본인의 `DOCKER_USERNAME`, `IMAGE_NAME`, `IMAGE_TAG`를 명시한다.

## 11. 환경 변수

### 11.1 Backend: `server/.env`

| 변수명 | 필수 여부 | 사용 위치 | 설명 | 안전한 예시 형식 |
|---|---|---|---|---|
| `DATABASE_URL` | 필수 | SQLAlchemy/Alembic | async PostgreSQL URL | `postgresql+asyncpg://username:password@localhost:5432/agora` |
| `APP_ENV` | 선택 | DB engine | `development`이면 SQL echo 활성화 | `development` |
| `CORS_ORIGINS` | 선택 | FastAPI CORS | comma-separated origin | `http://localhost:5173` |
| `PORT` | 선택 | Docker/PaaS | container listen port | `8080` |
| `JWT_SECRET` | 필수 | JWT | token signing secret | `replace_with_a_long_random_secret` |
| `JWT_ALGORITHM` | 선택 | JWT | signing algorithm | `HS256` |
| `JWT_ACCESS_EXPIRE_MINUTES` | 선택 | JWT | access token TTL | `30` |
| `JWT_REFRESH_EXPIRE_DAYS` | 선택 | JWT | refresh token TTL | `7` |
| `DEFAULT_USER_EMAIL` | 필수 | startup seed | default user email | `admin@example.com` |
| `DEFAULT_USER_PASSWORD` | 필수 | startup seed | default user password | `replace_with_a_strong_password` |
| `DEFAULT_USER_NAME` | 선택 | startup seed | display name | `Admin` |
| `LLM_PROVIDER` | 선택 | ProviderRouter | default agent provider | `openrouter` |
| `LLM_MODEL` | 선택 | agent default | default model | `anthropic/claude-sonnet-4.5` |
| `LLM_TEMPERATURE` | 선택 | agent default | default sampling temperature | `0.7` |
| `LLM_MAX_CONCURRENT_AGENT_CALLS` | 선택 | RoundManager | agent call concurrency | `3` |
| `MAX_DEBATE_AGENTS` | 선택 | API/engine | debate agent 상한 | `4` |
| `MODERATOR_PROVIDER` | 선택 | final verdict | moderator provider | `openrouter` |
| `MODERATOR_MODEL` | 선택 | final verdict | moderator model | `anthropic/claude-sonnet-4-6` |
| `MODERATOR_TEMPERATURE` | 선택 | final verdict | moderator temperature | `0.2` |
| `MODERATOR_MAX_TOKENS` | 선택 | final verdict | moderator output budget | `2000` |
| `TOPIC_GUARD_ENABLED` | 선택 | TopicGuard | LLM classifier on/off | `true` |
| `TOPIC_GUARD_MODEL` | 선택 | TopicGuard | classifier model | `google/gemini-flash-1.5` |
| `TOPIC_GUARD_MAX_TOKENS` | 선택 | TopicGuard | classifier output budget | `300` |
| `TOPIC_GUARD_TIMEOUT_S` | 선택 | TopicGuard | classifier timeout seconds | `4.0` |
| `TOPIC_GUARD_CACHE_TTL_S` | 선택 | TopicGuard | in-memory cache TTL | `3600` |
| `TOPIC_GUARD_MIN_CONFIDENCE` | 선택 | TopicGuard | accept threshold | `0.75` |
| `OPENROUTER_API_KEY` | 조건부 필수 | LLM/embedding | OpenRouter 사용 시 secret | `your_openrouter_api_key_here` |
| `GROQ_API_KEY` | 선택 | LLM | 설정 시 Groq provider 활성화 | 빈 값 또는 provider key |
| `OPENAI_API_KEY` | 조건부 필수 | embedding | `EMBEDDING_PROVIDER=openai`일 때 | 빈 값 또는 provider key |
| `GEMINI_API_KEY` | 조건부 필수 | embedding | `EMBEDDING_PROVIDER=gemini`일 때 | 빈 값 또는 provider key |
| `OPENROUTER_MODEL` | 선택 | OpenRouter provider | provider default model | `anthropic/claude-sonnet-4.5` |
| `OPENROUTER_BASE_URL` | 선택 | OpenRouter | API base URL | `https://openrouter.ai/api/v1` |
| `OPENROUTER_SITE_URL` | 선택 | OpenRouter | optional attribution URL | 빈 값 |
| `OPENROUTER_APP_NAME` | 선택 | OpenRouter | attribution title | `AGORA` |
| `EMBEDDING_PROVIDER` | 선택 | RAG | `openrouter`, `openai`, `gemini`, `mock` | `openrouter` |
| `EMBEDDING_MODEL` | 선택 | RAG | embedding model ID | `google/gemini-embedding-2-preview` |
| `EMBEDDING_DIM` | 선택 | RAG/schema | vector dimension, 현재 768 고정 | `768` |
| `EMBEDDING_BASE_URL` | 선택 | RAG | endpoint override | 빈 값 |
| `EMBEDDING_ALLOW_MOCK_FALLBACK` | 선택 | RAG | test 외 mock fallback 허용 | `false` |
| `UPLOAD_DIR` | 선택 | local storage | local upload directory | `uploads` |
| `DOCUMENT_STORAGE_PROVIDER` | 선택 | storage factory | `local` 또는 `cloudinary` | `local` |
| `DOCUMENT_MAX_FILE_SIZE_MB` | 선택 | upload API | file size 상한 | `20` |
| `DOCUMENT_MAX_FILES_PER_UPLOAD` | 선택 | batch API | batch file count 상한 | `10` |
| `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` | 선택 | recovery | stale processing timeout | `300` |
| `KNOWLEDGE_EXTRACTION_TIMEOUT_SECONDS` | 선택 | ingestion | metadata extraction timeout | `30.0` |
| `CLOUDINARY_CLOUD_NAME` | 조건부 필수 | Cloudinary | cloud identifier | 빈 값 또는 account value |
| `CLOUDINARY_API_KEY` | 조건부 필수 | Cloudinary | API key | 빈 값 또는 account value |
| `CLOUDINARY_API_SECRET` | 조건부 필수 | Cloudinary | API secret | 빈 값 또는 account value |
| `CLOUDINARY_UPLOAD_FOLDER` | 선택 | Cloudinary | upload folder | `agora/documents` |
| `CLOUDINARY_RESOURCE_TYPE` | 선택 | Cloudinary | raw resource type | `raw` |

### 11.2 Frontend: `client/.env`

| 변수명 | 필수 여부 | 사용 위치 | 설명 | 안전한 예시 형식 |
|---|---|---|---|---|
| `VITE_API_BASE_URL` | local 선택 | Axios | backend HTTP origin; production blank이면 same-origin | `http://localhost:8000` |
| `VITE_WS_BASE_URL` | local 선택 | WebSocket | backend WS origin; production blank이면 browser origin에서 파생 | `ws://localhost:8000` |

> 보안 경고
>
> `VITE_` prefix 변수는 frontend bundle에 포함되어 browser에 공개된다. API key, password, JWT secret, database credential을 절대 넣지 않는다. 모든 secret은 `server/.env`, GitHub Secrets 또는 cloud runtime secret configuration에서만 관리한다.

External credential은 해당 provider 또는 Cloudinary account에서 발급한다. 실제 값은 repository, screenshot, issue, test log에 기록하지 않는다.

## 12. API 개요

FastAPI OpenAPI UI: `/docs`, schema: `/openapi.json`.

| Method | Path | 인증 | 목적과 주요 field |
|---|---|---|---|
| POST | `/auth/signup` | 없음 | `email`, `password`, `display_name`; access/refresh token 반환 |
| POST | `/auth/login` | 없음 | email/password login |
| POST | `/auth/refresh` | 없음 | refresh token으로 token pair 재발급 |
| GET | `/users/me` | Bearer | 현재 user profile |
| POST | `/sessions` | Bearer | upload용 draft session 생성 |
| GET | `/llm/providers` | Bearer | frontend에 OpenRouter model/preset catalog 제공 |
| POST | `/debates/start` | Bearer | `question`, `agents`, optional `session_id`, `execution_mode`; queued turn 반환 |
| GET | `/debates` | Bearer | 현재 user의 debate 목록 |
| GET | `/debates/{debate_id}` | Bearer/owner | agent, latest turn, round, trace 전체 조회 |
| GET | `/debates/{debate_id}/turns/{turn_id}` | Bearer/owner | 특정 turn 상세 조회 |
| POST | `/debates/{debate_id}/follow-ups` | Bearer/owner | `question`; 새 cycle queue |
| POST | `/debates/{debate_id}/next-step` | Bearer/owner | manual mode에서 한 agent step release |
| GET | `/debates/{debate_id}/step-state` | Bearer/owner | process-local gate snapshot |
| POST | `/debates/{debate_id}/resume` | Bearer/owner | stalled queued turn background runner 재등록 |
| POST | `/debates/{debate_id}/auto-run` | Bearer/owner | manual turn을 auto mode로 전환 |
| POST | `/documents/upload` | Bearer/owner | query `session_id`, multipart `file`; terminal document 반환 |
| POST | `/documents/upload-batch` | Bearer/owner | query `session_id`, multipart `files`; `207` partial result |
| GET | `/documents` | Bearer/owner | query `session_id`; document와 chunk/embedding status |
| GET | `/documents/all` | Bearer | user가 소유한 모든 session 문서 |
| GET | `/documents/{id}/download` | Bearer/owner | local/Cloudinary 원본 proxy download |
| GET | `/documents/rag-health` | Bearer/owner | query `session_id`; secret 없는 RAG diagnostics |
| DELETE | `/documents/{id}` | Bearer/owner | query `session_id`; document/chunk/storage 삭제 |
| GET/POST/PATCH/DELETE | `/agent-presets...` | Bearer | system/user preset 조회 및 user preset 관리 |
| WS | `/ws/chat-turns/{turn_id}?token=...` | JWT query | turn execution event |
| WS | `/ws/chat-sessions/{session_id}?token=...` | JWT query | session execution event |

`DebateStartRequest.agents`의 각 item은 `role`, nested `config`, `document_ids`를 포함한다. `config`에는 `model`, `reasoning`, `knowledge` section이 사용된다.

## 13. 데이터 모델

```mermaid
erDiagram
    USER ||--o{ CHAT_SESSION : owns
    USER ||--o{ AGENT_PRESET : owns
    CHAT_SESSION ||--o{ CHAT_AGENT : configures
    CHAT_SESSION ||--o{ CHAT_TURN : contains
    CHAT_SESSION ||--o{ DOCUMENT : contains
    CHAT_SESSION ||--o{ MESSAGE : contains
    CHAT_SESSION ||--o{ DEBATE_FOLLOW_UP : continues
    CHAT_TURN ||--o{ ROUND : has
    CHAT_TURN ||--o{ MESSAGE : has
    CHAT_TURN ||--o{ LLM_CALL : logs
    CHAT_TURN ||--o{ DEBATE_FOLLOW_UP : receives
    ROUND ||--o{ MESSAGE : groups
    ROUND ||--o{ LLM_CALL : groups
    CHAT_AGENT ||--o{ MESSAGE : authors
    CHAT_AGENT ||--o{ LLM_CALL : executes
    CHAT_AGENT ||--o{ AGENT_DOCUMENT_BINDING : binds
    DOCUMENT ||--o{ AGENT_DOCUMENT_BINDING : assigned
    DOCUMENT ||--o{ DOCUMENT_CHUNK : splits
```

| Entity | 책임 |
|---|---|
| `User` | account, hashed password, session ownership |
| `ChatSession` | 최상위 debate container와 title/status |
| `ChatAgent` | session별 role/model/reasoning/RAG configuration |
| `ChatTurn` | 최초 질문과 모든 cycle의 execution status, language, error metadata |
| `Round` | cycle/stage type, number, status, timestamp |
| `Message` | user input, agent response, critique, synthesis, verdict text의 source of truth |
| `LLMCall` | provider/model/token/latency/status execution metadata |
| `Document` | storage, extraction/embedding status, knowledge metadata |
| `DocumentChunk` | searchable text와 optional 768-d vector |
| `AgentDocumentBinding` | assigned-document RAG scope |
| `DebateFollowUp` | follow-up question, cycle number, compressed cycle summary, language |
| `AgentPreset` | system 또는 user-owned reusable configuration |

Prompt text와 in-memory `StepController`/WebSocket connection은 영속화하지 않는다. Round, message, trace source, LLM execution metadata, document/chunk는 database에 저장한다.

## 14. 테스트

Backend suite는 in-memory SQLite와 mock LLM/embedding을 사용하며 production PostgreSQL-specific type을 test compiler에서 대체한다. 주요 coverage:

- auth signup/login/refresh
- debate API와 step-by-step endpoint
- WebSocket manager와 event
- 5-stage round ordering, parallel execution, partial lifecycle
- follow-up cycle과 traceable stages
- structured output normalization/repair와 safe error
- topic guard와 response-language detection
- RAG upload, extraction, chunking, retrieval/evidence integration
- storage provider와 supported format
- system agent preset과 model/config registry

Frontend에는 Vitest/Jest/Playwright suite가 없다. 대신 lifecycle, graph mapping, process mapping, round verdict, cycle sync, default agent, RAG count를 확인하는 Node assertion script가 있다.

Backend 전체:

```bash
cd server
pytest
```

특정 영역:

```bash
cd server
pytest tests/test_round_parallel_execution.py
pytest tests/test_rag_pipeline.py tests/test_debate_evidence_integration.py
pytest tests/test_followup_cycle.py
pytest tests/api
```

Frontend script tests:

```bash
cd client
npm run test:lifecycle
npm run test:process-mapping
npm run test:round3-verdict
npm run test:graph-model
npm run test:cycle-sync
npm run test:default-agents
npm run test:rag-counts
```

Lint와 production build:

```bash
cd client
npm run lint
npm run build
```

`npm run build`는 `tsc -b` 후 `vite build`를 실행하므로 type check를 포함한다. 별도 확인은 `npx tsc -b`로 실행할 수 있다.

현재 자동화 coverage가 부족한 영역:

- browser E2E와 visual regression
- 실제 PostgreSQL/pgvector integration
- 실제 OpenRouter/Groq/Cloudinary contract test
- Cloud Run deployment smoke test
- performance/load/concurrency test
- frontend component test

실행 결과는 [README_AND_ENV_PREPARATION_REPORT.md](README_AND_ENV_PREPARATION_REPORT.md)에 기록한다.

## 15. DevSecOps 및 배포

### 15.1 CI/CD flow

```mermaid
flowchart LR
    PUSH[Push to main] --> GH[GitHub Actions]
    GH --> NODE[Node 20 setup]
    NODE --> BUILD[Frontend build and static copy]
    BUILD --> IMG[Docker image]
    IMG --> HUB[Docker Hub]
    HUB --> AUTH[GCP service account auth]
    AUTH --> JOB[Update and execute Cloud Run migration job]
    JOB --> RUN[Deploy Cloud Run service]
```

`.github/workflows/deploy.yml`은 `main` push에 실행된다.

1. repository checkout
2. Node.js 20과 Docker Buildx setup
3. Docker Hub login
4. `scripts/build-and-push-docker.sh`로 frontend build, static copy, image push
5. Google Cloud service-account JSON으로 인증
6. Cloud Run job `agora-migrate`의 image update와 실행
7. Cloud Run service `agora-service`를 `asia-northeast3`에 deploy
8. service URL 출력

Image tag는 Git commit SHA이다. Cloud Run deploy는 `--allow-unauthenticated`이므로 application-level JWT가 data API를 보호한다. Runtime `DATABASE_URL`, JWT, provider key 등은 workflow에서 설정하지 않으며 Cloud Run service/migration job에 사전 구성되어 있어야 한다.

GitHub Secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `GCP_PROJECT_ID`
- `GCP_SERVICE_ACCOUNT_KEY`

자동 rollback step은 없다. 이전 commit SHA image가 registry에 남아 있다면 운영자가 해당 image를 Cloud Run에 재배포해야 한다.

### 15.2 구현된 보안 조치

- `.env`와 common credential/private-key file ignore
- password bcrypt hashing
- signed access/refresh JWT와 token type 확인
- protected REST endpoint의 current-user dependency
- session/document/debate ownership query
- configurable CORS allowlist
- upload filename basename sanitize, extension/size/count validation
- database query parameter binding과 session-scoped retrieval
- provider error의 credential redaction 및 frontend-safe error
- secret을 포함하지 않는 RAG diagnostics
- production Docker build에서 env file 제외

### 15.3 현재 구현되지 않았거나 보완이 필요한 보안 조치

- API rate limiting 없음
- dependency vulnerability/scanning workflow 없음
- container image scanning과 non-root user 설정 없음
- upload content signature/malware scan 없음
- JWT가 HttpOnly cookie가 아니라 `localStorage`에 저장됨
- WebSocket endpoint는 JWT 유효성만 검사하고 requested `turn_id`/`session_id`의 ownership을 endpoint 자체에서 확인하지 않음
- Cloud Run service는 public ingress이며 app auth에 의존
- automated secret scanning workflow 없음

운영 전에는 WebSocket ownership check, rate limiting, secret manager integration, dependency/container scanning을 우선 보완하는 것이 권장된다.

## 16. 알고리즘 및 설계 원칙

### 16.1 Deterministic critique routing

Agent 목록 순서를 고정하고 Stage 2에서 `i → (i+1) mod N`으로 target을 배정한다. Stage 3과 4에서는 `target_agent` field로 자신에게 온 critique를 찾는다. 이 방식은 모든 agent가 정확히 하나의 대상과 하나의 critic을 갖게 하며 graph edge와 trace를 재현할 수 있다.

### 16.2 Parallel execution과 deterministic ordering

같은 round의 agent는 parallel task로 실행하지만 sequence number를 먼저 할당한다. 각 task가 별도 database session을 사용하므로 shared `AsyncSession`의 concurrent access를 피하고, 완료 시간과 관계없이 UI ordering을 유지한다.

### 16.3 Position revision trace

Initial position, received critique, critique response, revised position을 분리 저장한다. `changed`, `change_type`, `change_summary`, `reason_for_change`, `key_claims`를 통해 단순 최종 답변이 아니라 의견 변화 과정을 표현한다.

### 16.4 Synthesis

Stage 5 prompt는 initial/critique digest뿐 아니라 revised position을 우선 입력으로 사용한다. 이후 dedicated moderator가 agent syntheses를 다시 종합하여 debate agent 한 명의 관점이 곧 최종 결론이 되지 않도록 분리한다.

### 16.5 Evidence selection

Semantic vector search를 우선하고 lexical fallback을 제공한다. Role-aware strategy, candidate widening, source cap, MMR-style diversity, previous evidence memory를 이용해 동일 문서의 유사 chunk가 과도하게 반복되는 것을 줄인다.

### 16.6 Failure strategy

- Agent 단위 실패 격리
- Required stage의 all-agent failure는 fatal
- Final moderator failure는 partial completion 가능
- Follow-up exchange stage는 degradable
- malformed JSON은 corrective regeneration과 repair 시도
- WebSocket emit은 timeout/error가 debate execution을 중단하지 않도록 격리
- background runner commit 실패 시 fresh session recovery

### 16.7 참고 문헌

현재 repository에는 프로젝트 알고리즘의 기반으로 명시된 학술 논문 citation 또는 bibliography가 없다. 따라서 본 문서는 특정 연구 결과를 AGORA의 성능 근거로 인용하지 않는다.

## 17. 오류 처리 및 문제 해결

| 증상 | 확인 사항과 조치 |
|---|---|
| Backend startup에서 settings validation 실패 | `server/.env`에 `DATABASE_URL`, `JWT_SECRET`, default user field가 있는지 확인 |
| Database connection failure | asyncpg URL scheme, host/port/database/user, PostgreSQL 실행 상태, network/CORS가 아닌 DB firewall 확인 |
| `alembic upgrade head` 실패 | `cd server`에서 실행했는지, database 권한과 pgvector 설치 여부, current/head 확인 |
| Login은 되지만 model이 mock 응답 | 선택 provider key가 없으면 router가 real provider 대신 mock으로 fallback할 수 있음; startup provider log 확인 |
| Invalid API key/credit/rate limit | provider dashboard에서 credential과 quota 확인; key를 log나 issue에 붙이지 말 것 |
| Model unavailable | `/llm/providers` catalog와 provider availability 확인, agent/model preset 변경 |
| 질문이 시작되지 않음 | 422 response의 `gate.decision`, `reason_code`, `user_message` 확인; 평가 대상과 맥락을 구체적으로 입력 |
| Frontend가 backend에 연결되지 않음 | `client/.env`의 HTTP/WS origin, backend port, `CORS_ORIGINS`, browser network tab 확인 |
| WebSocket이 끊김 | token expiry, WS URL, proxy upgrade 지원 확인; client는 최대 5회 exponential reconnect 수행 |
| Upload가 실패함 | extension, 20 MB 기본 제한, empty file, extractor 가능 text 확인; scanned PDF는 OCR 미지원 |
| Document가 ready지만 citation이 없음 | `embedding_status`, `/documents/rag-health`, agent knowledge mode/binding, query와 document 언어·keyword 관련성 확인 |
| Embedding 실패 | provider/key/model/dimension 확인; 현재 schema dimension은 768, keyword fallback은 계속 가능 |
| Processing이 오래 지속됨 | list endpoint를 호출해 stale recovery를 실행하고 `error_message` 확인; 필요하면 re-upload |
| Debate가 `partially_completed` | `latest_turn.error`, failed round, moderator/provider error 확인; 기존 stage 결과는 사용할 수 있음 |
| Follow-up 실패 | 이전 turn terminal 여부, usable response 수, cycle round status, provider error 확인 |
| Frontend build 실패 | Node engine이 `^20.19.0` 또는 `>=22.12.0`인지 확인하고 `npm ci`, `npm run lint`, `npm run build` 순서로 재현 |
| Docker에서 DB 연결 실패 | container의 `localhost`는 host DB가 아님; `host.docker.internal` 또는 Docker network hostname 사용 |
| Cloud Run deploy 실패 | GitHub Actions step별 Docker/GCP auth, migration job, runtime env, service account IAM 확인 |

문제 보고 시 stack trace에서 secret을 제거하고, `.env`, Authorization header, JWT, database URL 전체를 첨부하지 않는다.

## 18. 제한사항 및 향후 개선

### 현재 제한사항

- 생성 품질·사실성·편향에 대한 정량 evaluation dataset과 benchmark가 없다.
- 외부 AI provider availability, model catalog, price, rate limit에 의존한다.
- Python dependency exact lock file이 없다.
- PostgreSQL/pgvector를 포함한 one-command local compose 환경이 없다.
- FastAPI `BackgroundTasks`, in-memory step gate, WebSocket registry는 durable distributed queue가 아니다.
- Follow-up backend 5-stage와 일부 frontend 3-step guide 표현이 불일치한다.
- Frontend unit/component/E2E test framework가 없다.
- RAG는 OCR, table-aware PDF parsing, image, audio를 지원하지 않는다.
- Keyword fallback은 bounded in-memory scoring이며 대규모 corpus 검색 engine이 아니다.
- Citation은 user-uploaded source와 retrieval metadata를 추적하지만 주장 자체의 사실성을 독립 검증하지 않는다.
- WebSocket resource ownership, rate limiting, malware scan, automated security scan이 없다.
- Token을 browser localStorage에 저장한다.
- Cloudinary download proxy는 파일을 memory에 읽은 후 응답한다.
- 전용 health/readiness endpoint와 automated post-deploy smoke test가 없다.

### 향후 개선 예정

- Redis/Celery/Cloud Tasks 기반 durable execution과 multi-instance coordination
- WebSocket channel ownership authorization
- frontend follow-up 5-stage visualization 통일
- browser E2E, component test, real PostgreSQL integration test
- Docker Compose 기반 local database/pgvector setup
- OCR과 richer document parsing
- claim-level citation validation과 source excerpt viewer
- rate limit, HttpOnly cookie 또는 강화된 token storage, malware scan
- Dependabot/code scanning/container scanning/secret scanning
- health/readiness endpoint와 deployment rollback automation
- model quality, latency, cost, citation precision에 대한 evaluation

## 19. 팀 및 기여

**팀명:** Apex

**프로젝트명:** AGORA
**맥락:** 대학 캡스톤 최종 제출 프로젝트

| 역할 | 이름 | 학번 |
|---|---|---|
| 팀장 | 백우진 | 202322060 |
| 팀원 | Bek | 202222212 |
| 팀원 | Ko | 202322014 |

Repository에는 세부 담당 업무, 학교명, 교과목명, 공식 연락처가 기록되어 있지 않으므로 본 문서에서 임의로 추가하지 않았다.

현재 repository history에는 `main`, 개인/기능 branch와 merge commit이 존재하지만, 공식 branch naming·review·commit convention 문서는 없다. 새 contribution에는 다음 최소 절차를 권장한다.

1. `main`에서 목적이 분명한 feature/fix branch를 만든다.
2. unrelated change와 secret을 commit하지 않는다.
3. backend test, frontend script test, lint, build를 실행한다.
4. migration이 필요한 schema 변경은 Alembic revision을 포함한다.
5. Pull Request에 변경 목적, validation 결과, environment/deployment 영향, 알려진 제한을 작성한다.
6. 최소 한 명의 검토 후 `main`에 merge한다.

위 절차는 현재 저장소에서 강제되는 policy가 아니라 제출 이후 협업을 위한 권장안이다.

## 20. 라이선스 및 연락처

현재 repository에는 `LICENSE` file이 없다. License가 선택되기 전까지 source code의 복제·수정·재배포 권한이 자동으로 부여된다고 간주해서는 안 된다.

Private email, phone number 또는 개인 credential은 repository에 공개하지 않는다. 문의는 repository의 공식 GitHub issue/PR channel이 구성된 경우 해당 channel을 사용한다.

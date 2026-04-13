<div align="center">

# 🏛️ Agora — AI Debate Platform

**A structured multi-agent AI debate platform where multiple AI agents reason, challenge, and synthesize perspectives on any question.**

</div>

---

## 팀 정보

| 역할 | 이름   | 학번      |
| ---- | ------ | --------- |
| 팀장 | 백우진 | 202322060 |
| 팀원 | Bek    | 202222212 |
| 팀원 | Ko     | 202322014 |

> **팀명:** Apex &nbsp;|&nbsp; **프로젝트명:** Agora

---

## 프로젝트 소개

**Agora**는 여러 AI 에이전트가 사용자가 제시한 질문을 3라운드 구조로 토론하는 플랫폼입니다.

- **Round 1 — Opening Statements:** 각 에이전트가 자신의 입장과 핵심 논거를 제시합니다.
- **Round 2 — Cross Examination:** 에이전트들이 서로의 주장에 반박하고 응답합니다.
- **Round 3 — Final Synthesis:** 각 에이전트가 토론을 반영해 최종 입장을 정리합니다.

> 사용자는 에이전트 역할(예: analyst, critic, ethicist)을 자유롭게 구성하고, 원하는 질문으로 토론을 시작할 수 있습니다.

---

## 기술 스택

| 영역     | 기술                                             |
| -------- | ------------------------------------------------ |
| Frontend | React 18, Vite, TypeScript, MUI (Material UI)    |
| Backend  | FastAPI, SQLAlchemy (async), Alembic, PostgreSQL |
| LLM      | OpenRouter                 |
| Testing  | pytest, pytest-asyncio, aiosqlite                |

---

## 프로젝트 구조

```
Agora/
├── client/          # React + Vite 프론트엔드
│   └── src/
│       ├── app/         # App 엔트리
│       ├── pages/       # 페이지 컴포넌트
│       ├── components/  # UI 컴포넌트
│       ├── services/    # API 레이어
│       ├── hooks/       # 커스텀 훅
│       ├── types/       # TypeScript 타입
│       └── theme/       # MUI 테마
└── server/          # FastAPI 백엔드
    └── app/
        ├── api/         # API 라우터
        ├── models/      # DB 모델
        ├── schemas/     # Pydantic 스키마
        ├── services/    # 비즈니스 로직
        └── core/        # 설정
```

---

## 시작하기

### 사전 요구사항

- Python 3.11+
- Node.js 18+
- PostgreSQL

---

### 1. 저장소 클론

```bash
git clone <repository-url>
cd Agora
```

---

### 2. 백엔드 실행

```bash
cd server
```

**가상환경 생성 및 패키지 설치**

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

**환경 변수 설정**

`.env.example`을 복사하고 값을 채워주세요:

```bash
cp .env.example .env
```

```env
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/agora
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key   # 선택사항
LLM_PROVIDER=groq
```

**데이터베이스 마이그레이션 적용**

```bash
alembic upgrade head
```

**서버 시작**

```bash
uvicorn app.main:app --reload --port 8000
```

백엔드가 `http://localhost:8000` 에서 실행됩니다.  
API 문서: `http://localhost:8000/docs`

---

### 3. 프론트엔드 실행

```bash
cd client
```

**패키지 설치**

```bash
npm install
```

**환경 변수 설정**

```bash
cp .env.example .env
```

기본값은 이미 설정되어 있습니다:

```env
VITE_API_BASE_URL=http://localhost:8000
```

**개발 서버 시작**

```bash
npm run dev
```

프론트엔드가 `http://localhost:5173` 에서 실행됩니다.

---

### 4. 프로덕션 빌드 (선택)

```bash
cd client
npm run build
```

---

## 테스트 실행

```bash
cd server
pytest
```

---

## 주요 API 엔드포인트

| Method | Endpoint         | 설명           |
| ------ | ---------------- | -------------- |
| `POST` | `/debates/start` | 새 토론 시작   |
| `GET`  | `/debates/{id}`  | 토론 결과 조회 |

import uuid

from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn
from app.models.user import User
from app.schemas.contracts import AgentContext, TurnContext
from app.services.debate_engine.round_manager import RoundManager
from app.services.language_detection import (
    DetectedLanguage,
    detect_response_language,
    looks_like_language,
    resolve_response_language,
)
from app.services.llm import _factory as llm_factory
from app.services.llm.providers.mock_provider import MockProvider


def test_detect_language_english() -> None:
    assert detect_response_language("Should governments regulate high-risk AI?").code == "en"


def test_detect_language_korean() -> None:
    assert detect_response_language("고위험 AI를 엄격하게 규제해야 하나요?").code == "ko"


def test_detect_language_russian() -> None:
    assert detect_response_language("Должны ли правительства регулировать высокорисковые AI?").code == "ru"


def test_detect_language_uzbek_latin() -> None:
    assert detect_response_language(
        "Hukumatlar yuqori xavfli AI tizimlarini tartibga solishi kerakmi?"
    ).code == "uz"


def test_followup_short_question_inherits_previous_language() -> None:
    previous = DetectedLanguage("ko", "Korean", 0.98)
    detected = resolve_response_language("why?", previous)
    assert detected.code == "ko"
    assert detected.source == "inherited"


def test_followup_clear_language_overrides_previous_language() -> None:
    previous = DetectedLanguage("en", "English", 0.90)
    assert resolve_response_language("그럼 스타트업은?", previous).code == "ko"


def test_language_consistency_guard_uses_script_without_over_enforcing_uzbek() -> None:
    assert looks_like_language("정부는 규제를 도입해야 합니다.", "ko")
    assert looks_like_language("Правительствам следует действовать.", "ru")
    assert looks_like_language("Hukumatlar ehtiyotkor bo'lishi kerak.", "uz")
    assert not looks_like_language("This answer drifted into English.", "ko")


async def test_round_manager_adds_one_active_language_block_and_marks_drift(db_session) -> None:
    user = User(id=uuid.uuid4(), email="language_prompt@example.com", password_hash="x")
    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="language test")
    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db_session.add_all([user, session, turn])
    await db_session.flush()

    class CapturingMockProvider(MockProvider):
        def __init__(self) -> None:
            super().__init__()
            self.prompts: list[str] = []

        async def generate(self, request):
            self.prompts.append(request.prompt)
            return await super().generate(request)

    provider = CapturingMockProvider()
    llm_factory.set_service(provider)
    try:
        ctx = TurnContext(
            turn_id=turn.id,
            session_id=session.id,
            user_id=user.id,
            question="Должны ли правительства регулировать высокорисковые AI?",
            agents=[
                AgentContext(
                    agent_id=uuid.uuid4(),
                    role="Policy Analyst",
                    provider="mock",
                    model="mock-model",
                    temperature=0.4,
                )
            ],
            response_language_code="ru",
            response_language_name="Russian",
            response_language_source="heuristic",
            response_language_confidence=0.98,
        )
        result = (await RoundManager(db_session).execute_round_1(ctx))[0]
        assert provider.prompts[0].count("LANGUAGE REQUIREMENT:") == 1
        assert "natural-language values in Russian" in provider.prompts[0]
        assert "active question is in English" not in provider.prompts[0]
        assert result.structured["response_language_code"] == "ru"
        assert "response_language_mismatch" in result.structured["parse_warnings"]
    finally:
        llm_factory.reset_service()

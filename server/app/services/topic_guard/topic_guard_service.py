"""
Debate Topic Guard Service — Hybrid two-stage pre-debate validation.

Architecture
------------
Stage 1 — Fast Deterministic Heuristics (no LLM, near-instant):
  A. Immediate reject: obvious invalid inputs (greetings, empty, emoji, pure
     deictic patterns with no noun, keyboard mash).
  B. Immediate allow: clearly self-contained debate topics (policy questions,
     argument markers with content, substantial context).
  C. Borderline: deictic references with a single concrete-noun hint but no
     actual content — passed to Stage 2.

Stage 2 — Lightweight LLM Pre-screening (only for borderline inputs):
  Asks a cheap/fast model whether the prompt is self-contained enough.
  Uses a strict JSON contract with safety overrides so the LLM cannot
  approve obviously invalid inputs.

Decision Contract
-----------------
All stages produce TopicGateResult with one of four decisions:
  debate_ready          — input is self-contained, debate may start
  needs_clarification   — input lacks concrete object/context
  smalltalk_or_greeting — greeting or casual non-debate message
  unsupported_or_empty  — empty, punctuation-only, emoji-only, impossible

Results are cached by normalized topic hash for TOPIC_GUARD_CACHE_TTL_S
seconds to avoid redundant LLM calls for identical inputs.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel

from app.core.config import settings
from app.schemas.contracts import LLMRequest
from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════
# PHASE 2 — Normalized Decision Contract
# ════════════════════════════════════════════════════════════════════════

class TopicGateDecision(str, Enum):
    debate_ready = "debate_ready"
    needs_clarification = "needs_clarification"
    smalltalk_or_greeting = "smalltalk_or_greeting"
    unsupported_or_empty = "unsupported_or_empty"


class TopicGateResult(BaseModel):
    """Unified gate result returned by all validation stages."""

    decision: TopicGateDecision
    reason_code: str
    user_message: str
    confidence: float
    source: Literal["heuristic", "llm", "cache", "fallback"]
    should_start_debate: bool

    # Backward-compatibility shims
    @property
    def is_valid(self) -> bool:
        return self.should_start_debate

    @property
    def category(self) -> str:
        _map = {
            TopicGateDecision.debate_ready: "valid_debate_topic",
            TopicGateDecision.needs_clarification: "needs_clarification",
            TopicGateDecision.smalltalk_or_greeting: "greeting",
            TopicGateDecision.unsupported_or_empty: "nonsense",
        }
        return _map.get(self.decision, "unclear")

    @property
    def reason(self) -> str:
        return self.user_message

    @property
    def suggested_topic(self) -> Optional[str]:
        return None


# ── Legacy dataclass kept for _deterministic_check internals / older tests ──

@dataclass
class TopicValidationResult:
    """Internal result from deterministic checks."""

    is_valid: bool
    category: str
    confidence: float
    reason: str
    suggested_topic: Optional[str] = None
    source: str = "deterministic"


_VALID_CATEGORIES = frozenset({
    "valid_debate_topic", "greeting", "small_talk", "nonsense", "too_broad",
    "unclear", "not_debatable", "instruction_only", "needs_clarification", "unsafe",
})


# ── Per-category example suggestions ─────────────────────────────────────────

CATEGORY_SUGGESTIONS: dict[str, list[str]] = {
    "greeting": [
        "Should AI replace teachers in primary education?",
        "Is remote work more productive than office work?",
        "Should governments regulate social media platforms?",
    ],
    "small_talk": [
        "Should AI replace teachers in primary education?",
        "Is remote work more productive than office work?",
        "Should governments regulate social media platforms?",
    ],
    "nonsense": [
        "Should governments impose strict regulations on high-risk AI?",
        "Is universal basic income a viable solution to automation?",
        "Should social media platforms be held liable for misinformation?",
    ],
    "too_broad": [
        "Should governments impose strict regulations on high-risk AI?",
        "Is universal basic income a viable solution to automation?",
        "Should social media platforms be held liable for misinformation?",
    ],
    "unclear": [
        "Should AI systems require government approval before deployment?",
        "Is renewable energy a viable replacement for fossil fuels?",
        "Should universities allow students to use AI tools in exams?",
    ],
    "not_debatable": [
        "Should AI be regulated to prevent misuse?",
        "Should remote work become the standard for knowledge workers?",
        "Is open-source software safer than proprietary software?",
    ],
    "needs_clarification": [],
    "instruction_only": [
        "Should AI assistants replace human customer service agents?",
        "Is open-source AI safer than proprietary AI?",
        "Should governments fund AI research directly?",
    ],
    "unsafe": [],
}


# ════════════════════════════════════════════════════════════════════════
# PHASE 3-A — Immediate Reject Patterns
# ════════════════════════════════════════════════════════════════════════

_GREETING_RE = re.compile(
    r"^("
    r"hi+|hello+|hey+|sup|yo+|hiya|howdy|greetings|"
    r"good\s*(morning|afternoon|evening|day)|"
    r"привет|здравствуй(те)?|хай|добр(ый|ое|ая)\s*(день|утро|вечер)|салют|"
    r"안녕(하세요)?|こんにちは|你好|早上好|"
    r"bye+|goodbye|ciao|hola|bonjour|مرحبا|"
    r"ok+|ок+|okay|да|нет|yes+|no+|yep|nope|sure|"
    r"thanks?|спасибо|thank\s*you|"
    r"test|тест|testing|проверка|check|ping|"
    r"lol+|omg|wtf|lmao|bruh|bro"
    r")"
    r"[.!?…\s]*$",
    re.IGNORECASE | re.UNICODE,
)

_ONLY_DIGITS_RE = re.compile(r"^\d[\d\s.,\-]*$")
_NO_LETTERS_RE = re.compile(r"^[^\w]+$", re.UNICODE)
_ONLY_EMOJI_RE = re.compile(
    r"^[\U0001F300-\U0001FFFF\u2600-\u27FF\s!?.,*@#$%^&()\[\]{}<>|~`\-_=+/\\\"':;]+$",
    re.UNICODE,
)
_KR_EMOTICON_RE = re.compile(r"^[ㅋㅎㅠㅡㅇㄱㄴ\s!?~.]+$", re.UNICODE)
_EXCESSIVE_REPEAT_RE = re.compile(r"(.)\1{4,}", re.UNICODE)
_VOWELS_RE = re.compile(
    r"[aeiouaeouiAEIOUаеёиоуыэюяАЕЁИОУЫЭЮЯ]",
    re.UNICODE,
)

_AMBIGUOUS_EN_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.UNICODE)
    for p in [
        r"^is\s+(this|that|it|these|those)\s+(right|correct|okay|ok|good|valid|true|normal|fine|wrong|bad)\s*\??$",
        r"^is\s+(this|that|it|these|those)\s+(right|correct|okay|ok)\s+or\s+(wrong|not|incorrect)\s*\??$",
        r"^(does|will|would|can|could|should)\s+(this|that|it)\s+(work|help|apply|matter)\s*\??$",
        r"^what\s+do\s+you\s+think\s*(about\s+(this|it|that))?\s*\??$",
        r"^thoughts\s*(on\s+(this|it|that))?\s*\??$",
        r"^(wdyt|lgtm|sgtm)\s*\??$",
        r"^(is\s+(this|that|it)|this\s+is)\s+(okay|ok|fine|good|bad|wrong|correct|right)\s*\??$",
        r"^any\s+thoughts\s*\??$",
        r"^makes\s+sense\s*\??$",
        r"^can\s+you\s+(judge|evaluate|review|check|verify)\s+(this|it|that)\s*\??$",
        r"^does\s+(the\s+above|this|it)\s+make\s+sense\s*\??$",
        r"^is\s+(my|the)\s+(idea|opinion|thought)\s+(okay|ok|good|right|correct)\s*\??$",
        r"^would\s+(this|it|that)\s+be\s+(acceptable|okay|ok|fine|valid)\s*\??$",
    ]
]

_AMBIGUOUS_RU_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.UNICODE)
    for p in [
        r"^это\s+(правильно|нормально|норм|верно|ок|окей|хорошо|плохо)\s*\??$",
        r"^это\s+(правильно|верно|нормально)\s+(или\s+нет|или\s+нет\?)\s*\??$",
        r"^норм\s*\??$",
        r"^(как\s+думаешь|что\s+скажешь|что\s+думаешь)\s*(об\s+этом)?\s*\??$",
        r"^(правильно|верно|нормально)\??$",
        r"^(сойдёт|пойдёт|ок|окей)\s*\??$",
        r"^можно\s+так\s*\??$",
        r"^это\s+нормальное\s+решение\s*\??$",
        r"^(хорошее|плохое|нормальное)\s+(решение|идея|подход)\s*\??$",
    ]
]

_AMBIGUOUS_KO_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.UNICODE)
    for p in [
        r"^이거\s*(맞아|맞나요|맞죠|괜찮아|괜찮나요|괜찮죠)\s*\??$",
        r"^어때\s*\??$",
        r"^이게\s+(맞아|맞나요|괜찮아|괜찮나요)\s*\??$",
        r"^맞나요\s*\??$",
        r"^이\s*거\s+괜찮은\s+방향이야\s*\??$",
    ]
]


# ════════════════════════════════════════════════════════════════════════
# PHASE 3-B — Immediate Allow Patterns
# ════════════════════════════════════════════════════════════════════════

_POLICY_QUESTION_RE = re.compile(
    r"^(should|must|ought\s+to|is\s+it\s+right\s+to|is\s+it\s+ethical\s+to)\s+"
    r"(?!this\b|that\b|it\b|the\s+above\b|my\b)",
    re.IGNORECASE | re.UNICODE,
)

_IS_X_DEBATE_RE = re.compile(
    r"^is\s+(?!this\b|that\b|it\b|the\s+above\b|my\b)(.+?)\s+"
    r"(ethical|unethical|dangerous|safe|fair|unfair|necessary|justified|"
    r"beneficial|harmful|appropriate|viable|sustainable|effective|"
    r"опасн|справедлив|необходим|этичн)\b",
    re.IGNORECASE | re.UNICODE,
)

_ARE_X_DEBATE_RE = re.compile(
    r"^are\s+(?!these\b|those\b)(.+?)\s+"
    r"(ethical|unethical|dangerous|safe|fair|necessary|justified|"
    r"beneficial|harmful|effective)\b",
    re.IGNORECASE | re.UNICODE,
)

_ARGUMENT_MARKER_RE = re.compile(
    r"^(evaluate\s+this|critique\s+this|review\s+this\s+argument|"
    r"проверь\s+этот?\s+аргумент|вот\s+мой?\s+аргумент|"
    r"here\s+is\s+my\s+argument|evaluate\s+this\s+claim|"
    r"here\s+is\s+my\s+(design|plan|proposal|architecture|code|approach)|"
    r"вот\s+мой?\s+(дизайн|план|код|подход|решение|аргумент)|"
    r"analyze\s+this|assess\s+this)\b",
    re.IGNORECASE | re.UNICODE,
)

# "Is X better/worse/more effective than Y?" — comparative debate questions
_COMPARATIVE_QUESTION_RE = re.compile(
    r"^is\s+(?!this\b|that\b|it\b)(.+?)\s+"
    r"(better|worse|more|less|safer|riskier|fairer|cheaper|faster|slower|"
    r"more\s+effective|more\s+efficient|more\s+productive|more\s+dangerous|"
    r"superior|inferior|preferable)\s+(than|to|vs\.?|versus)\b",
    re.IGNORECASE | re.UNICODE,
)

# "Should X vs Y?", "X or Y?", "Can X replace Y?" patterns
_COMPARATIVE_VS_RE = re.compile(
    r"^(can|could|will|should|does|do)\s+(?!this\b|that\b|it\b)(.+?)\s+"
    r"(replace|outperform|compete\s+with|beat|surpass)\b",
    re.IGNORECASE | re.UNICODE,
)

# Korean normative/policy debate endings: 해야 하는가? / 해야 할까? / 이 더 나은가?
_KO_POLICY_RE = re.compile(
    r"해야\s*(하는가|할까|합니까|되는가|될까|좋을까)\s*\??|"
    r"이\s*(더|더욱|훨씬)\s*(나은가|좋은가|효과적인가|안전한가|필요한가)\s*\??|"
    r"(규제|금지|허용|도입|폐지)해야",
    re.IGNORECASE | re.UNICODE,
)


# ════════════════════════════════════════════════════════════════════════
# PHASE 4 — Context Sufficiency
# ════════════════════════════════════════════════════════════════════════

_CONCRETE_NOUNS = frozenset({
    # Tech / software — generic
    "architecture", "design", "code", "implementation", "api", "database", "schema",
    "algorithm", "approach", "system", "model", "framework", "library", "module",
    "function", "class", "method", "query", "endpoint", "service", "microservice",
    "docker", "kubernetes", "backend", "frontend", "server", "client", "deployment",
    "migration", "pipeline", "workflow", "logic", "pattern", "structure",
    # Tech — specific products/protocols
    "fastapi", "flask", "django", "express", "nestjs", "springboot",
    "postgresql", "postgres", "mysql", "sqlite", "mongodb", "redis", "kafka",
    "rabbitmq", "celery", "nginx", "graphql", "websocket", "grpc", "oauth", "jwt",
    "rest", "restful", "zustand", "react", "vue", "angular", "svelte",
    "typescript", "javascript", "python", "java", "golang", "rust",
    "aws", "gcp", "azure", "lambda", "cloudflare", "vercel", "cloudinary",
    "elasticsearch", "prometheus", "grafana",
    # Policy / society
    "policy", "regulation", "law", "bill", "rule", "proposal", "decision",
    "argument", "claim", "thesis", "statement", "position", "stance",
    "strategy", "plan", "solution", "idea",
    # Russian equivalents
    "архитектура", "дизайн", "код", "реализация", "база", "схема",
    "алгоритм", "подход", "система", "модель", "фреймворк", "библиотека",
    "функция", "класс", "метод", "запрос", "сервис", "политика",
    "регуляция", "закон", "предложение", "решение", "аргумент", "идея",
    "бэкенд", "фронтенд",
    # Korean equivalents
    "아키텍처", "설계", "코드", "구현", "데이터베이스", "알고리즘",
    "접근법", "시스템", "모델", "프레임워크", "정책", "규제",
    "법안", "제안", "결정", "주장", "아이디어",
})

_CODE_BLOCK_RE = re.compile(r"```|\{\s*[\w\"]+\s*:", re.UNICODE)
_COLON_CONTEXT_RE = re.compile(r":\s*\S{3,}", re.UNICODE)
_DEICTIC_MIN_LENGTH_FOR_CONTEXT = 80

_DEICTIC_TERMS = frozenset({
    "this", "that", "it", "these", "those",
    "это", "то", "оно", "данный", "данная", "данные",
    "이거", "그거", "이게", "그게",
})


def _has_sufficient_context(topic: str) -> bool:
    """
    Return True when a deictic topic still provides enough context.

    Rules (any one suffices):
    1. Length >= 80 chars.
    2. Code block marker present.
    3. Colon followed by substantive content.
    4. At least TWO distinct concrete-noun anchors.
       (A single noun like "design" or "code" alone is not sufficient.)
    """
    lower = topic.lower()

    if len(topic.strip()) >= _DEICTIC_MIN_LENGTH_FOR_CONTEXT:
        return True
    if _CODE_BLOCK_RE.search(topic):
        return True
    if _COLON_CONTEXT_RE.search(topic):
        return True

    words = set(re.findall(r"[\w']+", lower, re.UNICODE))
    if len(words & _CONCRETE_NOUNS) >= 2:
        return True

    return False


def _is_ambiguous_deictic(topic: str) -> bool:
    """
    Return True when the topic is a pure deictic reference (hard reject).
    Return False when a concrete noun is present (borderline → LLM) or
    when sufficient context exists (fast-allowed elsewhere).

    Three-tier logic:
      Explicit pattern match → use _has_sufficient_context (stricter: 2+ nouns etc.)
      General deictic (not matching explicit pattern):
        + has ≥1 concrete noun → False (borderline: passes to LLM + safety overrides)
        + no noun + short + no context → True (hard reject)
    """
    lower = topic.strip().lower()

    # Fast path: explicit pure deictic pattern match
    # These patterns match forms like "Is this right?", "Это правильно?", etc.
    # For these, we use the standard _has_sufficient_context check (2+ nouns/code/colon)
    for pattern in (*_AMBIGUOUS_EN_PATTERNS, *_AMBIGUOUS_RU_PATTERNS, *_AMBIGUOUS_KO_PATTERNS):
        if pattern.match(lower):
            if _has_sufficient_context(topic):
                return False
            # Even with a pattern match: keep original strict behavior
            return True

    # General deictic detection (topic has a deictic term but doesn't match
    # the explicit pure-deictic patterns, e.g. "Is this design good?")
    words = lower.split()
    has_deictic = any(w.rstrip("?,.") in _DEICTIC_TERMS for w in words)
    if has_deictic:
        # If topic has a concrete domain noun (design, code, architecture, etc.)
        # it's BORDERLINE (not hard reject) — LLM + safety overrides will decide
        words_set = set(re.findall(r"[\w']+", lower, re.UNICODE))
        if words_set & _CONCRETE_NOUNS:
            return False
        # No noun + short + no sufficient context → hard reject
        if not _has_sufficient_context(topic):
            word_count = len([w for w in words if re.match(r"[\w]+", w, re.UNICODE)])
            if word_count <= 8:
                return True

    return False


def _is_keyboard_mash(text: str) -> bool:
    letters = re.sub(r"[^a-zA-Z\u0430-\u044F\u0410-\u042F\u0451\u0401]", "", text)
    if len(letters) < 6:
        return False
    vowel_count = len(_VOWELS_RE.findall(letters))
    return (vowel_count / len(letters)) < 0.10


# ════════════════════════════════════════════════════════════════════════
# PHASE 3-B — Self-contained topic check (fast allow)
# ════════════════════════════════════════════════════════════════════════

def _is_self_contained_debate_topic(topic: str) -> bool:
    """
    Return True when the topic is clearly self-contained and needs no LLM.

    Allows instantly (no LLM call) for:
    1. Clear policy/ethical debate question pattern.
    2. Explicit argument/claim/design marker.
    3. No deictic reference + substantive topic (length + domain nouns).
    4. Deictic reference + sufficient context (2+ concrete nouns, code, colon).
    """
    stripped = topic.strip()
    lower = stripped.lower()

    if _POLICY_QUESTION_RE.match(stripped):
        return True
    if _IS_X_DEBATE_RE.match(stripped):
        return True
    if _ARE_X_DEBATE_RE.match(stripped):
        return True
    if _ARGUMENT_MARKER_RE.match(stripped):
        return True
    if _COMPARATIVE_QUESTION_RE.match(stripped):
        return True
    if _COMPARATIVE_VS_RE.match(stripped):
        return True
    if _KO_POLICY_RE.search(stripped):
        return True

    words_raw = lower.split()
    has_deictic = any(w.rstrip("?,.!") in _DEICTIC_TERMS for w in words_raw)

    if not has_deictic:
        word_count = len([w for w in words_raw if re.match(r"[\w]+", w, re.UNICODE)])
        # Non-deictic topic with 6+ real words and at least one domain noun
        if word_count >= 6:
            words_set = set(re.findall(r"[\w']+", lower, re.UNICODE))
            if words_set & _CONCRETE_NOUNS:
                return True
        # Or long enough to be self-explanatory (e.g., comparative questions without
        # obvious domain nouns but clearly structured)
        if len(stripped) >= 40 and word_count >= 7:
            # Sanity check: must not be a deictic fragment
            return True

    if has_deictic and _has_sufficient_context(stripped):
        return True

    return False


# ════════════════════════════════════════════════════════════════════════
# PHASE 3-A — Deterministic Stage (rejects + no-decision pass-through)
# ════════════════════════════════════════════════════════════════════════

def _deterministic_check(topic: str) -> Optional[TopicValidationResult]:
    """
    Stage 1 deterministic rejection.

    Returns TopicValidationResult(is_valid=False) for clearly unsuitable inputs.
    Returns None when undecided (proceed to Stage 2 / LLM).
    """
    stripped = topic.strip()

    if len(stripped) < 3:
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=1.0,
            reason="The input is too short to form a debate topic.",
            source="deterministic",
        )
    if _ONLY_DIGITS_RE.match(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=1.0,
            reason="Numbers alone cannot form a debate topic.",
            source="deterministic",
        )
    if _NO_LETTERS_RE.match(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=1.0,
            reason="The input contains no meaningful words.",
            source="deterministic",
        )
    if _ONLY_EMOJI_RE.match(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=1.0,
            reason="Emoji alone cannot form a debate topic.",
            source="deterministic",
        )
    if _KR_EMOTICON_RE.match(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=1.0,
            reason="This appears to be a chat emoticon, not a debate topic.",
            source="deterministic",
        )
    if _EXCESSIVE_REPEAT_RE.search(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=0.95,
            reason="The input contains excessive character repetition.",
            source="deterministic",
        )
    if _GREETING_RE.match(stripped):
        return TopicValidationResult(
            is_valid=False, category="greeting", confidence=1.0,
            reason="This looks like a greeting or casual message, not a debate topic.",
            source="deterministic",
        )
    if _is_keyboard_mash(stripped):
        return TopicValidationResult(
            is_valid=False, category="nonsense", confidence=0.90,
            reason="The input appears to be random characters, not a meaningful topic.",
            source="deterministic",
        )
    if _is_ambiguous_deictic(stripped):
        return TopicValidationResult(
            is_valid=False, category="needs_clarification", confidence=0.95,
            reason=(
                "The question refers to 'this', 'it', or 'that' without providing "
                "the text, argument, code, design, or context being evaluated."
            ),
            suggested_topic=None,
            source="deterministic",
        )

    return None


# ════════════════════════════════════════════════════════════════════════
# PHASE 6 — Safety Overrides
# ════════════════════════════════════════════════════════════════════════

_DEICTIC_TYPE_RE = re.compile(
    r"\b(this|that|my|the)\s+"
    r"(design|code|architecture|approach|implementation|solution|plan|"
    r"algorithm|system|model|schema|query|api|proposal|"
    r"дизайн|код|архитектур|подход|решени|реализаци|"
    r"알고리즘|설계|코드|아키텍처)\b",
    re.IGNORECASE | re.UNICODE,
)


def _has_deictic_type_only(topic: str) -> bool:
    """True if topic has 'this design / this code / ...' but no actual content."""
    if not _DEICTIC_TYPE_RE.search(topic):
        return False
    return not _has_sufficient_context(topic)


def _apply_safety_overrides(
    topic: str,
    llm_result: "TopicGateResult",
    has_attachments: bool = False,
) -> "TopicGateResult":
    """
    Phase 6: apply safety rules on top of the LLM result.

    1. Attachments override needs_clarification for deictic type prompts.
    2. Low confidence → needs_clarification.
    3. Deictic type without actual content → needs_clarification.
    """
    if (
        has_attachments
        and llm_result.decision == TopicGateDecision.needs_clarification
        and _DEICTIC_TYPE_RE.search(topic)
    ):
        return TopicGateResult(
            decision=TopicGateDecision.debate_ready,
            reason_code="context_from_attachments",
            user_message="",
            confidence=0.80,
            source="heuristic",
            should_start_debate=True,
        )

    if (
        llm_result.decision == TopicGateDecision.debate_ready
        and llm_result.confidence < settings.TOPIC_GUARD_MIN_CONFIDENCE
    ):
        return TopicGateResult(
            decision=TopicGateDecision.needs_clarification,
            reason_code="low_confidence",
            user_message=(
                "Please provide the text, argument, code, design, or context "
                "you want to evaluate."
            ),
            confidence=llm_result.confidence,
            source=llm_result.source,
            should_start_debate=False,
        )

    if (
        llm_result.decision == TopicGateDecision.debate_ready
        and _has_deictic_type_only(topic)
    ):
        return TopicGateResult(
            decision=TopicGateDecision.needs_clarification,
            reason_code="missing_object_context",
            user_message=(
                "Please describe the actual content you want to evaluate "
                "(the design, code, architecture, or approach details)."
            ),
            confidence=0.92,
            source="heuristic",
            should_start_debate=False,
        )

    return llm_result


# ════════════════════════════════════════════════════════════════════════
# PHASE 5 — LLM Pre-Screening Prompt (new contract)
# ════════════════════════════════════════════════════════════════════════

_PRESCREEN_SYSTEM_PROMPT = """\
You are an input-quality classifier for a multi-agent debate platform.

Your task is NOT to answer the user's question.
Your task is only to decide whether the user's initial prompt contains enough
context to start a meaningful multi-agent debate.

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "decision": "debate_ready" | "needs_clarification" | "smalltalk_or_greeting" | "unsupported_or_empty",
  "reason_code": string,
  "user_message": string,
  "confidence": number between 0.0 and 1.0
}

Rules:
- "debate_ready" only if the prompt is self-contained: clear topic, claim, policy question,
  argument, code, design details, document context, or enough background.
- Use "needs_clarification" if the prompt refers to "this", "it", "that", "above",
  "my idea", "this design", "this approach", "это", "이거" without giving actual context.
- Use "smalltalk_or_greeting" for greetings or casual chat.
- Use "unsupported_or_empty" for empty, punctuation-only, emoji-only, or impossible inputs.
- Do not judge whether the user's claim is true.
- Do not answer the user's question.
- Only classify whether the input is ready for debate.
- Be conservative: if context is missing, ask for clarification.
- user_message must be empty string "" when decision is "debate_ready".
- user_message should be a helpful, concise prompt in the SAME language as the input.

Examples:

Input: "Is this right?"
{"decision":"needs_clarification","reason_code":"ambiguous_reference","user_message":"Please provide the text, argument, code, design, or context you want to evaluate.","confidence":0.97}

Input: "Should governments regulate high-risk AI?"
{"decision":"debate_ready","reason_code":"self_contained_topic","user_message":"","confidence":0.94}

Input: "Is this design good?"
{"decision":"needs_clarification","reason_code":"missing_design_context","user_message":"Please describe the design you want to evaluate.","confidence":0.90}

Input: "Is this design good? The backend stores debate turns in PostgreSQL and streams over WebSocket."
{"decision":"debate_ready","reason_code":"self_contained_design_context","user_message":"","confidence":0.92}

Input: "Привет"
{"decision":"smalltalk_or_greeting","reason_code":"greeting_only","user_message":"Напишите тему, утверждение, аргумент, код или контекст для debate.","confidence":0.98}

Input: "Это правильное решение?"
{"decision":"needs_clarification","reason_code":"missing_solution_context","user_message":"Пожалуйста, опишите решение, которое нужно проверить.","confidence":0.92}

Input: "Проверь этот аргумент: строгая регуляция high-risk AI нужна, но может усилить Big Tech."
{"decision":"debate_ready","reason_code":"self_contained_argument","user_message":"","confidence":0.95}

Input: "이 방향 괜찮아?"
{"decision":"needs_clarification","reason_code":"missing_context","user_message":"평가할 텍스트, 주장, 코드, 설계 또는 구체적인 맥락을 입력해 주세요.","confidence":0.91}
"""

_PRESCREEN_USER_TEMPLATE = "User input:\n{topic}"

# Legacy prompt kept for backward compat
_CLASSIFIER_PROMPT_TEMPLATE = """\
You are a pre-screening classifier for AGORA, a multi-agent debate platform.

Decide whether the user input is suitable for starting a structured debate.

Return JSON only with this exact schema (no markdown fences, no extra text):
{{
  "decision": "debate_ready" | "needs_clarification" | "smalltalk_or_greeting" | "unsupported_or_empty",
  "reason_code": string,
  "user_message": string,
  "confidence": number between 0.0 and 1.0
}}

User input:
{topic}"""


# ════════════════════════════════════════════════════════════════════════
# Cache
# ════════════════════════════════════════════════════════════════════════

class _TopicCache:
    def __init__(self, ttl_seconds: int) -> None:
        self._store: dict[str, tuple["TopicGateResult", float]] = {}
        self._ttl = ttl_seconds

    @staticmethod
    def _key(topic: str) -> str:
        normalized = " ".join(topic.lower().split())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def get(self, topic: str) -> Optional["TopicGateResult"]:
        key = self._key(topic)
        entry = self._store.get(key)
        if entry is None:
            return None
        result, expiry = entry
        if time.monotonic() > expiry:
            del self._store[key]
            return None
        return result

    def set(self, topic: str, result: "TopicGateResult") -> None:
        key = self._key(topic)
        self._store[key] = (result, time.monotonic() + self._ttl)

    def clear(self) -> None:
        self._store.clear()


# ════════════════════════════════════════════════════════════════════════
# Service
# ════════════════════════════════════════════════════════════════════════

class DebateTopicGuardService:
    """
    Hybrid pre-debate topic validator.

    Stages:
    1. Deterministic hard reject  → source="heuristic", instant
    2. Self-contained fast allow  → source="heuristic", instant
    3. Cache lookup               → source="cache"
    4. LLM pre-screening          → source="llm", 1-4 s
       + safety overrides
    """

    def __init__(self) -> None:
        self._cache = _TopicCache(ttl_seconds=settings.TOPIC_GUARD_CACHE_TTL_S)

    async def validate(self, topic: str, has_attachments: bool = False) -> TopicGateResult:
        stripped = topic.strip()
        t0 = time.monotonic()
        llm_called = False

        # Stage 1: deterministic reject
        det = _deterministic_check(stripped)
        if det is not None:
            result = _det_to_gate(det)
            _log_gate(result, len(stripped), llm_called, time.monotonic() - t0)
            return result

        # Stage 2: fast allow for self-contained topics
        if _is_self_contained_debate_topic(stripped):
            result = TopicGateResult(
                decision=TopicGateDecision.debate_ready,
                reason_code="self_contained_topic",
                user_message="",
                confidence=0.95,
                source="heuristic",
                should_start_debate=True,
            )
            _log_gate(result, len(stripped), llm_called, time.monotonic() - t0)
            return result

        # Stage 3: cache lookup
        cached = self._cache.get(stripped)
        if cached is not None:
            cached_result = TopicGateResult(
                decision=cached.decision,
                reason_code=cached.reason_code,
                user_message=cached.user_message,
                confidence=cached.confidence,
                source="cache",
                should_start_debate=cached.should_start_debate,
            )
            _log_gate(cached_result, len(stripped), llm_called, time.monotonic() - t0)
            return cached_result

        # Stage 4: LLM pre-screening (borderline inputs only)
        if not settings.TOPIC_GUARD_ENABLED:
            result = _fallback_gate("Topic guard LLM stage is disabled.")
            _log_gate(result, len(stripped), llm_called, time.monotonic() - t0)
            return result

        llm_called = True
        llm_result = await self._prescreen_with_llm(stripped)
        final = _apply_safety_overrides(stripped, llm_result, has_attachments=has_attachments)

        self._cache.set(stripped, final)
        _log_gate(final, len(stripped), llm_called, time.monotonic() - t0)
        return final

    async def _prescreen_with_llm(self, topic: str) -> TopicGateResult:
        try:
            llm = get_llm_service()
            prompt = (
                _PRESCREEN_SYSTEM_PROMPT
                + "\n\n"
                + _PRESCREEN_USER_TEMPLATE.format(topic=topic)
            )
            request = LLMRequest(
                provider=settings.LLM_PROVIDER,
                model=settings.TOPIC_GUARD_MODEL,
                prompt=prompt,
                temperature=0.0,
                max_tokens=settings.TOPIC_GUARD_MAX_TOKENS,
            )
            response = await asyncio.wait_for(
                llm.generate(request),
                timeout=settings.TOPIC_GUARD_TIMEOUT_S,
            )
            result = self._parse_prescreen_response(response.content)
            logger.info(
                "[TopicGuard] LLM prescreen: decision=%s reason=%s confidence=%.2f topic=%.60r",
                result.decision, result.reason_code, result.confidence, topic,
            )
            return result

        except asyncio.TimeoutError:
            logger.warning(
                "[TopicGuard] LLM prescreen timed out (%.1fs) — length-based fallback.",
                settings.TOPIC_GUARD_TIMEOUT_S,
            )
            return _fallback_by_length(topic, "Validation timed out.")

        except Exception as exc:  # noqa: BLE001
            logger.warning("[TopicGuard] LLM prescreen error: %s — length-based fallback.", exc)
            return _fallback_by_length(topic, str(exc))

    # Kept for backward compat in tests that call _llm_classify directly
    async def _llm_classify(self, topic: str) -> TopicGateResult:
        return await self._prescreen_with_llm(topic)

    @staticmethod
    def _parse_prescreen_response(content: str) -> TopicGateResult:
        try:
            text = content.strip()
            if text.startswith("```"):
                text = "\n".join(
                    line for line in text.splitlines()
                    if not line.strip().startswith("```")
                )
            data = json.loads(text)
            decision_raw = str(data.get("decision", "needs_clarification"))
            try:
                decision = TopicGateDecision(decision_raw)
            except ValueError:
                decision = TopicGateDecision.needs_clarification

            return TopicGateResult(
                decision=decision,
                reason_code=str(data.get("reason_code", "llm_classified")),
                user_message=str(data.get("user_message", "")),
                confidence=float(data.get("confidence", 0.5)),
                source="llm",
                should_start_debate=(decision == TopicGateDecision.debate_ready),
            )
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            logger.warning("[TopicGuard] LLM response parse error: %s", exc)
            return _fallback_gate("Classifier returned unparseable response.")

    # Legacy alias
    @staticmethod
    def _parse_llm_response(content: str) -> TopicGateResult:
        return DebateTopicGuardService._parse_prescreen_response(content)


# ════════════════════════════════════════════════════════════════════════
# PHASE 9 — Follow-Up Gate
# ════════════════════════════════════════════════════════════════════════

_FOLLOWUP_REJECT_RE = re.compile(
    r"^("
    r"hi+|hello+|hey+|привет|здравствуй(те)?|안녕(하세요)?"
    r")"
    r"[.!?…\s]*$",
    re.IGNORECASE | re.UNICODE,
)


def validate_followup_topic(
    question: str,
    has_previous_context: bool,
) -> TopicGateResult:
    """
    Relaxed gate for follow-up questions.

    With prior context: reject only empty / emoji / greeting inputs.
    Without prior context: also reject short ambiguous questions.
    """
    stripped = question.strip()

    if len(stripped) < 1:
        return TopicGateResult(
            decision=TopicGateDecision.unsupported_or_empty,
            reason_code="empty_followup",
            user_message="Follow-up question must not be empty.",
            confidence=1.0, source="heuristic", should_start_debate=False,
        )

    if _NO_LETTERS_RE.match(stripped) or _ONLY_EMOJI_RE.match(stripped):
        return TopicGateResult(
            decision=TopicGateDecision.unsupported_or_empty,
            reason_code="no_meaningful_content",
            user_message="Please enter a meaningful follow-up question.",
            confidence=1.0, source="heuristic", should_start_debate=False,
        )

    if _FOLLOWUP_REJECT_RE.match(stripped):
        return TopicGateResult(
            decision=TopicGateDecision.smalltalk_or_greeting,
            reason_code="greeting_followup",
            user_message="Please enter a follow-up question about the debate.",
            confidence=0.98, source="heuristic", should_start_debate=False,
        )

    if has_previous_context:
        return TopicGateResult(
            decision=TopicGateDecision.debate_ready,
            reason_code="followup_with_context",
            user_message="",
            confidence=0.90, source="heuristic", should_start_debate=True,
        )

    word_count = len([w for w in stripped.split() if re.match(r"[\w]+", w, re.UNICODE)])
    if word_count <= 4 and _is_ambiguous_deictic(stripped):
        return TopicGateResult(
            decision=TopicGateDecision.needs_clarification,
            reason_code="ambiguous_without_context",
            user_message="Please provide more context — no prior debate exists.",
            confidence=0.88, source="heuristic", should_start_debate=False,
        )

    return TopicGateResult(
        decision=TopicGateDecision.debate_ready,
        reason_code="followup_accepted",
        user_message="",
        confidence=0.85, source="heuristic", should_start_debate=True,
    )


# ════════════════════════════════════════════════════════════════════════
# Public API
# ════════════════════════════════════════════════════════════════════════

async def validate_initial_topic(
    topic: str,
    has_attachments: bool = False,
) -> TopicGateResult:
    """Main gate for initial debate topics. Calls the singleton guard service."""
    guard = get_topic_guard()
    return await guard.validate(topic, has_attachments=has_attachments)


# ════════════════════════════════════════════════════════════════════════
# Internal helpers
# ════════════════════════════════════════════════════════════════════════

def _det_to_gate(det: TopicValidationResult) -> TopicGateResult:
    if det.category == "greeting":
        decision = TopicGateDecision.smalltalk_or_greeting
        user_msg = "Please enter a debate topic, claim, argument, code, or context."
    elif det.category == "needs_clarification":
        decision = TopicGateDecision.needs_clarification
        user_msg = (
            "Please provide the text, argument, code, design, or context "
            "you want to evaluate."
        )
    else:
        decision = TopicGateDecision.unsupported_or_empty
        user_msg = "This input cannot be used to start a debate."

    return TopicGateResult(
        decision=decision,
        reason_code=det.category,
        user_message=user_msg,
        confidence=det.confidence,
        source="heuristic",
        should_start_debate=False,
    )


def _fallback_gate(reason: str) -> TopicGateResult:
    """Fail-open: pass the topic through when guard cannot decide."""
    return TopicGateResult(
        decision=TopicGateDecision.debate_ready,
        reason_code="fallback_pass",
        user_message="",
        confidence=0.50,
        source="fallback",
        should_start_debate=True,
    )


def _fallback_by_length(topic: str, reason: str) -> TopicGateResult:
    """
    Fallback when LLM fails.
    Short/ambiguous or borderline-deictic → needs_clarification (fail-safe).
    Long/substantial → debate_ready (fail-open).
    """
    stripped = topic.strip()
    # Long input → fail-open (user probably provided enough context)
    if len(stripped) >= 80:
        return _fallback_gate(reason)
    # Pure deictic OR borderline deictic (this design / this approach) without
    # sufficient context → needs_clarification so user adds more detail
    if _is_ambiguous_deictic(stripped) or _has_deictic_type_only(stripped):
        return TopicGateResult(
            decision=TopicGateDecision.needs_clarification,
            reason_code="fallback_ambiguous",
            user_message=(
                "Please provide the text, argument, code, design, or context "
                "you want to evaluate."
            ),
            confidence=0.50,
            source="fallback",
            should_start_debate=False,
        )
    # Not ambiguous / short but non-deictic → fail-open
    return _fallback_gate(reason)


def _log_gate(
    result: TopicGateResult,
    length: int,
    llm_called: bool,
    elapsed: float,
) -> None:
    logger.info(
        "[TopicGuard] checked",
        extra={
            "decision": result.decision,
            "reason_code": result.reason_code,
            "source": result.source,
            "confidence": result.confidence,
            "latency_ms": round(elapsed * 1000, 1),
            "length": length,
            "llm_called": llm_called,
        },
    )


# ── Singleton accessor ────────────────────────────────────────────────────────

_guard_instance: Optional[DebateTopicGuardService] = None


def get_topic_guard() -> DebateTopicGuardService:
    """Return the process-level singleton TopicGuardService."""
    global _guard_instance
    if _guard_instance is None:
        _guard_instance = DebateTopicGuardService()
    return _guard_instance

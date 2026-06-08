"""
Provider Error Classifier — maps raw provider exceptions to structured, safe error codes.

This is the single source of truth for error classification.
All provider wrappers call ``classify_provider_error()`` before re-raising.
No secrets (API keys, raw payloads) are included in the returned object.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Error codes ───────────────────────────────────────────────────────────────

PROVIDER_AUTH_ERROR = "PROVIDER_AUTH_ERROR"
PROVIDER_QUOTA_EXCEEDED = "PROVIDER_QUOTA_EXCEEDED"
PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED"
PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
PROVIDER_SERVER_ERROR = "PROVIDER_SERVER_ERROR"
MODEL_EMPTY_RESPONSE = "MODEL_EMPTY_RESPONSE"
MODEL_INVALID_JSON = "MODEL_INVALID_JSON"
STRUCTURED_VALIDATION_FAILED = "STRUCTURED_VALIDATION_FAILED"
RAG_RETRIEVAL_FAILED = "RAG_RETRIEVAL_FAILED"
ROUND_ALL_AGENTS_FAILED = "ROUND_ALL_AGENTS_FAILED"
DEBATE_CONTEXT_MISSING = "DEBATE_CONTEXT_MISSING"
UNKNOWN_ERROR = "UNKNOWN_ERROR"

# Human-readable user messages per code (safe, no internal details)
_USER_MESSAGES: dict[str, str] = {
    PROVIDER_AUTH_ERROR: (
        "The model provider rejected the request because the API key is missing or invalid. "
        "Please check your API key in settings, then retry."
    ),
    PROVIDER_QUOTA_EXCEEDED: (
        "The model provider could not generate a response because the API key has no remaining "
        "credits or quota. Please update the API key, add credits, or select another model, "
        "then retry."
    ),
    PROVIDER_RATE_LIMITED: (
        "The model provider rate-limited this request. Please wait a moment and retry."
    ),
    PROVIDER_TIMEOUT: (
        "The model provider did not respond in time. Please retry."
    ),
    PROVIDER_SERVER_ERROR: (
        "The model provider returned a server error. This is usually temporary — please retry."
    ),
    MODEL_EMPTY_RESPONSE: (
        "The model returned an empty response. This may be a transient issue — please retry."
    ),
    MODEL_INVALID_JSON: (
        "The model returned an unstructured response that could not be parsed. "
        "This may be fixed by retrying."
    ),
    STRUCTURED_VALIDATION_FAILED: (
        "The model response was missing required fields. This may be fixed by retrying."
    ),
    RAG_RETRIEVAL_FAILED: (
        "Document retrieval encountered an error. The debate will continue without document context."
    ),
    ROUND_ALL_AGENTS_FAILED: (
        "All agents failed to generate a response in this round. "
        "Please check your API key, credits, or selected models, then retry."
    ),
    DEBATE_CONTEXT_MISSING: (
        "Required debate context was missing. Please retry."
    ),
    UNKNOWN_ERROR: (
        "An unexpected error occurred during debate generation. Please retry."
    ),
}

# Whether each code is retryable by the user (key fix, add credits, etc.)
_RETRYABLE: dict[str, bool] = {
    PROVIDER_AUTH_ERROR: True,   # retryable after key fix
    PROVIDER_QUOTA_EXCEEDED: True,   # retryable after adding credits / changing model
    PROVIDER_RATE_LIMITED: True,   # retryable after waiting
    PROVIDER_TIMEOUT: True,
    PROVIDER_SERVER_ERROR: True,
    MODEL_EMPTY_RESPONSE: True,
    MODEL_INVALID_JSON: True,
    STRUCTURED_VALIDATION_FAILED: True,
    RAG_RETRIEVAL_FAILED: False,  # not retryable by itself; debate continues without RAG
    ROUND_ALL_AGENTS_FAILED: True,
    DEBATE_CONTEXT_MISSING: False,
    UNKNOWN_ERROR: True,
}


# ── Safe error data object ────────────────────────────────────────────────────

@dataclass
class DebateSafeError:
    """
    Structured, safe error object shared by backend events, persistence, and frontend.

    Contract:
    - ``message``     — technical but safe (no API keys, no raw payloads, no tracebacks)
    - ``user_message`` — clean, understandable, safe for frontend display
    - ``code``        — machine-readable code
    - ``retryable``   — whether the user can resolve the issue and retry
    - ``debug_id``    — log correlation ID (not exposed to frontend by default)
    """

    code: str
    message: str
    user_message: str
    retryable: bool
    provider: str | None = None
    model: str | None = None
    status_code: int | None = None
    agent_id: str | None = None
    agent_name: str | None = None
    round_number: int | None = None
    round_type: str | None = None
    cycle_number: int | None = None
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    debug_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])

    def to_frontend_dict(self) -> dict:
        """
        Return a dict safe for frontend consumption.
        Strips debug_id from the payload (debug_id stays in backend logs only).
        """
        return {
            "code": self.code,
            "message": self.message,
            "user_message": self.user_message,
            "retryable": self.retryable,
            "provider": self.provider,
            "model": self.model,
            "status_code": self.status_code,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "round_number": self.round_number,
            "round_type": self.round_type,
            "cycle_number": self.cycle_number,
            "timestamp": self.timestamp,
        }

    def to_log_dict(self) -> dict:
        """Return a dict for backend structured logging (includes debug_id)."""
        d = self.to_frontend_dict()
        d["debug_id"] = self.debug_id
        return d


# ── Classifier ────────────────────────────────────────────────────────────────

def classify_provider_error(
    exc: BaseException,
    *,
    provider: str | None = None,
    model: str | None = None,
    status_code: int | None = None,
    agent_id: str | None = None,
    agent_name: str | None = None,
    round_number: int | None = None,
    round_type: str | None = None,
    cycle_number: int | None = None,
) -> DebateSafeError:
    """
    Classify a provider/model exception into a ``DebateSafeError``.

    Rules (in priority order):
      1. Explicit ``status_code`` from the exception attribute
      2. HTTP status pattern in the message string
      3. Keyword patterns (timeout, empty, quota, auth, …)
      4. Fallback → UNKNOWN_ERROR

    The resulting ``message`` is derived from the exception but stripped of
    any obvious secret-like substrings (headers with "Bearer", raw key values).
    """
    raw_msg = _safe_message(str(exc))

    # Extract status code from exception attrs if not provided by caller
    if status_code is None:
        status_code = _extract_status_code(exc, raw_msg)

    code = _classify_code(status_code, raw_msg, exc)

    safe_error = DebateSafeError(
        code=code,
        message=raw_msg,
        user_message=_USER_MESSAGES.get(code, _USER_MESSAGES[UNKNOWN_ERROR]),
        retryable=_RETRYABLE.get(code, True),
        provider=provider,
        model=model,
        status_code=status_code,
        agent_id=agent_id,
        agent_name=agent_name,
        round_number=round_number,
        round_type=round_type,
        cycle_number=cycle_number,
    )

    logger.warning(
        "[ProviderClassifier] code=%s status=%s provider=%s model=%s debug_id=%s message=%s",
        safe_error.code,
        status_code,
        provider,
        model,
        safe_error.debug_id,
        raw_msg[:200],
    )

    return safe_error


def make_safe_error(
    code: str,
    *,
    message: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    agent_id: str | None = None,
    agent_name: str | None = None,
    round_number: int | None = None,
    round_type: str | None = None,
    cycle_number: int | None = None,
) -> DebateSafeError:
    """Construct a safe error directly from a known code (for synthetic/round-level errors)."""
    return DebateSafeError(
        code=code,
        message=message or _USER_MESSAGES.get(code, code),
        user_message=_USER_MESSAGES.get(code, _USER_MESSAGES[UNKNOWN_ERROR]),
        retryable=_RETRYABLE.get(code, True),
        provider=provider,
        model=model,
        agent_id=agent_id,
        agent_name=agent_name,
        round_number=round_number,
        round_type=round_type,
        cycle_number=cycle_number,
    )


# ── Private helpers ───────────────────────────────────────────────────────────

_SECRET_PATTERNS = re.compile(
    r"(Bearer\s+\S+|sk-[A-Za-z0-9\-_]{10,}|api[_-]?key[=:\s]+\S+)",
    re.IGNORECASE,
)


def _safe_message(raw: str) -> str:
    """Strip potential secret values from an error message string."""
    return _SECRET_PATTERNS.sub("[REDACTED]", raw)


def _extract_status_code(exc: BaseException, msg: str) -> int | None:
    """Try to find an HTTP status code from the exception or its message."""
    for attr in ("status_code", "status", "code"):
        val = getattr(exc, attr, None)
        if isinstance(val, int) and 100 <= val < 600:
            return val
    # Also check response attribute (openai client)
    resp = getattr(exc, "response", None)
    if resp is not None:
        sc = getattr(resp, "status_code", None) or getattr(resp, "status", None)
        if isinstance(sc, int) and 100 <= sc < 600:
            return sc
    # Last resort: parse from message string
    m = re.search(r"\b([45]\d{2})\b", msg)
    if m:
        return int(m.group(1))
    return None


def _classify_code(status_code: int | None, msg: str, exc: BaseException) -> str:
    lower = msg.lower()

    # Status-code-first classification
    if status_code == 401:
        return PROVIDER_AUTH_ERROR
    if status_code == 402:
        return PROVIDER_QUOTA_EXCEEDED
    if status_code == 403:
        # Could be auth or forbidden — check message for quota hints
        if any(kw in lower for kw in ("quota", "credit", "insufficient", "payment")):
            return PROVIDER_QUOTA_EXCEEDED
        return PROVIDER_AUTH_ERROR
    if status_code == 408:
        return PROVIDER_TIMEOUT
    if status_code == 429:
        return PROVIDER_RATE_LIMITED
    if status_code is not None and 500 <= status_code < 600:
        return PROVIDER_SERVER_ERROR

    # Keyword-based fallback
    if any(kw in lower for kw in ("timeout", "timed out", "time out", "connection reset", "read timeout")):
        return PROVIDER_TIMEOUT
    if any(kw in lower for kw in ("rate limit", "rate_limit", "ratelimit", "too many requests", "429")):
        return PROVIDER_RATE_LIMITED
    if any(kw in lower for kw in ("quota", "credit", "insufficient_quota", "insufficient credit", "payment required", "402")):
        return PROVIDER_QUOTA_EXCEEDED
    if any(kw in lower for kw in ("unauthorized", "invalid api key", "api key", "authentication", "401", "403", "forbidden")):
        return PROVIDER_AUTH_ERROR
    if any(kw in lower for kw in ("internal server", "bad gateway", "service unavailable", "500", "502", "503")):
        return PROVIDER_SERVER_ERROR
    if any(kw in lower for kw in ("empty response", "no content", "empty content")):
        return MODEL_EMPTY_RESPONSE

    # Exception type hints
    exc_name = type(exc).__name__.lower()
    if "timeout" in exc_name:
        return PROVIDER_TIMEOUT

    return UNKNOWN_ERROR

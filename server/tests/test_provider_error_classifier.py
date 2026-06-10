"""
Tests for the provider error classifier.

Covers the full classification matrix:
  401 → PROVIDER_AUTH_ERROR
  402 → PROVIDER_QUOTA_EXCEEDED
  403 + quota hint → PROVIDER_QUOTA_EXCEEDED
  403 without quota → PROVIDER_AUTH_ERROR
  408 → PROVIDER_TIMEOUT
  429 → PROVIDER_RATE_LIMITED
  5xx → PROVIDER_SERVER_ERROR
  timeout keyword → PROVIDER_TIMEOUT
  rate limit keyword → PROVIDER_RATE_LIMITED
  quota keyword → PROVIDER_QUOTA_EXCEEDED
  auth keyword → PROVIDER_AUTH_ERROR
  empty response → MODEL_EMPTY_RESPONSE
  unknown → UNKNOWN_ERROR

Also tests:
  - Secret redaction in message
  - make_safe_error helper
  - to_frontend_dict / to_log_dict
"""

import pytest

from app.services.llm.provider_error_classifier import (
    PROVIDER_AUTH_ERROR,
    PROVIDER_QUOTA_EXCEEDED,
    PROVIDER_RATE_LIMITED,
    PROVIDER_SERVER_ERROR,
    PROVIDER_TIMEOUT,
    MODEL_EMPTY_RESPONSE,
    ROUND_ALL_AGENTS_FAILED,
    UNKNOWN_ERROR,
    DebateSafeError,
    classify_provider_error,
    make_safe_error,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

class _FakeStatusError(Exception):
    """Minimal stand-in for openai.APIStatusError."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class _FakeTimeoutError(Exception):
    """Minimal stand-in for openai.APITimeoutError."""


# ── Status-code classification ─────────────────────────────────────────────────

@pytest.mark.parametrize(
    "status_code, expected_code",
    [
        (401, PROVIDER_AUTH_ERROR),
        (402, PROVIDER_QUOTA_EXCEEDED),
        (403, PROVIDER_AUTH_ERROR),          # default 403 (no quota hint)
        (408, PROVIDER_TIMEOUT),
        (429, PROVIDER_RATE_LIMITED),
        (500, PROVIDER_SERVER_ERROR),
        (502, PROVIDER_SERVER_ERROR),
        (503, PROVIDER_SERVER_ERROR),
    ],
)
def test_classify_by_status_code(status_code, expected_code):
    exc = _FakeStatusError(f"HTTP error {status_code}", status_code=status_code)
    result = classify_provider_error(exc, status_code=status_code)
    assert result.code == expected_code


def test_403_with_quota_hint_is_quota_exceeded():
    exc = _FakeStatusError("You have insufficient credits.", status_code=403)
    result = classify_provider_error(exc, status_code=403)
    assert result.code == PROVIDER_QUOTA_EXCEEDED


def test_403_with_payment_hint_is_quota_exceeded():
    exc = _FakeStatusError("Payment required.", status_code=403)
    result = classify_provider_error(exc, status_code=403)
    assert result.code == PROVIDER_QUOTA_EXCEEDED


def test_403_openrouter_key_limit_exceeded_is_quota_not_auth():
    """OpenRouter returns 403 "Key limit exceeded (total limit)" when the key
    runs out of credits. That must surface as QUOTA ("add credits"), not AUTH
    ("check your API key"), so the user is sent to the right fix."""
    exc = _FakeStatusError(
        "Error code: 403 - {'error': {'message': 'Key limit exceeded (total limit). "
        "Manage it using https://openrouter.ai/...', 'code': 403}}",
        status_code=403,
    )
    result = classify_provider_error(exc, status_code=403)
    assert result.code == PROVIDER_QUOTA_EXCEEDED
    lower = result.user_message.lower()
    assert "credit" in lower or "quota" in lower, result.user_message


def test_403_invalid_key_still_maps_to_auth():
    """A genuine forbidden/invalid-key 403 (no limit/credit hint) stays AUTH."""
    exc = _FakeStatusError("403 Forbidden: invalid credentials", status_code=403)
    result = classify_provider_error(exc, status_code=403)
    assert result.code == PROVIDER_AUTH_ERROR


# ── Keyword-based classification ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "message, expected_code",
    [
        ("OpenRouter API timeout: Connection timed out", PROVIDER_TIMEOUT),
        ("Request timed out after 30 seconds", PROVIDER_TIMEOUT),
        ("Rate limit exceeded for this model", PROVIDER_RATE_LIMITED),
        ("429 Too Many Requests", PROVIDER_RATE_LIMITED),
        ("quota exceeded for free tier", PROVIDER_QUOTA_EXCEEDED),
        ("insufficient_quota: no credits remaining", PROVIDER_QUOTA_EXCEEDED),
        ("invalid api key provided", PROVIDER_AUTH_ERROR),
        ("Authentication failed: 401 Unauthorized", PROVIDER_AUTH_ERROR),
        ("Internal server error 500", PROVIDER_SERVER_ERROR),
        ("Empty response from model", MODEL_EMPTY_RESPONSE),
    ],
)
def test_classify_by_keyword(message, expected_code):
    exc = RuntimeError(message)
    result = classify_provider_error(exc)
    assert result.code == expected_code, f"Expected {expected_code} for: {message!r}"


def test_unknown_error_fallback():
    exc = ValueError("Some completely unrelated error")
    result = classify_provider_error(exc)
    assert result.code == UNKNOWN_ERROR


# ── Retryability ───────────────────────────────────────────────────────────────

def test_quota_exceeded_is_retryable():
    exc = _FakeStatusError("402 Payment Required", status_code=402)
    result = classify_provider_error(exc, status_code=402)
    assert result.retryable is True


def test_auth_error_is_retryable_after_key_fix():
    exc = _FakeStatusError("401 Unauthorized", status_code=401)
    result = classify_provider_error(exc, status_code=401)
    assert result.retryable is True


# ── User messages ──────────────────────────────────────────────────────────────

def test_quota_exceeded_user_message_contains_credits():
    exc = _FakeStatusError("402 Payment Required", status_code=402)
    result = classify_provider_error(exc, status_code=402)
    lower = result.user_message.lower()
    assert "credit" in lower or "quota" in lower, result.user_message


def test_rate_limited_user_message_contains_wait():
    exc = _FakeStatusError("429 Rate Limited", status_code=429)
    result = classify_provider_error(exc, status_code=429)
    lower = result.user_message.lower()
    assert "wait" in lower or "retry" in lower or "rate" in lower, result.user_message


# ── Secret redaction ───────────────────────────────────────────────────────────

def test_bearer_token_is_redacted():
    exc = RuntimeError("Authorization: Bearer sk-secret-key-abc123 returned 401")
    result = classify_provider_error(exc)
    assert "sk-secret-key-abc123" not in result.message
    assert "[REDACTED]" in result.message


def test_api_key_is_redacted():
    exc = RuntimeError("api_key=sk-longersecretkey 401 invalid")
    result = classify_provider_error(exc)
    assert "sk-longersecretkey" not in result.message


# ── Metadata propagation ───────────────────────────────────────────────────────

def test_provider_and_model_are_propagated():
    exc = _FakeStatusError("401", status_code=401)
    result = classify_provider_error(exc, provider="openrouter", model="meta/llama-3-70b")
    assert result.provider == "openrouter"
    assert result.model == "meta/llama-3-70b"


def test_round_number_is_propagated():
    exc = _FakeStatusError("500", status_code=500)
    result = classify_provider_error(exc, round_number=2, round_type="critique")
    assert result.round_number == 2
    assert result.round_type == "critique"


# ── to_frontend_dict ───────────────────────────────────────────────────────────

def test_frontend_dict_does_not_include_debug_id():
    exc = RuntimeError("some error")
    result = classify_provider_error(exc)
    d = result.to_frontend_dict()
    assert "debug_id" not in d


def test_frontend_dict_includes_required_fields():
    exc = _FakeStatusError("402", status_code=402)
    result = classify_provider_error(exc, provider="openrouter", model="llama")
    d = result.to_frontend_dict()
    for key in ("code", "message", "user_message", "retryable", "provider", "model", "timestamp"):
        assert key in d, f"Missing key: {key}"


def test_log_dict_includes_debug_id():
    exc = RuntimeError("some error")
    result = classify_provider_error(exc)
    d = result.to_log_dict()
    assert "debug_id" in d
    assert len(d["debug_id"]) > 0


# ── make_safe_error ────────────────────────────────────────────────────────────

def test_make_safe_error_round_all_agents_failed():
    err = make_safe_error(
        ROUND_ALL_AGENTS_FAILED,
        round_number=1,
        round_type="initial",
    )
    assert err.code == ROUND_ALL_AGENTS_FAILED
    assert err.retryable is True
    assert "API" in err.user_message or "agent" in err.user_message.lower()
    assert err.round_number == 1
    assert err.round_type == "initial"
    # debug_id must be present for log correlation
    assert err.debug_id


def test_make_safe_error_custom_message():
    err = make_safe_error(UNKNOWN_ERROR, message="Something went wrong internally")
    assert err.code == UNKNOWN_ERROR
    assert err.message == "Something went wrong internally"

"""
Tests for the EmbeddingService factory + vector validation introduced in
the RAG stabilisation pass.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from app.services.embeddings import embedding_service as ef
from app.services.embeddings.embedding_service import (
    EMBEDDING_DIM,
    EmbeddingProviderError,
    MockEmbeddingService,
    _validate_embedding_vector,
    get_embedding_service,
    reset_embedding_service_for_tests,
    set_embedding_service,
)


# ─────────────────────────────────────────────────────────────────────────────
# _validate_embedding_vector
# ─────────────────────────────────────────────────────────────────────────────


class TestValidateEmbeddingVector:
    def test_valid_vector_returns_list_of_floats(self):
        v = _validate_embedding_vector([0.1] * EMBEDDING_DIM, EMBEDDING_DIM)
        assert isinstance(v, list)
        assert len(v) == EMBEDDING_DIM
        assert all(isinstance(x, float) for x in v)

    def test_wrong_length_raises(self):
        with pytest.raises(EmbeddingProviderError, match="dim="):
            _validate_embedding_vector([0.1] * 10, EMBEDDING_DIM)

    def test_not_a_list_raises(self):
        with pytest.raises(EmbeddingProviderError, match="list/tuple"):
            _validate_embedding_vector("not a vector", EMBEDDING_DIM)

    def test_non_numeric_raises(self):
        bad = [0.1] * (EMBEDDING_DIM - 1) + ["nope"]
        with pytest.raises(EmbeddingProviderError, match="non-numeric"):
            _validate_embedding_vector(bad, EMBEDDING_DIM)

    def test_nan_raises(self):
        bad = [0.1] * (EMBEDDING_DIM - 1) + [float("nan")]
        with pytest.raises(EmbeddingProviderError, match="NaN/Inf"):
            _validate_embedding_vector(bad, EMBEDDING_DIM)

    def test_inf_raises(self):
        bad = [0.1] * (EMBEDDING_DIM - 1) + [float("inf")]
        with pytest.raises(EmbeddingProviderError, match="NaN/Inf"):
            _validate_embedding_vector(bad, EMBEDDING_DIM)

    def test_bool_rejected_as_non_numeric(self):
        # bool is a subclass of int but should not be accepted as a coordinate.
        bad = [0.1] * (EMBEDDING_DIM - 1) + [True]
        with pytest.raises(EmbeddingProviderError, match="non-numeric"):
            _validate_embedding_vector(bad, EMBEDDING_DIM)


# ─────────────────────────────────────────────────────────────────────────────
# Factory: set / reset singleton
# ─────────────────────────────────────────────────────────────────────────────


class TestFactoryOverride:
    def setup_method(self):
        reset_embedding_service_for_tests()

    def teardown_method(self):
        reset_embedding_service_for_tests()

    def test_set_service_overrides_singleton(self):
        fake = MockEmbeddingService()
        set_embedding_service(fake)
        assert get_embedding_service() is fake

    def test_reset_clears_singleton(self):
        sentinel = MockEmbeddingService()
        set_embedding_service(sentinel)
        assert get_embedding_service() is sentinel
        reset_embedding_service_for_tests()
        # After reset the next call goes through _make_service. We can't
        # assume which concrete provider will be built (depends on the
        # developer's .env), but it MUST NOT be the same instance.
        new_svc = get_embedding_service()
        assert new_svc is not sentinel


# ─────────────────────────────────────────────────────────────────────────────
# Factory: strict provider validation
# ─────────────────────────────────────────────────────────────────────────────


class _FakeSettings:
    """Drop-in stand-in for app.core.config.settings used by _make_service."""

    def __init__(
        self,
        *,
        provider: str,
        model: str = "google/gemini-embedding-2-preview",
        dim: int = EMBEDDING_DIM,
        openrouter_key: str = "",
        openai_key: str = "",
        gemini_key: str = "",
        allow_mock_fallback: bool = False,
    ) -> None:
        self.EMBEDDING_PROVIDER = provider
        self.EMBEDDING_MODEL = model
        self.EMBEDDING_DIM = dim
        self.EMBEDDING_BASE_URL = None
        self.OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
        self.OPENROUTER_API_KEY = openrouter_key
        self.OPENROUTER_SITE_URL = "http://localhost"
        self.OPENROUTER_APP_NAME = "AGORA"
        self.OPENAI_API_KEY = openai_key
        self.GEMINI_API_KEY = gemini_key
        self.EMBEDDING_ALLOW_MOCK_FALLBACK = allow_mock_fallback
        self.APP_ENV = "production"


def _force_production_mode(monkeypatch, settings):
    """Disable both the PYTEST and APP_ENV escape hatches and patch settings."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(
        "app.core.config.settings", settings, raising=True,
    )


class TestStrictFactory:
    def setup_method(self):
        reset_embedding_service_for_tests()

    def teardown_method(self):
        reset_embedding_service_for_tests()

    def test_empty_provider_raises_in_production(self, monkeypatch):
        _force_production_mode(monkeypatch, _FakeSettings(provider=""))
        with pytest.raises(EmbeddingProviderError, match="EMBEDDING_PROVIDER is empty"):
            ef._make_service()

    def test_empty_provider_allowed_in_test_mode(self, monkeypatch):
        # Pretend pytest is running so the fallback gate opens.
        monkeypatch.setenv("PYTEST_CURRENT_TEST", "yes")
        monkeypatch.setattr(
            "app.core.config.settings", _FakeSettings(provider=""), raising=True,
        )
        svc = ef._make_service()
        assert isinstance(svc, MockEmbeddingService)

    def test_explicit_mock_always_honored(self, monkeypatch):
        _force_production_mode(monkeypatch, _FakeSettings(provider="mock"))
        svc = ef._make_service()
        assert isinstance(svc, MockEmbeddingService)

    def test_openrouter_without_key_raises(self, monkeypatch):
        _force_production_mode(
            monkeypatch, _FakeSettings(provider="openrouter", openrouter_key=""),
        )
        with pytest.raises(EmbeddingProviderError, match="OPENROUTER_API_KEY"):
            ef._make_service()

    def test_openai_without_key_raises(self, monkeypatch):
        _force_production_mode(
            monkeypatch, _FakeSettings(provider="openai", openai_key=""),
        )
        with pytest.raises(EmbeddingProviderError, match="OPENAI_API_KEY"):
            ef._make_service()

    def test_gemini_without_key_raises(self, monkeypatch):
        _force_production_mode(
            monkeypatch, _FakeSettings(provider="gemini", gemini_key=""),
        )
        with pytest.raises(EmbeddingProviderError, match="GEMINI_API_KEY"):
            ef._make_service()

    def test_unknown_provider_raises(self, monkeypatch):
        _force_production_mode(monkeypatch, _FakeSettings(provider="totally-fake"))
        with pytest.raises(EmbeddingProviderError, match="Unknown EMBEDDING_PROVIDER"):
            ef._make_service()

    def test_allow_mock_fallback_in_production(self, monkeypatch):
        _force_production_mode(
            monkeypatch, _FakeSettings(provider="", allow_mock_fallback=True),
        )
        svc = ef._make_service()
        assert isinstance(svc, MockEmbeddingService)

"""
Tests for the Provider/Model Registry and Agent Configuration System.

Covers:
  • Registry — provider listing, model listing, filtering, status
  • AgentConfig — from_raw parsing, defaults, rich configs, backward compat
  • LLM API endpoints — GET /llm/providers, GET /llm/models, GET /agents/config/options
  • Placeholder provider rejection via factory
  • Debate start with rich agent config
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.schemas.agent_config import AgentConfig, ModelConfig, ReasoningConfig
from app.services.llm.exceptions import ProviderConfigError, ProviderUnavailableError
from app.services.llm.registry import ProviderRegistry


# ═══════════════════════════════════════════════════════════════════════════════
# Registry unit tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestProviderRegistry:
    def test_registry_has_providers(self):
        reg = ProviderRegistry()
        providers = reg.list_providers()
        assert len(providers) >= 3  # groq, openai, mock at minimum

    def test_groq_is_registered(self):
        reg = ProviderRegistry()
        groq = reg.get_provider("groq")
        assert groq is not None
        assert groq.name == "Groq"
        assert groq.status in ("active", "configured")

    def test_mock_is_always_active(self):
        reg = ProviderRegistry()
        mock = reg.get_provider("mock")
        assert mock is not None
        assert mock.status == "active"

    def test_placeholders_exist(self):
        reg = ProviderRegistry()
        for pid in ("anthropic", "google", "mistral", "cohere", "deepseek"):
            info = reg.get_provider(pid)
            assert info is not None, f"Missing placeholder: {pid}"
            assert info.status == "placeholder"

    def test_each_provider_has_models(self):
        reg = ProviderRegistry()
        for p in reg.list_providers():
            assert len(p.models) >= 1, f"Provider {p.id} has no models"

    def test_list_models_all(self):
        reg = ProviderRegistry()
        all_models = reg.list_models()
        assert len(all_models) >= 5

    def test_list_models_filtered(self):
        reg = ProviderRegistry()
        groq_models = reg.list_models(provider="groq")
        assert len(groq_models) >= 2
        assert all("llama" in m.id or "mixtral" in m.id for m in groq_models)

    def test_list_models_unknown_provider_returns_empty(self):
        reg = ProviderRegistry()
        assert reg.list_models(provider="nonexistent") == []

    def test_providers_sorted_active_first(self):
        reg = ProviderRegistry()
        providers = reg.list_providers()
        statuses = [p.status for p in providers]
        # Active providers should come before placeholders
        active_indices = [i for i, s in enumerate(statuses) if s == "active"]
        placeholder_indices = [i for i, s in enumerate(statuses) if s == "placeholder"]
        if active_indices and placeholder_indices:
            assert max(active_indices) < min(placeholder_indices)


# ═══════════════════════════════════════════════════════════════════════════════
# AgentConfig unit tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestAgentConfig:
    def test_empty_dict_returns_defaults(self):
        cfg = AgentConfig.from_raw({})
        assert cfg.reasoning.style == "balanced"
        assert cfg.reasoning.depth == "normal"
        assert cfg.model.provider == ""

    def test_legacy_flat_dict_returns_defaults(self):
        cfg = AgentConfig.from_raw({"some_old_key": "value"})
        assert cfg.reasoning.style == "balanced"

    def test_rich_config_parsed(self):
        raw = {
            "model": {"provider": "groq", "model": "llama-3.3-70b-versatile", "temperature": 0.5},
            "reasoning": {"style": "analytical", "depth": "deep"},
        }
        cfg = AgentConfig.from_raw(raw)
        assert cfg.model.provider == "groq"
        assert cfg.model.model == "llama-3.3-70b-versatile"
        assert cfg.model.temperature == 0.5
        assert cfg.reasoning.style == "analytical"
        assert cfg.reasoning.depth == "deep"

    def test_partial_config_fills_defaults(self):
        raw = {"reasoning": {"style": "creative"}}
        cfg = AgentConfig.from_raw(raw)
        assert cfg.reasoning.style == "creative"
        assert cfg.reasoning.depth == "normal"  # default
        assert cfg.model.provider == ""  # default

    def test_model_dump_roundtrip(self):
        raw = {
            "identity": {"name": "Agent007", "description": "Secret agent"},
            "model": {"provider": "groq"},
        }
        cfg = AgentConfig.from_raw(raw)
        dumped = cfg.model_dump()
        restored = AgentConfig.model_validate(dumped)
        assert restored.identity.name == "Agent007"
        assert restored.model.provider == "groq"


# ═══════════════════════════════════════════════════════════════════════════════
# Placeholder provider factory test
# ═══════════════════════════════════════════════════════════════════════════════


class TestPlaceholderProvider:
    def test_placeholder_raises_unavailable_error(self):
        """Requesting a placeholder provider from the factory raises ProviderUnavailableError."""
        from unittest.mock import patch

        with patch("app.services.llm.factory.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "anthropic"
            from app.services.llm.factory import create_provider

            with pytest.raises(ProviderUnavailableError) as exc_info:
                create_provider()
            assert "anthropic" in str(exc_info.value)
            assert "placeholder" in str(exc_info.value)

    def test_unknown_provider_raises_config_error(self):
        from unittest.mock import patch

        with patch("app.services.llm.factory.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "totally_unknown_xyz"
            from app.services.llm.factory import create_provider

            with pytest.raises(ProviderConfigError):
                create_provider()


# ═══════════════════════════════════════════════════════════════════════════════
# API endpoint tests (use the httpx client fixture from conftest)
# ═══════════════════════════════════════════════════════════════════════════════


async def test_get_providers(client: AsyncClient):
    resp = await client.get("/llm/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert "providers" in body
    ids = [p["id"] for p in body["providers"]]
    assert "groq" in ids
    assert "mock" in ids


async def test_get_models_all(client: AsyncClient):
    resp = await client.get("/llm/models")
    assert resp.status_code == 200
    body = resp.json()
    assert "models" in body
    assert len(body["models"]) >= 5


async def test_get_models_filtered(client: AsyncClient):
    resp = await client.get("/llm/models?provider=groq")
    assert resp.status_code == 200
    models = resp.json()["models"]
    assert len(models) >= 2
    for m in models:
        assert "id" in m
        assert "name" in m


async def test_get_models_unknown_provider_empty(client: AsyncClient):
    resp = await client.get("/llm/models?provider=nonexistent")
    assert resp.status_code == 200
    assert resp.json()["models"] == []


async def test_agent_config_options(client: AsyncClient):
    resp = await client.get("/agents/config/options")
    assert resp.status_code == 200
    body = resp.json()
    assert "reasoning_styles" in body
    assert "balanced" in body["reasoning_styles"]
    assert "reasoning_depths" in body
    assert "providers" in body
    assert len(body["providers"]) >= 3


# ═══════════════════════════════════════════════════════════════════════════════
# Debate start with rich config (backward-compat + new format)
# ═══════════════════════════════════════════════════════════════════════════════


async def test_debate_start_minimal_payload_still_works(client: AsyncClient):
    """Legacy minimal payload with just role should still produce 201."""
    payload = {
        "question": "Is water wet?",
        "agents": [{"role": "philosopher"}, {"role": "scientist"}],
    }
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "completed"


async def test_debate_start_rich_config_payload(client: AsyncClient):
    """Rich config payload with model and reasoning settings works."""
    payload = {
        "question": "Should we colonize Mars?",
        "agents": [
            {
                "role": "optimist",
                "config": {
                    "model": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
                    "reasoning": {"style": "creative", "depth": "deep"},
                },
            },
            {
                "role": "realist",
                "config": {
                    "reasoning": {"style": "analytical"},
                },
            },
        ],
    }
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "completed"
    assert "result" in body


async def test_debate_start_rich_config_stored_in_db(client: AsyncClient):
    """The _parsed config is persisted in the agent's JSONB config field."""
    payload = {
        "question": "Test config storage?",
        "agents": [
            {
                "role": "tester",
                "config": {
                    "identity": {"name": "TestBot"},
                    "reasoning": {"style": "critical"},
                },
            },
        ],
    }
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 201
    debate_id = resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    assert get_resp.status_code == 200
    agents = get_resp.json()["agents"]
    assert len(agents) == 1
    config = agents[0]["config"]
    assert "_parsed" in config
    assert config["_parsed"]["identity"]["name"] == "TestBot"
    assert config["_parsed"]["reasoning"]["style"] == "critical"

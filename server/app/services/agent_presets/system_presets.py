"""System (built-in) agent preset definitions.

Stored as constants so users cannot delete them and we don't need to
seed DB rows. The API merges these with the user's persisted presets.
"""

from __future__ import annotations

from typing import Any


def _preset(
    *,
    id: str,
    name: str,
    description: str,
    role_description: str,
    reasoning_style: str,
    reasoning_depth: str,
    rag_mode: str = "shared_session_docs",
    strict_grounding: bool = False,
    provider: str = "openrouter",
    model: str = "anthropic/claude-sonnet-4.5",
    model_preset: str | None = "balanced",
    temperature: float = 0.7,
) -> dict[str, Any]:
    return {
        "id": id,
        "user_id": None,
        "name": name,
        "description": description,
        "type": "system",
        "visibility": "system",
        "role_description": role_description,
        "reasoning_style": reasoning_style,
        "reasoning_depth": reasoning_depth,
        "provider": provider,
        "model": model,
        "model_preset": model_preset,
        "temperature": temperature,
        "rag_mode": rag_mode,
        "document_ids": [],
        "strict_grounding": strict_grounding,
        "is_default": False,
        "is_archived": False,
        "created_at": None,
        "updated_at": None,
    }


SYSTEM_PRESETS: list[dict[str, Any]] = [
    _preset(
        id="system-human-rights-advocate",
        name="Human Rights Advocate",
        description="Argues from human rights, dignity, and ethical principles perspective.",
        role_description="Argues from human rights, dignity, and ethical principles perspective.",
        reasoning_style="balanced",
        reasoning_depth="deep",
    ),
    _preset(
        id="system-security-strategist",
        name="Security Strategist",
        description="Focuses on security, risk assessment, and strategic defense perspectives.",
        role_description="Focuses on security, risk assessment, and strategic defense perspectives.",
        reasoning_style="analytical",
        reasoning_depth="deep",
    ),
    _preset(
        id="system-policy-maker",
        name="Policy Maker",
        description="Evaluates issues from regulatory, governance, and practical implementation standpoints.",
        role_description="Evaluates issues from regulatory, governance, and practical implementation standpoints.",
        reasoning_style="balanced",
        reasoning_depth="normal",
    ),
    _preset(
        id="system-ethicist",
        name="Ethicist",
        description="Analyzes moral dimensions, ethical frameworks, and philosophical implications.",
        role_description="Analyzes moral dimensions, ethical frameworks, and philosophical implications.",
        reasoning_style="analytical",
        reasoning_depth="deep",
    ),
    _preset(
        id="system-devils-advocate",
        name="Devil's Advocate",
        description="Intentionally challenges prevailing arguments to test their strength.",
        role_description="Intentionally challenges prevailing arguments to test their strength.",
        reasoning_style="devil's advocate",
        reasoning_depth="normal",
        rag_mode="no_docs",
    ),
    _preset(
        id="system-knowledge-expert",
        name="Knowledge Expert",
        description="Grounds arguments exclusively in provided documents and evidence.",
        role_description="Grounds arguments exclusively in provided documents and evidence.",
        reasoning_style="analytical",
        reasoning_depth="deep",
        rag_mode="assigned_docs_only",
        strict_grounding=True,
    ),
]


SYSTEM_PRESET_IDS: set[str] = {p["id"] for p in SYSTEM_PRESETS}


def is_system_preset_id(preset_id: str) -> bool:
    return preset_id in SYSTEM_PRESET_IDS


def get_system_preset(preset_id: str) -> dict[str, Any] | None:
    for p in SYSTEM_PRESETS:
        if p["id"] == preset_id:
            return p
    return None

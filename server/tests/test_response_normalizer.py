from __future__ import annotations

import json
import uuid

from app.schemas.contracts import AgentRoundResult
from app.services.debate_engine.response_normalizer import (
    fallback_parse,
    generate_summary,
    normalize_round_output,
    normalize_summary,
)
from app.services.debate_engine.round_manager import _build_round3_digest


def _round1_payload() -> dict[str, object]:
    return {
        "short_summary": "Targeted regulation is justified for high-risk AI systems",
        "stance": "Supports targeted regulation",
        "main_argument": "High-risk systems can produce external harms that markets do not price.",
        "key_points": [
            "Safety-critical failures can affect rights and livelihoods.",
            "Risk-based guardrails preserve innovation while reducing harm.",
            "Auditable requirements improve accountability.",
        ],
        "risks_or_caveats": ["Overly broad regulation can slow low-risk innovation."],
        "response": "I support targeted AI regulation for high-risk systems because external harms may otherwise be ignored.",
    }


def test_normalizer_parses_clean_json() -> None:
    raw = json.dumps(_round1_payload())
    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["stance"] in ("Supports", "Conditional", "Mixed", "Opposes", "Supports targeted regulation")
    assert isinstance(out.payload["key_points"], list)
    assert out.payload["display_content"]
    assert str(out.payload["short_summary"]).endswith((".", "!", "?"))
    assert out.payload["is_fallback"] is False


def test_normalizer_parses_fenced_json() -> None:
    raw = "```json\n" + json.dumps(_round1_payload()) + "\n```"
    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["response"]
    assert out.payload["short_summary"]


def test_normalizer_extracts_json_from_surrounding_text() -> None:
    raw = f"Here is the JSON:\n{json.dumps(_round1_payload())}\nThank you"
    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["main_argument"]
    assert out.payload["response"]
    assert out.payload["is_fallback"] is False


def test_plain_text_uses_fallback_without_failure(caplog) -> None:
    caplog.set_level("WARNING")
    raw = "AI regulation should be risk-based. Broad bans would create avoidable costs."

    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["is_fallback"] is True
    assert out.payload["response"] == raw
    assert out.payload["display_content"] == raw
    assert out.payload["short_summary"] == "AI regulation should be risk-based."
    assert "JSON parse failed -> fallback mode used" in caplog.text


def test_markdown_text_fallback_is_cleaned() -> None:
    raw = "**Final Answer**\n\nGovernments should regulate high-risk AI uses, while leaving low-risk tools flexible."

    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["is_fallback"] is True
    assert "**" not in str(out.payload["response"])
    assert str(out.payload["response"]).startswith("Final Answer")


def test_meta_text_fallback_removes_wrapper() -> None:
    raw = (
        "I need to create a JSON object first. "
        "I'm going to prepare the answer as JSON. "
        "Generating final synthesis now. "
        "The final answer is that regulation should be targeted and evidence-based."
    )

    out = normalize_round_output(round_number=3, raw_text=raw)

    response = str(out.payload["response"]).lower()
    assert out.payload["is_fallback"] is True
    assert "i need to" not in response
    assert "i'm going to" not in response
    assert "generating" not in response
    assert "json" not in response
    assert "targeted and evidence-based" in response


def test_malformed_json_fallback_extracts_readable_field() -> None:
    raw = '{"response":"Use risk-based regulation for high-impact systems.", "short_summary": '

    out = normalize_round_output(round_number=1, raw_text=raw)

    assert out.payload["is_fallback"] is True
    assert out.payload["response"] == "Use risk-based regulation for high-impact systems."
    assert "{" not in str(out.payload["display_content"])
    assert '"response"' not in str(out.payload["display_content"])


def test_round3_plain_text_fallback_keeps_final_answer() -> None:
    raw = (
        "I now support targeted regulation because the debate showed that high-risk systems need enforceable guardrails.\n\n"
        "The strongest argument is that safety-critical AI can create harms that ordinary market incentives will not prevent.\n\n"
        "Remaining concerns include enforcement capacity and the risk of overbroad rules.\n\n"
        "Therefore, the best conclusion is a focused regulatory approach for high-impact uses."
    )

    out = normalize_round_output(round_number=3, raw_text=raw)

    assert out.payload["is_fallback"] is True
    assert out.payload["final_position"] == "I now support targeted regulation because the debate showed that high-risk systems need enforceable guardrails."
    assert out.payload["strongest_argument"] == "The strongest argument is that safety-critical AI can create harms that ordinary market incentives will not prevent."
    assert out.payload["remaining_concerns"] == "Remaining concerns include enforcement capacity and the risk of overbroad rules."
    assert out.payload["conclusion"] == "Therefore, the best conclusion is a focused regulatory approach for high-impact uses."


def test_normalizer_sanitizes_meta_reasoning_text() -> None:
    payload = _round1_payload()
    payload["response"] = (
        "I need to create a JSON object before answering. "
        "Generating JSON synthesis now. "
        "Targeted regulation should focus on high-risk deployment contexts."
    )
    payload["short_summary"] = "Here is the JSON summary"

    out = normalize_round_output(round_number=1, raw_text=json.dumps(payload))

    response = str(out.payload["response"]).lower()
    summary = str(out.payload["short_summary"]).lower()

    assert "i need to" not in response
    assert "generating" not in response
    assert "here is" not in summary
    assert response.endswith((".", "!", "?"))


def test_round3_digest_does_not_include_raw_json_blocks() -> None:
    r1 = AgentRoundResult(
        agent_id=uuid.uuid4(),
        role="Analyst",
        content='{"raw_content":"```json broken```"}',
        structured={
            "short_summary": "The analyst supports targeted safeguards.",
            "stance": "Supports",
            "key_points": ["Guardrails for high-risk contexts."],
            "raw_content": "```json should_not_leak```",
        },
        generation_status="success",
    )
    r2 = AgentRoundResult(
        agent_id=uuid.uuid4(),
        role="Critic",
        content='{"raw_content":"meta"}',
        structured={
            "short_summary": "The critic challenges implementation feasibility.",
            "target_agent": "Analyst",
            "challenge": "The proposal needs clearer enforcement mechanics.",
            "counterargument": "Phased compliance can reduce implementation risk.",
            "raw_content": '{"bad":true}',
        },
        generation_status="success",
    )

    digest = _build_round3_digest(
        question="Should governments regulate AI?",
        round1_results=[r1],
        round2_results=[r2],
    )

    serialized = json.dumps(digest)
    assert "raw_content" not in serialized
    assert "```" not in serialized
    assert "question" in digest
    assert isinstance(digest.get("round1"), list)
    assert isinstance(digest.get("round2"), list)


def test_summary_fallback_builds_complete_sentence() -> None:
    summary = normalize_summary(
        summary="",
        fallback_text="This fallback summary was produced from response text without terminal punctuation",
    )

    assert summary.endswith((".", "!", "?"))
    assert "..." not in summary


def test_generate_summary_never_cuts_complete_sentence() -> None:
    long_sentence = (
        "This complete sentence is intentionally long because it describes a nuanced policy position with many necessary qualifiers, "
        "implementation details, fairness constraints, institutional trade-offs, and practical examples that exceed the target length but still end cleanly."
    )

    summary = generate_summary(f"{long_sentence} Second sentence should not be selected.")

    assert summary == long_sentence
    assert summary.endswith(".")


def test_generate_summary_uses_200_char_fallback_only_without_punctuation() -> None:
    raw = "word " * 80

    summary = generate_summary(raw)

    assert len(summary) <= 201
    assert summary.endswith(".")


def test_direct_fallback_parse_returns_structured_object() -> None:
    out = fallback_parse("Plain usable answer", round_number=2)

    assert out.is_fallback is True
    assert out.payload["is_fallback"] is True
    assert out.payload["short_summary"] == "Plain usable answer."
    assert out.payload["target_agent"] == "General position"

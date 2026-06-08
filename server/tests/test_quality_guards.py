"""Tests for the debate quality + prompt-leak guards (quality_guards)."""

from __future__ import annotations

from app.services.debate_engine.quality_guards import (
    ArgumentQualityValidator,
    CritiqueQualityValidator,
    PromptLeakValidator,
    SynthesisQualityValidator,
    evaluate_round_quality,
)


# ── PromptLeakValidator ───────────────────────────────────────────────────────

def test_leak_detects_schema_field_name_in_value():
    payload = {"response": "First I will fill the one_sentence_takeaway field, then..."}
    issues = PromptLeakValidator.validate(payload)
    assert any(i.code == "leak_schema_field" for i in issues)


def test_leak_detects_output_contract():
    payload = {"response": "Per the output contract, I must return JSON object only."}
    issues = PromptLeakValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "leak_output_contract" in codes
    assert "leak_json_schema" in codes


def test_leak_detects_persona_and_meta_process():
    payload = {
        "main_argument": "My persona is the Analyst, so I need to produce a JSON response now.",
    }
    issues = PromptLeakValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "leak_persona_meta" in codes
    assert "leak_meta_process" in codes


def test_leak_detects_round_objective_and_as_an_ai():
    payload = {"response": "Round 1 objective: as an AI, here is the JSON."}
    issues = PromptLeakValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "leak_round_objective" in codes
    assert "leak_as_an_ai" in codes
    assert "leak_here_is_json" in codes


def test_clean_answer_has_no_leak():
    payload = {
        "response": (
            "Governments should impose risk-tiered licensing on frontier AI labs "
            "because market incentives do not absorb catastrophic downstream harm. "
            "Concretely, compute thresholds above 10^25 FLOPs concentrate oversight "
            "where errors are most damaging, while liability rules realign incentives."
        ),
        "stance": "Supports",
        "one_sentence_takeaway": "Targeted licensing of frontier labs beats blanket rules because it concentrates oversight.",
    }
    assert PromptLeakValidator.validate(payload) == []


def test_schema_key_names_are_not_scanned():
    # The KEY is one_sentence_takeaway but its VALUE is clean -> no leak.
    payload = {
        "one_sentence_takeaway": "Carbon pricing outperforms subsidies because it internalizes externalities directly.",
        "short_summary": "Carbon pricing outperforms subsidies because it internalizes externalities directly.",
    }
    assert PromptLeakValidator.validate(payload) == []


# ── ArgumentQualityValidator ──────────────────────────────────────────────────

def test_argument_flags_short_and_missing_stance():
    payload = {"response": "Yes, I agree.", "main_argument": ""}
    issues = ArgumentQualityValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "quality_too_short" in codes
    assert "quality_no_stance" in codes
    assert "quality_no_argument" in codes


def test_argument_passes_for_full_statement():
    payload = {
        "response": " ".join(["word"] * 80),
        "stance": "Opposes",
        "main_argument": "Pre-deployment licensing imposes audit costs small labs cannot absorb.",
        "key_points": ["a", "b"],
    }
    assert ArgumentQualityValidator.validate(payload) == []


# ── CritiqueQualityValidator ──────────────────────────────────────────────────

def test_critique_flags_missing_assumption_and_target():
    payload = {"response": "This argument is weak and needs more evidence."}
    issues = CritiqueQualityValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "quality_no_target" in codes
    assert "quality_no_assumption" in codes
    assert "quality_no_counter" in codes


def test_critique_passes_when_structured():
    payload = {
        "target_agent": "Analyst",
        "challenge": "Claims licensing is costless to enforce.",
        "assumption_attacked": "That regulators have perfect information about model risk.",
        "why_it_breaks": "Regulators lag frontier capability by 12-18 months.",
        "counterargument": "Liability rules adapt faster than ex-ante audits.",
    }
    assert CritiqueQualityValidator.validate(payload) == []


# ── SynthesisQualityValidator ─────────────────────────────────────────────────

def test_synthesis_flags_missing_winner_and_neutral():
    payload = {
        "final_position": "It depends on the context and both sides have merit.",
    }
    issues = SynthesisQualityValidator.validate(payload)
    codes = {i.code for i in issues}
    assert "quality_no_winner" in codes
    assert "quality_neutral" in codes


def test_synthesis_passes_for_decisive_conclusion():
    payload = {
        "final_position": "Risk-tiered licensing is the correct policy.",
        "winning_argument": "Concentrating oversight on frontier labs maximizes safety per dollar.",
        "policy_direction": "Adopt compute-threshold licensing with third-party audits.",
        "conclusion": "Adopt risk-tiered licensing.",
    }
    assert SynthesisQualityValidator.validate(payload) == []


# ── Dispatch ──────────────────────────────────────────────────────────────────

def test_evaluate_round_quality_dispatches_and_flags_leak():
    payload = {
        "response": "I need to produce a JSON object for the output contract.",
        "stance": "Mixed",
        "main_argument": "x",
    }
    report = evaluate_round_quality(round_number=1, round_type="initial", payload=payload)
    assert report.has_leak is True
    assert "leak_output_contract" in report.leak_codes


def test_evaluate_round_quality_clean_round3():
    payload = {
        "final_position": "Carbon pricing should be adopted nationally.",
        "winning_argument": "It internalizes externalities at lowest administrative cost.",
        "policy_direction": "Phase in a revenue-neutral carbon tax over five years.",
        "one_sentence_takeaway": "A revenue-neutral carbon tax is the most efficient decarbonization lever available.",
    }
    report = evaluate_round_quality(round_number=3, round_type="final", payload=payload)
    assert report.ok is True
    assert report.has_leak is False

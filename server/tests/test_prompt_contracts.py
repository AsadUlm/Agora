from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt
from app.services.debate_engine.prompts.round_critique_response_prompts import build_critique_response_prompt
from app.services.debate_engine.prompts.round_revised_position_prompts import build_revised_position_prompt
from app.services.debate_engine.prompts.synthesis_verdict_prompts import build_synthesis_verdict_prompt
from app.services.debate_engine.prompts.followup_prompts import (
    build_followup_critique_prompt,
    build_followup_critique_response_prompt,
    build_followup_response_prompt,
    build_followup_revised_position_prompt,
    build_updated_synthesis_prompt,
)


def test_round1_prompt_requires_short_summary_schema() -> None:
    prompt = build_opening_statement_prompt(
        role="analyst",
        question="Should cities ban private cars from downtown?",
    )

    assert '"short_summary"' in prompt
    assert "Return only valid JSON" in prompt
    assert "Do not mention JSON" in prompt
    assert '"I need to create a JSON object..."' in prompt
    assert '"main_argument"' in prompt
    assert '"risks_or_caveats"' in prompt
    assert '"response"' in prompt


def test_round2_prompt_requires_normalized_critique_schema() -> None:
    prompt = build_critique_prompt(
        role="critic",
        question="Should cities ban private cars from downtown?",
        own_stance="A phased ban is better than an immediate ban.",
        other_agents=[
            {
                "role": "analyst",
                "stance": "Ban quickly.",
                "key_points": ["Lower emissions", "Improve safety"],
            }
        ],
    )

    assert '"short_summary"' in prompt
    assert '"target_agent"' in prompt
    assert '"target_claim"' in prompt
    assert "Your critique target is analyst" in prompt
    assert "Return only valid JSON" in prompt
    assert "Do not mention JSON" in prompt
    assert "The target response was unavailable" in prompt
    assert '"challenge"' in prompt
    assert '"weakness_found"' in prompt
    assert '"counterargument"' in prompt
    assert '"response"' in prompt


def test_stage3_and_stage4_traceability_contracts() -> None:
    stage3 = build_critique_response_prompt(
        role="Innovation Strategist",
        question="Should AI be regulated?",
        own_initial_position="Prefer proportional rules.",
        critiques_received=[{"from_role": "Policy Analyst", "challenge": "Rules may be too weak."}],
    )
    stage4 = build_revised_position_prompt(
        role="Innovation Strategist",
        question="Should AI be regulated?",
        initial_position="Prefer proportional rules.",
        initial_key_claims=[],
        critiques_received=[],
        critique_response=None,
    )
    assert '"responding_to_agent"' in stage3
    assert '"challenge_received"' in stage3
    assert '"revised_position"' in stage4
    assert '"change_label"' in stage4


def test_moderator_prompt_has_recommended_answer_and_tradeoffs() -> None:
    prompt = build_synthesis_verdict_prompt(
        original_question="Should AI be regulated?",
        cycle_number=1,
        round_type="final",
        agent_syntheses=[],
    )
    assert '"recommended_answer"' in prompt
    assert '"tradeoffs"' in prompt


def test_followup_prompts_match_extended_backend_pipeline() -> None:
    common = {
        "role": "Policy Analyst",
        "original_question": "Should AI be regulated?",
        "follow_up_question": "How should startup burdens be limited?",
        "previous_synthesis": "Use targeted rules.",
    }
    response = build_followup_response_prompt(
        **common, own_previous_position="Use targeted rules.", own_key_arguments=[]
    )
    critique = build_followup_critique_prompt(
        **common, own_followup="Use staged compliance.", other_followups=[]
    )
    critique_response = build_followup_critique_response_prompt(
        **common, own_followup_response="Use staged compliance.", critiques_received=[]
    )
    revised = build_followup_revised_position_prompt(
        **common,
        initial_followup_position="Use staged compliance.",
        critiques_received=[],
        critique_response=None,
    )
    synthesis = build_updated_synthesis_prompt(
        **common, followup_responses=[], followup_critiques=[]
    )

    assert "followup_answer" in response
    assert "target_claim" in critique
    assert "responding_to_agent" in critique_response
    assert "change_label" in revised
    assert "recommended_answer" in synthesis


def test_round3_prompt_requires_final_schema_with_response() -> None:
    prompt = build_final_synthesis_prompt(
        role="ethicist",
        question="Should cities ban private cars from downtown?",
        original_stance="A strict ban can be inequitable without transit upgrades.",
        debate_digest='{"question":"Q","round1":[],"round2":[]}',
    )

    assert '"short_summary"' in prompt
    assert "Return only valid JSON" in prompt
    assert "Do not mention JSON" in prompt
    assert "Do NOT describe your process" in prompt
    assert "Write like a final conclusion for a human reader" in prompt
    assert "Take a strong final stance" in prompt
    assert "Synthesize across the agents" in prompt
    assert '"final_position"' in prompt
    assert '"what_changed"' in prompt
    assert '"strongest_argument"' in prompt
    assert '"remaining_concerns"' in prompt
    assert '"conclusion"' in prompt
    assert '"response"' in prompt

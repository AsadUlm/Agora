from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt


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
    assert "Return only valid JSON" in prompt
    assert "Do not mention JSON" in prompt
    assert "The target response was unavailable" in prompt
    assert '"challenge"' in prompt
    assert '"weakness_found"' in prompt
    assert '"counterargument"' in prompt
    assert '"response"' in prompt


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

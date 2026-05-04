from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt


def test_round1_prompt_requires_short_summary_schema() -> None:
    prompt = build_opening_statement_prompt(
        role="analyst",
        question="Should cities ban private cars from downtown?",
    )

    assert '"short_summary"' in prompt
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
    assert '"target_role"' in prompt
    assert '"challenge"' in prompt
    assert '"weakness_found"' in prompt
    assert '"counterargument"' in prompt
    assert '"response"' in prompt


def test_round3_prompt_requires_final_schema_with_response() -> None:
    prompt = build_final_synthesis_prompt(
        role="ethicist",
        question="Should cities ban private cars from downtown?",
        original_stance="A strict ban can be inequitable without transit upgrades.",
        debate_summary="Agents challenged both speed and fairness trade-offs.",
    )

    assert '"short_summary"' in prompt
    assert '"final_position"' in prompt
    assert '"what_changed"' in prompt
    assert '"remaining_concerns"' in prompt
    assert '"conclusion"' in prompt
    assert '"response"' in prompt

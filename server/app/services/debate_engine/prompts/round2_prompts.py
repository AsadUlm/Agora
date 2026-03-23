"""Prompt builders for Round 2 — Cross-Examination / Direct Debate."""


def build_cross_debate_prompt(
    challenger_role: str,
    responder_role: str,
    challenger_stance: str,
    responder_stance: str,
    question: str,
) -> str:
    """
    Construct the prompt for a cross-examination exchange between two conflicting agents.

    Args:
        challenger_role:   Role of the agent initiating the challenge.
        responder_role:    Role of the agent being challenged.
        challenger_stance: Challenger's opening stance from Round 1.
        responder_stance:  Responder's opening stance from Round 1.
        question:          The central debate question.

    Returns:
        A fully rendered prompt string ready to be sent to the LLM.
    """
    return f"""RESPONSE FORMAT
- Respond with a SINGLE valid JSON object.
- No markdown. No code fences. No text before or after the JSON.
- Do not include comments inside the JSON.

ROLE
You are moderating a cross-examination round in a structured AI debate.

DEBATE QUESTION
"{question}"

PARTICIPANT STANCES (Round 1)
- {challenger_role}: "{challenger_stance}"
- {responder_role}: "{responder_stance}"

TASK
These two positions conflict. Generate the cross-examination exchange:
{{
    "challenger_role": "{challenger_role}",
    "responder_role": "{responder_role}",
    "challenge": "<Specific critique the {challenger_role} raises against the {responder_role}'s position>",
    "response": "<The {responder_role}'s direct, substantive response to the challenge>",
    "rebuttal": "<The {challenger_role}'s closing rebuttal after hearing the response>"
}}

CONSTRAINTS
- Each field: single coherent paragraph, 2–4 sentences.
- Base arguments on the stances provided above.
- Output the JSON object and nothing else."""


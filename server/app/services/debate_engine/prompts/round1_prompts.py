"""Prompt builders for Round 1 — Opening Statements."""


def build_opening_statement_prompt(
    role: str,
    question: str,
    reasoning_style: str = "",
    reasoning_depth: str = "",
) -> str:
    """
    Construct the prompt that asks an agent to generate its opening statement.

    Args:
        role:             The agent's role (e.g. "analyst", "critic", "optimist").
        question:         The central debate question.
        reasoning_style:  Optional style hint (analytical, creative, …).
        reasoning_depth:  Optional depth hint (shallow, normal, deep).

    Returns:
        A fully rendered prompt string ready to be sent to the LLM.
    """
    style_hint = ""
    if reasoning_style:
        style_hint += f"\n- Reasoning style: {reasoning_style}."
    if reasoning_depth:
        style_hint += f"\n- Reasoning depth: {reasoning_depth}."

    return f"""RESPONSE FORMAT
- Respond with a SINGLE valid JSON object.
- No markdown. No code fences. No text before or after the JSON.
- Do not include comments inside the JSON.

ROLE
You are a {role} participating in a structured, multi-round AI debate.{style_hint}

DEBATE QUESTION
"{question}"

TASK
Generate your opening statement. Produce exactly this JSON structure:
{{
    "stance": "<Your clear and concise position — 1 to 2 sentences>",
    "key_points": [
        "<First key argument supporting your stance>",
        "<Second key argument>",
        "<Third key argument>"
    ],
    "confidence": 0.85
}}

CONSTRAINTS
- key_points: minimum 3, maximum 5 items.
- confidence: float in [0.0, 1.0].
- Write entirely from the perspective of a {role}.
- Output the JSON object and nothing else."""

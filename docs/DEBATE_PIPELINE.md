# AGORA Debate Pipeline

## Overview

AGORA implements a 5-stage traceable multi-agent debate pipeline. Every debate produces a structured trace that allows evaluators to verify that a real debate happened, with explicit cross-critiques, responses, and position revisions.

## Pipeline Stages

```
User Question
     │
     ▼
Round 1 — Initial Positions
     │  Each agent independently produces its initial stance.
     │
     ▼
Round 2 — Cross-Critiques
     │  Each agent critiques one or more other agents.
     │  Critiques include: target claim, weakness, hidden assumption, failure scenario.
     │
     ▼
Round 3 — Responses to Critiques
     │  Each agent receives critiques about its own position.
     │  Agents must explicitly: accept/reject specific points, explain why.
     │
     ▼
Round 4 — Revised Positions
     │  Each agent updates (or explicitly holds) its position.
     │  Must include: what changed, what stayed the same, why.
     │
     ▼
Round 5 — Final Synthesis
     │  Based primarily on revised positions.
     │  Includes debate impact summary.
     │
     ▼
Debate Trace + Impact Summary
```

## Stage Details

### Round 1: Initial Positions

**Each agent receives:**

- User question
- Agent role description
- Optional RAG context documents
- Instruction to take a clear role-consistent stance

**Output fields:**

- `content` / `response` — full position text
- `short_summary` — 1-2 sentence summary
- `main_argument` — core argument
- `key_points` — bullet-point claims
- `assumptions` — stated assumptions
- `confidence` — low/medium/high

**Key rule:** Agents must NOT produce neutral summaries in Round 1. They must take a clear, role-defined stance and maximize viewpoint diversity.

---

### Round 2: Cross-Critiques

**Each agent receives:**

- Their own Round 1 position
- Other agents' Round 1 positions
- Critique format instructions

**Output fields:**

- `target_agent` — the agent being critiqued (role string)
- `challenge` — specific claim being challenged
- `assumption_attacked` — hidden assumption of the target claim
- `failure_scenario` — realistic case where the assumption fails
- `why_it_breaks` — consequence of assumption failure
- `weakness_found` — core weakness
- `short_summary` — 1-2 sentence critique summary
- `response` — full critique prose

**Key rule:** Critiques must identify a CONCRETE weakness, not produce generic "I agree but..." responses.

---

### Round 3: Responses to Critiques

**Each agent receives:**

- Its own Round 1 position
- All critiques directed at it from Round 2
- Instructions to explicitly accept/reject specific points

**Output fields:**

- `received_critique_summary` — what critiques were received
- `response` — full response prose
- `accepted_points` — list of accepted critique points with reasons
- `rejected_points` — list of rejected critique points with counter-reasons
- `planned_revision` — what will change in Round 4 (or explicit "no change")
- `stance_update` — unchanged | slightly_revised | significantly_revised | reversed

---

### Round 4: Revised Positions

**Each agent receives:**

- Initial position
- Key claims from Round 1
- Critiques received in Round 2
- Its own critique response from Round 3
- Optional: other agents' emerging revised positions

**Output fields:**

- `initial_position_summary` — 1-2 sentence Round 1 summary
- `received_critiques_summary` — list of critique summaries
- `revised_position` — updated position
- `change_summary` — what changed (or explicit "nothing changed because...")
- `changed` — boolean
- `change_type` — no_change | narrowed_position | expanded_position | changed_stance | added_condition | resolved_uncertainty | other
- `reason_for_change` — specific argument/critique that caused change
- `key_claims` — updated key claims
- `remaining_uncertainties` — unresolved concerns

---

### Round 5: Final Synthesis

**Receives:**

- User question
- All initial positions (Round 1)
- All critiques (Round 2)
- All revised positions (Round 4) — primary input
- Debate digest summary

**Output fields:**

- `one_sentence_takeaway` — final position in 15-25 words
- `final_position` — full synthesized answer
- `position_update` — Strengthened | Refined | Partially Revised | Reversed
- `what_changed` — what changed after the critique round
- `winning_argument` — argument that prevailed
- `losing_argument` — strongest argument that did not prevail
- `response` — full synthesis essay

**Moderator Synthesis Verdict:**
After the agent syntheses, a neutral moderator produces a `synthesis_verdict` that aggregates all agent positions into a final user-facing answer.

---

## Debate Trace Schema

Each debate produces a `DebateTrace` object containing:

```json
{
  "critiques": [...],           // Round 2: from_agent → to_agent critique items
  "critique_responses": [...],  // Round 3: per-agent critique responses
  "revised_positions": [...],   // Round 4: per-agent revised positions with change tracking
  "debate_impact": {
    "initial_consensus": "...",
    "major_disagreements": [...],
    "important_changes": [...], // agents who changed their position
    "how_debate_improved_answer": "...",
    "single_llm_risk_avoided": "..."
  }
}
```

See `DEBATE_TRACE_SCHEMA.md` for the full field-by-field documentation.

---

## Backward Compatibility

Old debates (3-round pipeline) still render correctly:

- `debate_trace` is `null` for old debates
- The frontend falls back to rendering from raw round messages
- The Debate History tab shows appropriate "older pipeline" notices

## Token Budget

| Round | Type              | Max Tokens |
| ----- | ----------------- | ---------- |
| 1     | initial           | 2000       |
| 2     | critique          | 2200       |
| 3     | critique_response | 2000       |
| 4     | revised_position  | 2200       |
| 5     | final             | 2500       |
| —     | synthesis_verdict | 2000       |

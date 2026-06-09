# AGORA Debate Trace Schema

## Overview

The `DebateTrace` is a structured object attached to every `TurnDTO` when the debate was run using the 5-stage pipeline. It provides explicit traceability: who criticized whom, what changed, and why.

## Backend Model (Pydantic)

### DebateTrace

```python
class DebateTrace(BaseModel):
    critiques: list[CritiqueTraceItem] = []
    critique_responses: list[CritiqueResponseTraceItem] = []
    revised_positions: list[RevisedPositionTraceItem] = []
    debate_impact: DebateImpact | None = None
```

---

### CritiqueTraceItem

One critique edge: `from_agent → to_agent`.

| Field              | Type | Description                     |
| ------------------ | ---- | ------------------------------- |
| `id`               | str  | Message UUID                    |
| `from_agent_id`    | str  | UUID of critiquing agent        |
| `from_agent_name`  | str  | Role of critiquing agent        |
| `to_agent_id`      | str  | UUID of target agent            |
| `to_agent_name`    | str  | Role of target agent            |
| `target_claim`     | str  | Specific claim being challenged |
| `critique_summary` | str  | 1-2 sentence critique summary   |
| `weakness_found`   | str  | Core weakness identified        |
| `severity`         | str  | low / medium / high             |

---

### CritiqueResponseTraceItem

One agent's response to critiques received.

| Field                       | Type      | Description                                                     |
| --------------------------- | --------- | --------------------------------------------------------------- |
| `id`                        | str       | Message UUID                                                    |
| `agent_id`                  | str       | UUID of responding agent                                        |
| `agent_name`                | str       | Role of responding agent                                        |
| `received_critique_summary` | str       | Summary of critiques received                                   |
| `response`                  | str       | Full prose response                                             |
| `accepted_points`           | list[str] | Points accepted from critiques                                  |
| `rejected_points`           | list[str] | Points rejected with counter-reasons                            |
| `planned_revision`          | str       | What will change in revised position                            |
| `stance_update`             | str       | unchanged / slightly_revised / significantly_revised / reversed |

---

### RevisedPositionTraceItem

One agent's revised position with explicit change tracking.

| Field                      | Type      | Description                                       |
| -------------------------- | --------- | ------------------------------------------------- |
| `id`                       | str       | Message UUID                                      |
| `agent_id`                 | str       | UUID of agent                                     |
| `agent_name`               | str       | Role of agent                                     |
| `initial_position_summary` | str       | Round 1 position summary                          |
| `revised_position`         | str       | Updated position                                  |
| `change_summary`           | str       | What changed (or explicit "no change because...") |
| `changed`                  | bool      | True if position changed                          |
| `change_type`              | str       | See change types below                            |
| `reason_for_change`        | str       | Specific critique/argument that caused change     |
| `key_claims`               | list[str] | Updated key claims                                |

**Change types:**

- `no_change` — position held, with explicit reason
- `narrowed_position` — scope reduced
- `expanded_position` — scope broadened
- `changed_stance` — fundamental stance changed
- `added_condition` — original stance now has a condition
- `resolved_uncertainty` — previous uncertainty resolved
- `other` — other type of change

---

### DebateImpact

Summary of how the debate affected the final answer.

| Field                        | Type                  | Description                                         |
| ---------------------------- | --------------------- | --------------------------------------------------- |
| `initial_consensus`          | str                   | Brief description of initial agreement/disagreement |
| `major_disagreements`        | list[str]             | Key disagreements that emerged                      |
| `important_changes`          | list[ImportantChange] | Agents that changed their position                  |
| `how_debate_improved_answer` | str                   | Human-readable explanation of debate value          |
| `single_llm_risk_avoided`    | str                   | Explanation of multi-agent advantage                |

### ImportantChange

| Field         | Type | Description                |
| ------------- | ---- | -------------------------- |
| `agent_id`    | str  | UUID of agent              |
| `agent_name`  | str  | Role of agent              |
| `before`      | str  | Initial position summary   |
| `after`       | str  | Revised position summary   |
| `why_changed` | str  | Specific reason for change |

---

## Frontend TypeScript Types

```typescript
interface DebateTrace {
  critiques: CritiqueTraceItem[];
  critique_responses: CritiqueResponseTraceItem[];
  revised_positions: RevisedPositionTraceItem[];
  debate_impact: DebateImpact | null;
}

interface CritiqueTraceItem {
  id: string;
  from_agent_id: string;
  from_agent_name: string;
  to_agent_id: string;
  to_agent_name: string;
  target_claim: string;
  critique_summary: string;
  weakness_found: string;
  severity?: string;
}
// etc.
```

All types are defined in `client/src/features/debate/api/debate.types.ts`.

---

## Availability

- `debate_trace` is non-null only for debates run with the 5-stage pipeline.
- For legacy 3-round debates, `debate_trace` is `null`.
- Frontend components fall back gracefully to rendering from raw round messages.
- The `TurnDTO.debate_trace` field is computed by `_build_debate_trace()` in `server/app/schemas/serializers.py`.

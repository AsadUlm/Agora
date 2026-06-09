# Current Debate Process and Workspace UI Report

**Project:** AGORA  
**Report language:** English  
**State reviewed:** June 9, 2026

## 1. Executive Summary

AGORA currently runs the initial debate as a **five-stage pipeline**. The stages are executed in sequence, while participating agents can generate their answers in parallel inside an individual stage.

The workspace no longer exposes every technical stage as a separate top-level concept. Instead, the user interface presents the five stages as **three understandable phases**:

| User-facing phase | Internal stages |
|---|---|
| Phase 1: Opening Positions | Stage 1 |
| Phase 2: Debate Exchange | Stages 2, 3, and 4 |
| Phase 3: Final Decision | Stage 5 |

The right sidebar has also been simplified. Several older tabs were merged into four focused tabs:

1. **Overview**
2. **Debate Process**
3. **Follow-up** - visible only after at least one follow-up cycle exists
4. **Debug**

This design keeps the real five-stage lifecycle visible where precision matters, while making the normal reading experience easier to understand.

---

## 2. Current Initial Debate Pipeline

### 2.1 Stage 1: Initial Positions

Each agent independently analyzes the original question and produces an initial position.

Typical output includes:

- the agent's main argument;
- supporting points;
- assumptions and uncertainties;
- an initial recommendation or stance.

This stage establishes the baseline used to measure how each position changes during the debate.

### 2.2 Stage 2: Cross-Critiques

Agents inspect the initial positions and challenge claims made by other agents.

The system records structured critique relationships, including:

- which agent made the critique;
- which agent or claim was challenged;
- the identified weakness;
- the critique summary.

These relationships become challenge edges and argument chains in the graph and the Debate Process tab.

### 2.3 Stage 3: Responses to Critiques

Each agent responds to the critiques directed at its position.

The response can explicitly identify:

- accepted points;
- rejected points;
- defenses and clarifications;
- planned revisions.

This stage makes the exchange traceable instead of showing only disconnected answers.

### 2.4 Stage 4: Revised Positions

After considering the critique exchange, each agent publishes a revised position.

The structured result indicates whether the position:

- changed;
- partially changed;
- became stronger or more specific;
- remained unchanged.

It also explains the reason for the change or for maintaining the original position.

### 2.5 Stage 5: Final Synthesis

The final stage uses the revised positions from Stage 4.

It contains two levels:

1. participating agents generate synthesis-oriented results;
2. a separate moderator verdict consolidates the debate into the final decision.

The moderator verdict may include the conclusion, consensus, trade-offs, unresolved questions, confidence, and other synthesis metadata.

---

## 3. Execution and Lifecycle Rules

### 3.1 Sequential Stages, Parallel Agents

The five stages are sequential:

```text
Initial Positions
    -> Cross-Critiques
    -> Responses to Critiques
    -> Revised Positions
    -> Final Synthesis
```

Within one stage, agent requests can run concurrently, subject to the configured concurrency limit.

For `N` agents, the normal minimum number of LLM calls for the initial debate is:

```text
5N + 1
```

The additional call is the moderator verdict after the agents' Stage 5 synthesis work.

### 3.2 Partial Completion

The lifecycle supports partial results instead of treating every generation problem as a fatal debate failure.

Important statuses include:

- turn: `queued`, `running`, `partially_completed`, `completed`, `failed`, `cancelled`;
- stage/round: `waiting`, `running`, `partially_completed`, `completed`, `failed`, `skipped`;
- synthesis: `pending`, `running`, `completed`, `failed`, `skipped`;
- stream: `interrupted`.

If one agent fails but other agents succeed, the stage can be marked `partially_completed` and the debate can continue when enough usable results remain.

If the agent stages succeed but final synthesis fails:

- the debate becomes `partially_completed`, not fully failed;
- existing graph nodes and agent responses remain available;
- the UI shows a synthesis-specific warning;
- the user can reload saved status or retry the failed synthesis when supported.

If all agents fail in a required stage and no usable result remains, the debate is marked `failed`.

### 3.3 Stream Interruption Reconciliation

A WebSocket or SSE close does not independently mean that the backend debate failed.

During an interruption, the UI derives an `interrupted` state and shows:

```text
Connection interrupted: Checking saved status...
```

The frontend reloads the persisted REST snapshot before displaying a fatal state. A fatal failure is shown only when the backend snapshot confirms it.

### 3.4 Shared Frontend Lifecycle State

`deriveDebateViewState(...)` is the single source of truth for user-facing lifecycle state. It derives:

- the top lifecycle banner;
- the status badge;
- the visible current stage;
- timeline state;
- graph state;
- overview state;
- progress;
- retry and reload availability;
- structured error information.

This prevents the graph, timeline, banner, and overview from independently reaching contradictory conclusions.

---

## 4. Three-Phase Presentation Model

The UI groups the technical stages into three phases for readability.

### Phase 1: Opening Positions

Contains:

- Stage 1: Initial Positions.

User purpose:

- understand what each agent believed before the debate exchange began.

### Phase 2: Debate Exchange

Contains:

- Stage 2: Cross-Critiques;
- Stage 3: Responses to Critiques;
- Stage 4: Revised Positions.

User purpose:

- see who challenged whom;
- inspect how agents answered challenges;
- determine whether the exchange changed any positions.

### Phase 3: Final Decision

Contains:

- Stage 5: Final Synthesis.

User purpose:

- read the final answer and moderator verdict;
- understand consensus, trade-offs, and remaining disagreement.

The three-phase model is only a presentation layer. The backend lifecycle, stored rounds, progress calculation, and debug information continue to use the real five-stage pipeline.

---

## 5. Follow-up Debate Cycles

A follow-up question does not repeat the full five-stage initial debate. It creates a new three-round follow-up cycle:

1. `followup_response` - agents answer the follow-up question;
2. `followup_critique` - agents challenge the weakest follow-up responses;
3. `updated_synthesis` - the system produces an updated synthesis and moderator verdict.

The logical order remains response, critique, then updated synthesis. The current runner optimizes execution by starting follow-up critiques after enough successful responses are ready, while the remaining responses can continue in parallel. Updated synthesis waits for the required response and critique work.

Cycle 1 is the original five-stage debate. Follow-up cycles begin at cycle 2.

Therefore:

- the first follow-up adds rounds 6, 7, and 8;
- each additional follow-up adds three more rounds;
- the Follow-up tab compares synthesis evolution across cycles.

For `N` agents, each normal follow-up cycle requires at least:

```text
3N + 1
```

LLM calls, including the moderator verdict.

After `F` follow-up cycles, the total stored round count is:

```text
5 + 3F
```

---

## 6. Current Workspace Layout

### 6.1 Desktop Layout

The desktop workspace uses a three-column layout:

| Area | Purpose |
|---|---|
| Left | Phase and stage timeline, plus cycle navigation |
| Center | Debate graph, follow-up input, and node detail drawer |
| Right | Consolidated insight tabs |

The top topic bar and bottom playback bar span the workspace.

### 6.2 Top Topic Bar

The top bar shows:

- navigation back to all debates;
- the AGORA identity;
- the debate question;
- the shared derived lifecycle status;
- the current stage;
- active relationship narration while running;
- agent count;
- evidence or reasoning-only mode.

The question can be opened in a dialog when the truncated title is not sufficient.

### 6.3 Left Timeline

The left timeline is organized into the three user-facing phases.

Each phase card:

- shows its overall state;
- reports completed stage counts;
- can expand to show individual stages;
- uses the same derived lifecycle state as the rest of the interface.

The timeline also includes cycle navigation when follow-up cycles exist.

### 6.4 Center Graph

The center area displays the debate as a graph of generated argument nodes and relationships.

Graph relationships include:

- challenge;
- support;
- inquiry;
- synthesis.

Partial completion preserves available graph content. A failed final synthesis does not erase successful agent nodes.

The center column also contains:

- the follow-up input;
- the node detail drawer;
- visual playback and progressive node reveal behavior.

### 6.5 Bottom Playback Bar

The playback bar shows:

- the current shared lifecycle or stage label;
- a progress bar;
- live generation narration;
- generated, shown, and queued node counts;
- pause, auto-play, and next-node controls while generation is active;
- a relationship legend.

Its color and message change consistently for completed, partially completed, and failed debates.

### 6.6 Mobile Layout

On mobile:

- the graph remains the main full-screen workspace;
- the timeline opens as a **Stages** bottom sheet;
- the right sidebar opens as an **Insights** full-height sheet;
- the follow-up input, node drawer, top bar, lifecycle banner, and playback bar remain available.

---

## 7. Redesigned Right Sidebar Tabs

### 7.1 Overview

Overview is the default tab and the main reading surface.

While the debate is running, it shows:

- live phase and stage status;
- the active agent;
- activity messages;
- the five-stage live tracker.

After completion or partial completion, it shows:

- the three-phase process summary;
- debating agent summary;
- debate exchange highlights;
- the narrative debate story;
- the compact five-stage pipeline;
- the final answer when available;
- navigation links to deeper views.

Partial results remain visible under a warning instead of being replaced by a generic fatal screen.

### 7.2 Debate Process

Debate Process merges the older separate **Debate Flow** and **Changes** views.

It contains an internal two-option switcher:

#### Argument Exchange

Shows full argument chains:

```text
Initial Claim -> Critique -> Response -> Revised Position
```

It also provides chronological stage detail for the exchange.

#### Position Evolution

Shows each agent's before-and-after position, including:

- initial position;
- critiques received;
- response to critiques;
- revised position;
- reason for change;
- a readable change label such as Changed, Partially changed, Strengthened, or Unchanged.

### 7.3 Follow-up

The Follow-up tab appears only when at least one follow-up exists.

Behavior:

- a badge shows the number of follow-ups;
- the sidebar automatically switches to this tab when the first follow-up appears;
- it falls back to Overview if follow-up data disappears.

The tab displays synthesis evolution across the original debate and all follow-up cycles, including:

- the question for each cycle;
- whether the conclusion shifted;
- previous and new positions;
- reasons for the shift;
- confidence;
- consensus;
- trade-offs;
- unresolved questions;
- moderator verdicts.

### 7.4 Debug

Debug replaces the old Raw tab as the developer-oriented inspection area.

It provides:

- lifecycle debug metadata;
- raw structured payloads by stage;
- parse-status badges and warnings;
- copyable JSON;
- follow-up rounds grouped by cycle.

The lifecycle debug block includes:

- debate ID;
- backend status;
- derived frontend status;
- current stage;
- last event and timestamp;
- request ID;
- error code and failed phase;
- successful and failed agents;
- partial-results flag;
- retryable flag.

### 7.5 Removed or Merged Tabs

The older top-level tabs are no longer exposed separately:

- Debate Flow;
- Changes;
- Guide;
- Cycles;
- Agents;
- Raw.

Their useful content was merged into Overview, Debate Process, Follow-up, or Debug.

### 7.6 Responsive Sidebar Widths

On desktop, the sidebar width changes according to the selected tab:

| Tab | Width |
|---|---|
| Overview | `clamp(240px, 30vw, 520px)` |
| Debate Process | `clamp(240px, 32vw, 560px)` |
| Follow-up | `clamp(200px, 28vw, 460px)` |
| Debug | `clamp(155px, 23vw, 380px)` |

This gives content-heavy tabs more room while keeping Debug compact.

---

## 8. Typical User Journeys

### 8.1 Running Debate

1. The top bar shows `RUNNING` and the active stage.
2. The left timeline highlights the active phase and stage.
3. The graph progressively receives and reveals nodes.
4. Overview shows live activity and the five-stage tracker.
5. The playback bar reports progress and generation narration.

### 8.2 Successfully Completed Debate

1. All five stages become complete.
2. The graph remains fully visible.
3. Overview presents the three-phase summary and final answer.
4. Debate Process exposes the traceable argument exchange and position evolution.
5. The progress bar reaches 100%.

### 8.3 Final Synthesis Failure

1. Successful agent results and graph nodes remain visible.
2. The debate is derived as `partially_completed`.
3. The UI shows a warning that final synthesis failed.
4. Overview and Debate Process remain usable.
5. Reload or synthesis retry controls are exposed when supported.

### 8.4 Stream Interruption

1. The UI shows `CHECKING STATUS`.
2. A connection-interrupted information banner appears.
3. The frontend reloads the saved backend snapshot.
4. The final displayed status follows the persisted backend result.

### 8.5 Follow-up Question

1. The user submits a follow-up from the center workspace.
2. A new three-round follow-up cycle runs.
3. The Follow-up tab appears and receives a count badge.
4. The tab compares the updated conclusion against previous cycles.

---

## 9. Key Implementation Files

### Backend Pipeline

- `server/app/services/chat_engine.py` - coordinates the five initial stages and turn-level lifecycle.
- `server/app/services/debate_engine/round_manager.py` - executes initial stages, follow-up rounds, partial round handling, and synthesis work.
- `server/app/services/followup_runner.py` - coordinates follow-up cycles.
- `server/app/models/round.py` - defines initial and follow-up round types.
- `server/app/models/debate_follow_up.py` - stores follow-up cycle metadata.
- `server/app/services/debate_engine/debate_memory.py` - constructs cross-cycle debate memory.

### Frontend Lifecycle

- `client/src/features/debate/model/execution-state.ts` - canonical five-stage definitions and execution state.
- `client/src/features/debate/model/debate-view-state.ts` - shared user-facing lifecycle selector.
- `client/src/features/debate/model/useDebateViewState.ts` - React access to the derived view state.
- `client/src/features/debate/model/debate.store.ts` - debate snapshot, stream, and generation state.

### Frontend Workspace and Tabs

- `client/src/features/debate/ui/DebateLayout.tsx` - desktop and mobile workspace layout.
- `client/src/features/debate/ui/TopTopicBar.tsx` - top status and debate metadata.
- `client/src/features/debate/ui/DebateTimeline.tsx` - three-phase left timeline.
- `client/src/features/debate/ui/DebateGraphCanvas.tsx` - center debate graph.
- `client/src/features/debate/ui/PlaybackBar.tsx` - progress, playback, and relation legend.
- `client/src/features/debate/ui/RightSidebar.tsx` - four-tab information architecture.
- `client/src/features/debate/ui/DebateOverviewPanel.tsx` - live and completed overview.
- `client/src/features/debate/ui/DebateProcessPanel.tsx` - argument exchange and position evolution.
- `client/src/features/debate/ui/DebateEvolutionPanel.tsx` - follow-up synthesis evolution.
- `client/src/features/debate/ui/RawOutputPanel.tsx` - raw payload and lifecycle debug view.

---

## 10. Current Terminology and Compatibility Notes

### Stage vs. Round

The initial debate should be described to users as five **stages**. Internally, the database and several backend structures still store them as `Round` records.

Follow-up cycles are naturally described as three-round cycles because each cycle appends three new stored rounds.

### Three Phases vs. Five Stages

The interface's three phases do not replace the five-stage engine:

- phases explain the debate at a high level;
- stages describe the actual execution lifecycle.

### Remaining Legacy References

Some backend comments, schema comments, and prompt wording still contain older "Round 1/2/3" assumptions. These do not define the current main execution path, but they can cause confusion during maintenance and should be treated as legacy wording.

The authoritative current main-stage labels are:

1. Stage 1: Initial Positions
2. Stage 2: Cross-Critiques
3. Stage 3: Responses to Critiques
4. Stage 4: Revised Positions
5. Stage 5: Final Synthesis

---

## 11. Final Assessment

The current AGORA design separates technical correctness from presentation complexity:

- the backend and lifecycle selector preserve the real five-stage process;
- the UI explains that process through three coherent phases;
- the redesigned sidebar reduces navigation clutter by consolidating related views;
- partial failures preserve valuable results;
- stream interruption is reconciled with persisted backend state;
- follow-up cycles extend the debate without rerunning the full initial pipeline.

As a result, the workspace now provides both a readable high-level story and detailed evidence of how each agent challenged, responded, revised, and contributed to the final decision.

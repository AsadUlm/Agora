# AGORA Evaluation Demo Guide

## Purpose

This guide explains how to demonstrate AGORA's multi-agent debate process to a professor or evaluator at the capstone presentation.

---

## Demo Question (Recommended)

> **"Should governments impose strict regulations on high-risk AI applications, or would such rules slow innovation and strengthen large technology companies?"**

This question is ideal because:

- It has multiple genuine perspectives with real tradeoffs
- It produces clear before/after position changes
- It generates high-quality critiques (regulation vs. innovation vs. safety)
- It is highly relevant to current AI policy discourse

---

## Agent Presets for the Demo

Use these 4 agent presets (available in the system presets):

| Agent                       | Preset ID                          | Initial Stance                                          |
| --------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Policy Analyst              | `system-policy-analyst`            | Pro-regulation: targeted risk-based rules               |
| Innovation Advocate         | `system-innovation-advocate`       | Anti-overregulation: startup burden, regulatory capture |
| Risk Critic                 | `system-risk-critic`               | Pro-safety: precautionary principle, accountability     |
| Legal & Competition Analyst | `system-legal-competition-analyst` | Proportional regulation: sandboxes, antitrust           |

---

## Step-by-Step Demo Flow

### 1. Start the Debate

1. Open AGORA and click "New Debate"
2. Select the 4 presets above
3. Enter the demo question
4. Click "Start Debate"
5. Wait for all 5 rounds to complete

### 2. Open the History Tab

On the right sidebar, click **"History"** (📜).

**What to show:**

- Round 1 — Initial Positions: Each agent has a clearly different stance
- Round 2 — Cross-Critiques: Visible `FROM AGENT → TO AGENT` arrows
- Round 3 — Responses to Critiques: Each agent explicitly accepts/rejects points
- Round 4 — Revised Positions: "Changed" or "Position held" badges
- Round 5 — Final Synthesis: Based on revised positions

**Key point to make:**

> "This is NOT multiple LLMs answering the same question. Each agent critiques a specific other agent's argument. Each agent then decides what to accept and what to reject. The final answer is based on those revised positions."

### 3. Open the Agent Evolution Tab

Click **"Agent Evo"** (🔄).

**What to show:**

- For each agent: Initial position → Critiques received → Revised position
- Agents that changed their position show the "Changed" badge
- Agents that held their position show the "Position held" badge

**Key point to make:**

> "교수님, 여기서 각 에이전트가 처음에 어떤 입장이었고, 어떤 비판을 받았으며, 그 결과 입장이 어떻게 바뀌었는지 확인할 수 있습니다."

### 4. Open the Graph View

The graph shows:

- Round 1 nodes (agent positions)
- Round 2 cross-edges (critique arrows)
- Round 5 synthesis node (final answer)

**Key point to make:**

> "The graph visualizes the same debate that the History tab describes in text."

### 5. Show the Final Answer

Click **"Moderator"** tab.

**What to show:**

- The final synthesis verdict
- How it differs from any single agent's initial answer
- The debate impact summary

---

## Korean Explanation Script

교수님께 시스템을 설명할 때 사용하세요:

---

**[시작 설명]**

"교수님께서 지적하신 것처럼 단순히 여러 모델의 답변을 나열하는 것은 토론이라고 보기 어렵습니다. 그래서 저희는 토론 과정을 다섯 단계로 명확히 분리했습니다."

---

**[5단계 설명]**

"첫 번째 단계는 초기 입장입니다. 각 에이전트는 자신의 역할에 맞는 독립적인 입장을 제시합니다. Policy Analyst는 규제 찬성, Innovation Advocate는 규제 반대 입장을 취합니다."

"두 번째 단계는 상호 비판입니다. 각 에이전트는 다른 에이전트의 주장 중 가장 취약한 부분을 구체적으로 비판합니다. 이 화면에서 누가 누구를 비판했는지, 어떤 주장을 공격했는지 확인할 수 있습니다."

"세 번째 단계는 비판에 대한 응답입니다. 각 에이전트는 자신이 받은 비판을 수용하거나 거부합니다. 수용한 점과 거부한 점이 모두 명시됩니다."

"네 번째 단계는 수정된 입장입니다. 비판과 응답을 바탕으로 각 에이전트가 자신의 입장을 수정합니다. 입장이 바뀐 에이전트는 '변경됨' 표시가 표시되고, 바뀌지 않은 에이전트는 '입장 유지'가 표시됩니다."

"다섯 번째 단계는 최종 종합입니다. 최종 답변은 초기 입장이 아닌 수정된 입장들을 바탕으로 생성됩니다."

---

**[UI 흐름 설명 — Overview 탭 중심]**

"이 화면에서는 토론이 단계별로 어떻게 진행되는지 확인할 수 있습니다. 초기 의견, 상호 비판, 비판에 대한 응답, 수정된 의견, 최종 종합의 순서로 표시되며, 각 단계가 완료될 때마다 요약이 생성됩니다."

"오른쪽 패널의 Overview 탭이 기본 화면입니다. 토론이 완료되면 다음을 확인할 수 있습니다:"

- Debate Story: 주요 쟁점, 핵심 비판, 입장 변화, 최종 결과를 한눈에 요약
- Stage Pipeline: 5단계 진행 상황 (실행 중에는 실시간으로 업데이트됨)
- Final Answer: 토론 결과 최종 답변 (접어두기/펼치기 가능)
- How Debate Changed the Answer: 토론이 답변에 어떤 영향을 미쳤는지
- Explore Further: 세부 탭(Trace, Changes, Guide)으로 이동하는 링크

"세부 내용은 Trace 탭(📜)에서, 각 에이전트의 입장 변화는 Changes 탭(🔄)에서 확인할 수 있습니다. 토론 그래프는 Guide 탭(◐) 안에 보조적으로 제공됩니다."

---

**[결론]**

"이 시스템은 단순한 멀티 모델 요약이 아닙니다. 각 에이전트가 다른 에이전트의 주장에 실제로 반응하고, 그 결과로 입장이 변화하는 토론 과정을 보여줍니다. 최종 답변은 그 토론의 결과물입니다."

---

## What Makes AGORA Different from a Single LLM

| Single LLM              | AGORA                                           |
| ----------------------- | ----------------------------------------------- |
| One perspective         | Multiple perspectives with role-defined stances |
| No self-critique        | Agents critique each other's specific claims    |
| Static answer           | Positions evolve based on debate                |
| No traceability         | Full trace: who said what, who changed, why     |
| Single point of failure | Partial failures isolated; debate continues     |

---

## Running the Migration (New Installation)

If setting up fresh, run:

```bash
cd server
python -m alembic upgrade 0014
```

This adds the `critique_response` and `revised_position` enum values to the database.

---

## Troubleshooting

**"Debate Trace tab shows incomplete-trace warning for Round 3 or Round 4"**
→ This debate was run before the 5-stage upgrade, or generation stopped early. Start a new debate to get the full pipeline. The warning now explicitly states which stage was not generated — it is NOT a false "older pipeline" label.

**"Agent Evolution shows 'Revised position not available'"**
→ Same as above. New debates will show full before/after data.

**"Overview tab shows nothing"**
→ Start a debate first. The Overview tab auto-updates when a debate is running or completed.

**"Round 3 or Round 4 not showing"**
→ Check that the backend is running the updated `chat_engine.py` with 5-round pipeline.

# CLAUDE.md — Ko Branch Dev Notes

This file is local-only (gitignored). Updated each session with what changed.

---

## Session Changes (2026-04-15 — Node Canvas UI)

### Feature: Radial Node Canvas for Debate Progress

**Frontend**
- `client/package.json` — added `@xyflow/react` (React Flow v12)
- `client/src/components/debate/DebateCanvas.tsx` — new component. React Flow canvas with radial layout: `TopicNode` (center, amber) + `AgentNode` per agent (colored, shows stance/confidence/final_stance). Spoke edges (topic → agents, dashed gray). Round 2 critique edges animate as orange directed arrows with challenge label. Status pill at top-center. Node entrance animation via CSS `@keyframes nodeEnter`.
- `client/src/pages/HomePage.tsx` — replaced the round-card timeline section with `<DebateCanvas>`. Imports `DebateCanvas`. Passes `question`, `messages`, `agentMap`, `agentAppearanceOrder`, `currentRound`, `status`.
- `.claude/launch.json` — added launch config for the preview tool using Node v22 path

**Design decisions**
- Radial layout: agents equally spaced around center at r=230, starting from top
- All-sides invisible handles on each node so RF routes edges sensibly regardless of angle
- `nodesDraggable: false` — static layout, user can pan/zoom only
- `agentMap` drives initial node count (shows "Preparing…" before messages arrive); falls back to message-derived IDs if map is empty

---

## Session Changes (2026-04-14 — Agent Setup Redesign)

### Feature: Agent Setup UI Redesign

**Frontend**
- `client/src/components/debate/PresetSelector.tsx` — 2-column grid (was 3), bigger cards (`p: 2`, `borderRadius: 2.5`), larger icon (20px), larger fonts (role 0.85rem, tagline 0.73rem), stronger selected state (glow + top-right dot indicator, `${color}1A` bg)
- `client/src/pages/HomePage.tsx` — agent setup moved out of the input card into a right-side MUI `Drawer`. Input card is now always compact (question input + toolbar only). Drawer has: sticky header with "Agents for this debate" title + live question preview block (amber highlight when filled), mode toggle, scrollable preset/custom content, and a "Done — N agents ready" footer button. Removed folder tabs entirely. `tab` state replaced with `agentDrawerOpen`. Bottom toolbar: "Settings" button replaced with clickable "N agents" badge that opens the drawer.

---

## Previous Session Changes (2026-04-14)

### Feature: Per-Agent System Prompts (end-to-end)

**Backend**
- `server/app/schemas/agent_config.py` — added `system_prompt: str = ""` to `AgentConfig` + parsing in `from_raw()`
- `server/app/schemas/contracts.py` — added `system_prompt: str = ""` to `AgentContext`
- `server/app/models/chat_agent.py` — added `system_prompt` column (`String(4000)`, nullable)
- `server/app/services/chat_engine.py` — maps `agent.system_prompt` → `AgentContext`
- `server/app/api/routes/debate.py` — passes `cfg.system_prompt` when creating `ChatAgent`
- `server/app/services/debate_engine/round_manager.py` — passes `system_prompt` to round 1 prompt call
- `server/app/services/debate_engine/prompts/round1_prompts.py` — uses `system_prompt` in prompt construction
- `server/alembic/versions/0004_add_system_prompt_to_chat_agents.py` — migration for new column (untracked, run this)

**Frontend**
- `client/src/pages/HomePage.tsx` — question input now always visible on both tabs; agent setup panel renders below it when tab 1 is active. Reset also clears `agentMode` and `customAgents`.

---

## Rules / Preferences
- Update this file at the end of every session with what changed.
- This file stays local only (gitignored, ko branch only).
- Never commit `.env` files — already covered by `.gitignore`.

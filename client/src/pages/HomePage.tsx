import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Divider,
    Drawer,
    IconButton,
    InputBase,
    Stack,
    Tooltip,
    Typography,
    Zoom,
} from "@mui/material";
import { useState, useMemo } from "react";
import AppShell from "../components/layout/AppShell";
import ModeratorCard from "../components/debate/ModeratorCard";
import PresetSelector from "../components/debate/PresetSelector";
import { useDebate } from "../hooks/useDebate";
import type { AgentCreateRequest, Round1Structured, Round2Structured, Round3Structured } from "../types/debate";

const MAX_CHARS = 500;


const ROUND_LABELS: Record<number, string> = {
    1: "Opening Statements",
    2: "Cross Examination",
    3: "Final Synthesis",
};

const ROUND_COLORS: Record<number, string> = {
    1: "#6C8EF5",
    2: "#F5A623",
    3: "#34D399",
};

// Agent role colors — cycle through a palette for N agents
const AGENT_PALETTE = ["#6C8EF5", "#F5A623", "#34D399", "#F472B6", "#A78BFA", "#38BDF8"];

const DEFAULT_MODEL_CONFIG = { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.7 };
const DEFAULT_REASONING = { style: "balanced" };

function parseContent(content: string): Round1Structured | Round2Structured | Round3Structured | null {
    try { return JSON.parse(content); } catch { return null; }
}

interface MessageBubbleProps {
    agentId: string | null;
    agentLabel: string;
    agentColor: string;
    roundNumber: number;
    content: string;
}

function ShowMoreToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
    return (
        <Typography
            variant="caption"
            onClick={onToggle}
            sx={{ color: "primary.main", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, mt: 0.75, display: "block", userSelect: "none", "&:hover": { color: "primary.light" } }}
        >
            {expanded ? "Show less ↑" : "Show more ↓"}
        </Typography>
    );
}

function MessageBubble({ agentLabel, agentColor, roundNumber, content }: MessageBubbleProps) {
    const [expanded, setExpanded] = useState(false);
    const parsed = parseContent(content);
    const roundColor = ROUND_COLORS[roundNumber] ?? "#9CA3AF";

    // Round 1 — opening statement
    if (parsed && "stance" in parsed) {
        const p = parsed as Round1Structured;
        const allPoints = p.key_points ?? [];
        const visiblePoints = expanded ? allPoints : allPoints.slice(0, 2);
        const hasMore = allPoints.length > 2 || (p.stance?.length ?? 0) > 120;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2, height: "100%" }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>
                        {agentLabel}
                    </Typography>
                    <Chip label={`${Math.round((p.confidence ?? 0.8) * 100)}% confidence`} size="small"
                        sx={{ height: 18, fontSize: "0.6rem", bgcolor: "rgba(108,142,245,0.12)", color: "#6C8EF5", border: "none" }} />
                </Stack>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75, ...(expanded ? {} : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }) }}>
                    {p.stance}
                </Typography>
                {visiblePoints.length > 0 && (
                    <Stack spacing={0.4} sx={{ mt: 0.5 }}>
                        {visiblePoints.map((pt, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color: roundColor, mt: "1px", flexShrink: 0 }}>•</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>{pt}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
                {hasMore && <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
            </Box>
        );
    }

    // Round 2 — cross-examination / critique
    if (parsed && "critiques" in parsed) {
        const p = parsed as Round2Structured;
        const allCritiques = p.critiques ?? [];
        const visibleCritiques = expanded ? allCritiques : allCritiques.slice(0, 2);
        const hasMore = allCritiques.length > 2;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.65rem" }}>Response</Typography>
                </Stack>
                {visibleCritiques.length > 0 && (
                    <Stack spacing={0.4}>
                        {visibleCritiques.map((d, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color: roundColor, mt: "1px", flexShrink: 0 }}>↳</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>
                                    <strong>vs {d.target_role}:</strong> {d.challenge}
                                </Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
                {hasMore && <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
            </Box>
        );
    }

    // Round 3 — final synthesis
    if (parsed && "final_stance" in parsed) {
        const p = parsed as Round3Structured;
        const hasMore = (p.final_stance?.length ?? 0) > 120 || !!p.recommendation;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
                    <Typography variant="caption" sx={{ color: roundColor, fontSize: "0.65rem", fontWeight: 600 }}>Final Position</Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75, ...(expanded ? {} : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }) }}>
                    {p.final_stance}
                </Typography>
                {expanded && p.recommendation && (
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>{p.recommendation}</Typography>
                )}
                {hasMore && <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
            </Box>
        );
    }

    // Fallback — raw text (plain string from LLM)
    const hasMore = content.length > 200;
    return (
        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.6, ...(expanded ? {} : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }) }}>
                {content}
            </Typography>
            {hasMore && <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
        </Box>
    );
}

export default function HomePage() {
    const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
    const [question, setQuestion] = useState("");
    const [moderatorOpen, setModeratorOpen] = useState(false);
    const [selectedRoles, setSelectedRoles] = useState<string[]>(["Proponent", "Opponent"]);
    const [agentInstructions, setAgentInstructions] = useState<Record<string, string>>({});
    const [agentMode, setAgentMode] = useState<"presets" | "custom">("presets");
    const [customAgents, setCustomAgents] = useState<Array<{ role: string; instructions: string }>>([
        { role: "", instructions: "" },
        { role: "", instructions: "" },
    ]);

    const { status, messages, currentRound, agentMap, error, start, reset } = useDebate();

    const agentsFromRoles: AgentCreateRequest[] = agentMode === "presets"
        ? selectedRoles.map((role) => ({
            role,
            config: {
                model: DEFAULT_MODEL_CONFIG,
                reasoning: DEFAULT_REASONING,
                ...(agentInstructions[role] ? { system_prompt: agentInstructions[role] } : {}),
            },
        }))
        : customAgents.filter((a) => a.role.trim()).map((a) => ({
            role: a.role.trim(),
            config: {
                model: DEFAULT_MODEL_CONFIG,
                reasoning: DEFAULT_REASONING,
                ...(a.instructions ? { system_prompt: a.instructions } : {}),
            },
        }));

    const submitted = status !== "idle";
    const isLoading = status === "queued" || status === "running" || status === "unknown";
    const enoughAgents = agentMode === "presets"
        ? selectedRoles.length >= 2
        : customAgents.filter((a) => a.role.trim()).length >= 2;
    const canSubmit = question.trim().length > 0 && question.length <= MAX_CHARS && !isLoading && enoughAgents;

    // Use agentMap strictly from backend, preserving appearance order just for deterministic colors.
    const agentAppearanceOrder = useMemo<string[]>(() => {
        const seen: string[] = [];
        for (const msg of messages) {
            if (msg.agentId && !seen.includes(msg.agentId)) {
                seen.push(msg.agentId);
            }
        }
        return seen;
    }, [messages]);

    function getAgentMeta(agentId: string | null): { label: string; color: string } {
        if (!agentId) return { label: "Agent", color: AGENT_PALETTE[0] };
        const idx = agentAppearanceOrder.indexOf(agentId);
        
        // Priority: Real DB role > selected roles > fallback
        const role = agentMap[agentId] ?? agentsFromRoles[idx]?.role ?? `Agent ${idx + 1}`;
        const color = AGENT_PALETTE[Math.max(0, idx) % AGENT_PALETTE.length] ?? "#9CA3AF";
        return { label: role, color };
    }

    async function handleSubmit() {
        if (!canSubmit) return;
        await start(question.trim(), agentsFromRoles);
    }

    function handleReset() {
        reset();
        setQuestion("");
        setSelectedRoles(["Proponent", "Opponent"]);
        setAgentInstructions({});
        setAgentMode("presets");
        setCustomAgents([{ role: "", instructions: "" }, { role: "", instructions: "" }]);
    }

    // Group messages by round
    const byRound: Record<number, typeof messages> = {};
    for (const msg of messages) {
        if (!byRound[msg.roundNumber]) byRound[msg.roundNumber] = [];
        byRound[msg.roundNumber].push(msg);
    }
    const rounds = Object.keys(byRound).map(Number).sort();

    // Build moderator snapshot for the sidebar
    const agentLabels = agentAppearanceOrder.map((_id, i) => {
        return agentsFromRoles[i]?.role ?? `Agent ${i + 1}`;
    });

    // Agreement / conflict summary from round 2 messages
    const round2Msgs = byRound[2] ?? [];
    const round3Msgs = byRound[3] ?? [];

    const agreementSummary = round2Msgs.length > 0
        ? `${round2Msgs.length} critique(s) recorded in cross-examination.`
        : "—";

    const synthesisSummary = round3Msgs.length > 0
        ? round3Msgs.map((m) => {
            const p = parseContent(m.content) as Round3Structured | null;
            return p?.final_stance ?? null;
        }).filter(Boolean).join(" · ") || "—"
        : "—";

    const nextStep = status === "queued"
        ? "Agents are preparing…"
        : status === "running"
        ? `Round ${currentRound} — agents generating…`
        : status === "completed"
        ? "Debate complete. Start a new debate below."
        : "—";
    return (
        <AppShell>
            {/* Right moderator sidebar — always rendered, shown after submit */}
            <ModeratorCard
                open={moderatorOpen && submitted}
                roundOverview={
                    (status as string) === "idle"
                        ? "Waiting for debate to begin…"
                        : `Round ${currentRound} of 3 — ${ROUND_LABELS[currentRound] ?? "Starting…"}`
                }
                agreementMap={agreementSummary}
                conflictMap={
                    round2Msgs.length > 0
                        ? `${agentLabels.join(" vs ")} — active disagreements recorded.`
                        : "—"
                }
                keyInsight={synthesisSummary !== "—" ? synthesisSummary : "Awaiting final synthesis…"}
                nextStep={nextStep}
            />

            {/* Floating amber moderator toggle button */}
            {submitted && (
                <Zoom in={submitted}>
                    <Tooltip title="Moderator" placement="left">
                        <IconButton
                            onClick={() => setModeratorOpen((v) => !v)}
                            sx={{
                                position: "fixed", top: 20, right: 20,
                                width: 42, height: 42,
                                bgcolor: "primary.main", color: "#0F1117",
                                borderRadius: "50%",
                                boxShadow: "0 4px 16px rgba(245,166,35,0.35)",
                                zIndex: 201,
                                "&:hover": { bgcolor: "primary.light" },
                            }}
                        >
                            <MenuRoundedIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                </Zoom>
            )}

            <Box
                sx={{
                    display: "flex",
                    minHeight: "100vh",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: submitted ? "flex-start" : "center",
                    pt: submitted ? 3 : 0,
                    px: 3,
                    pr: submitted && moderatorOpen ? "316px" : 3,
                    transition: "padding-top 0.4s cubic-bezier(0.4,0,0.2,1), padding-right 0.25s cubic-bezier(0.4,0,0.2,1)",
                }}
            >
                {/* Heading — hides after submit */}
                {!submitted && (
                    <Typography
                        variant="h4"
                        sx={{ fontWeight: 700, color: "text.primary", mb: 4, textAlign: "center" }}
                    >
                        Where should we begin?
                    </Typography>
                )}

                {/* Prompt area */}
                <Box sx={{ width: "100%", maxWidth: 700 }}>

                    {/* Control buttons — above the card */}
                    <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 1 }}>
                        <Tooltip title="Agent Setup">
                            <IconButton
                                size="small"
                                onClick={() => setAgentDrawerOpen(true)}
                                sx={{
                                    width: 32, height: 32,
                                    color: agentDrawerOpen ? "primary.main" : "text.secondary",
                                    border: `1px solid ${agentDrawerOpen ? "primary.main" : "#3A3E52"}`,
                                    borderRadius: "50%",
                                    transition: "all 0.15s",
                                    "&:hover": { color: "text.primary", borderColor: "text.secondary" },
                                }}
                            >
                                <GroupsRoundedIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Moderator">
                            <IconButton
                                size="small"
                                onClick={() => setModeratorOpen((v) => !v)}
                                sx={{
                                    width: 32, height: 32,
                                    color: moderatorOpen ? "primary.main" : "text.secondary",
                                    border: `1px solid ${moderatorOpen ? "primary.main" : "#3A3E52"}`,
                                    borderRadius: "50%",
                                    transition: "all 0.15s",
                                    "&:hover": { color: "text.primary", borderColor: "text.secondary" },
                                }}
                            >
                                <GavelRoundedIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    </Stack>

                    {/* Input card — always compact */}
                    <Box sx={{ bgcolor: "#1E2130", borderRadius: "16px", border: "1px solid #2E3248", boxShadow: "0 8px 40px rgba(0,0,0,0.45)", overflow: "hidden" }}>
                        <Box sx={{ px: 2.5, pt: 2, pb: 1 }}>
                            <InputBase
                                fullWidth
                                multiline
                                minRows={submitted ? 2 : 4}
                                maxRows={10}
                                placeholder="Ask anything, debate anything…"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                                inputProps={{ maxLength: MAX_CHARS }}
                                disabled={isLoading}
                                sx={{
                                    fontSize: "0.97rem",
                                    color: "text.primary",
                                    alignItems: "flex-start",
                                    "& textarea::placeholder": { color: "text.secondary", opacity: 1 },
                                }}
                            />
                        </Box>

                        {/* Bottom toolbar */}
                        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75}>
                                {/* Agent badge — shows who's set up */}
                                <Stack
                                    direction="row" alignItems="center" spacing={0.6}
                                    onClick={() => setAgentDrawerOpen(true)}
                                    sx={{ px: 1.25, height: 32, border: "1px solid #3A3E52", borderRadius: "999px", cursor: "pointer", color: "text.secondary", "&:hover": { color: "text.primary", borderColor: "text.secondary" }, transition: "all 0.15s", userSelect: "none" }}
                                >
                                    <GroupsRoundedIcon sx={{ fontSize: 14 }} />
                                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.75rem", color: "inherit" }}>
                                        {selectedRoles.length} agents
                                    </Typography>
                                </Stack>

                                {/* Status indicator */}
                                {isLoading && (
                                    <Stack direction="row" alignItems="center" spacing={0.75}>
                                        <CircularProgress size={12} sx={{ color: "primary.main" }} />
                                        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
                                            {status === "queued" ? "Starting…" : `Round ${currentRound} running…`}
                                        </Typography>
                                    </Stack>
                                )}
                                {status === "completed" && (
                                    <Typography variant="caption" sx={{ color: "#34D399", fontSize: "0.72rem", fontWeight: 600 }}>✓ Debate complete</Typography>
                                )}
                                {status === "failed" && (
                                    <Typography variant="caption" sx={{ color: "error.main", fontSize: "0.72rem", fontWeight: 600 }}>✗ Failed</Typography>
                                )}
                            </Stack>

                            <Stack direction="row" spacing={1} alignItems="center">
                                {submitted && !isLoading && (
                                    <Stack direction="row" alignItems="center" spacing={0.75} onClick={handleReset}
                                        sx={{ px: 1.5, py: 0.85, borderRadius: "999px", cursor: "pointer", border: "1px solid #3A3E52", color: "text.secondary", "&:hover": { color: "text.primary", borderColor: "text.secondary" }, transition: "all 0.2s", userSelect: "none" }}>
                                        <StopRoundedIcon sx={{ fontSize: 14 }} />
                                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem" }}>New</Typography>
                                    </Stack>
                                )}
                                <Stack direction="row" alignItems="center" spacing={0.75} onClick={handleSubmit}
                                    sx={{ bgcolor: canSubmit ? "primary.main" : "#2A2E42", borderRadius: "999px", px: 2, py: 0.85, cursor: canSubmit ? "pointer" : "default", transition: "all 0.2s", userSelect: "none", "&:hover": canSubmit ? { bgcolor: "primary.light" } : {} }}>
                                    <PlayArrowRoundedIcon sx={{ fontSize: 17, color: canSubmit ? "#0F1117" : "text.secondary" }} />
                                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem", color: canSubmit ? "#0F1117" : "text.secondary" }}>Start</Typography>
                                </Stack>
                            </Stack>
                        </Stack>
                    </Box>
                </Box>

                {/* ── Agent Setup Drawer ─────────────────────────────────── */}
                <Drawer
                    anchor="right"
                    open={agentDrawerOpen}
                    onClose={() => setAgentDrawerOpen(false)}
                    PaperProps={{
                        sx: {
                            width: 380,
                            bgcolor: "#13151F",
                            borderLeft: "1px solid #2A2D3A",
                            boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
                            display: "flex",
                            flexDirection: "column",
                        },
                    }}
                >
                    {/* Drawer header */}
                    <Box sx={{ px: 2.5, pt: 2.5, pb: 2, borderBottom: "1px solid #1E2130", flexShrink: 0 }}>
                        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.4 }}>
                                    <GroupsRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
                                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.9rem", color: "text.primary" }}>
                                        Agents for this debate
                                    </Typography>
                                </Stack>
                                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
                                    These roles will argue specifically about:
                                </Typography>
                            </Box>
                            <IconButton size="small" onClick={() => setAgentDrawerOpen(false)}
                                sx={{ color: "text.secondary", mt: -0.5, "&:hover": { color: "text.primary" } }}>
                                <CloseRoundedIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Stack>

                        {/* Question context block */}
                        <Box sx={{
                            mt: 1.5, px: 1.5, py: 1.25,
                            bgcolor: question.trim() ? "rgba(245,166,35,0.07)" : "#1A1D2A",
                            border: `1px solid ${question.trim() ? "rgba(245,166,35,0.3)" : "#2A2D3A"}`,
                            borderLeft: `3px solid ${question.trim() ? "#F5A623" : "#3A3E52"}`,
                            borderRadius: 1.5,
                        }}>
                            {question.trim() ? (
                                <Typography variant="body2" sx={{
                                    color: "text.primary", fontSize: "0.82rem", lineHeight: 1.5,
                                    display: "-webkit-box", overflow: "hidden",
                                    WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                                }}>
                                    {question}
                                </Typography>
                            ) : (
                                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem", fontStyle: "italic" }}>
                                    Type your question first — it'll appear here
                                </Typography>
                            )}
                        </Box>
                    </Box>

                    {/* Mode toggle */}
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid #1A1D2A", flexShrink: 0 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                            Mode
                        </Typography>
                        <Stack direction="row" spacing={0.75}>
                            {(["presets", "custom"] as const).map((mode) => (
                                <Stack key={mode} direction="row" alignItems="center"
                                    onClick={() => !submitted && setAgentMode(mode)}
                                    sx={{
                                        px: 1.25, height: 26,
                                        border: `1px solid ${agentMode === mode ? "#F5A623" : "#3A3E52"}`,
                                        borderRadius: "999px",
                                        cursor: submitted ? "default" : "pointer",
                                        color: agentMode === mode ? "#F5A623" : "text.secondary",
                                        bgcolor: agentMode === mode ? "rgba(245,166,35,0.08)" : "transparent",
                                        transition: "all 0.15s",
                                        "&:hover": submitted ? {} : { borderColor: "#F5A623", color: "#F5A623" },
                                    }}
                                >
                                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.72rem", color: "inherit", textTransform: "capitalize" }}>
                                        {mode}
                                    </Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </Stack>

                    {/* Scrollable content */}
                    <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2.5 }}>

                        {/* PRESETS mode */}
                        {agentMode === "presets" && (
                            <Box>
                                <PresetSelector
                                    selected={selectedRoles}
                                    onChange={(roles) => {
                                        setSelectedRoles(roles);
                                        setAgentInstructions((prev) => {
                                            const next = { ...prev };
                                            Object.keys(next).forEach((r) => { if (!roles.includes(r)) delete next[r]; });
                                            return next;
                                        });
                                    }}
                                    disabled={submitted}
                                />

                                {/* Customize section */}
                                {selectedRoles.length > 0 && (
                                    <Box sx={{ mt: 3 }}>
                                        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                            <Box sx={{ height: "1px", flex: 1, bgcolor: "#2A2D3A" }} />
                                            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                                                Customize — optional
                                            </Typography>
                                            <Box sx={{ height: "1px", flex: 1, bgcolor: "#2A2D3A" }} />
                                        </Stack>
                                        <Stack spacing={1.5}>
                                            {selectedRoles.map((role, idx) => {
                                                const color = AGENT_PALETTE[idx % AGENT_PALETTE.length];
                                                return (
                                                    <Box key={role} sx={{ border: "1px solid #2A2D3A", borderLeft: `3px solid ${color}`, borderRadius: 2, p: 1.75, bgcolor: `${color}06` }}>
                                                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                                            <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                                                            <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", fontSize: "0.68rem" }}>
                                                                {role}
                                                            </Typography>
                                                        </Stack>
                                                        <InputBase
                                                            fullWidth multiline minRows={2} maxRows={5}
                                                            placeholder="Extra instructions for this agent… (optional)"
                                                            value={agentInstructions[role] ?? ""}
                                                            onChange={(e) => setAgentInstructions((prev) => ({ ...prev, [role]: e.target.value }))}
                                                            disabled={submitted}
                                                            sx={{ fontSize: "0.82rem", color: "text.primary", alignItems: "flex-start", "& textarea::placeholder": { color: "text.secondary", opacity: 0.65, fontSize: "0.8rem" } }}
                                                        />
                                                    </Box>
                                                );
                                            })}
                                        </Stack>
                                    </Box>
                                )}
                            </Box>
                        )}

                        {/* CUSTOM mode */}
                        {agentMode === "custom" && (
                            <Box>
                                <Stack spacing={1.5}>
                                    {customAgents.map((agent, idx) => {
                                        const color = AGENT_PALETTE[idx % AGENT_PALETTE.length];
                                        return (
                                            <Box key={idx} sx={{ border: "1px solid #2A2D3A", borderLeft: `3px solid ${color}`, borderRadius: 2, p: 1.75, bgcolor: `${color}06` }}>
                                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                                                    <InputBase
                                                        placeholder="Role name (e.g. Economist)"
                                                        value={agent.role}
                                                        onChange={(e) => setCustomAgents((prev) => prev.map((a, i) => i === idx ? { ...a, role: e.target.value } : a))}
                                                        disabled={submitted}
                                                        sx={{ fontSize: "0.85rem", fontWeight: 700, color, flex: 1, "& input::placeholder": { color: "text.secondary", opacity: 1, fontWeight: 400 } }}
                                                    />
                                                    {customAgents.length > 2 && !submitted && (
                                                        <IconButton size="small" onClick={() => setCustomAgents((prev) => prev.filter((_, i) => i !== idx))}
                                                            sx={{ color: "text.secondary", p: 0.25, "&:hover": { color: "#F87171" } }}>
                                                            <CloseRoundedIcon sx={{ fontSize: 13 }} />
                                                        </IconButton>
                                                    )}
                                                </Stack>
                                                <InputBase
                                                    fullWidth multiline minRows={2} maxRows={5}
                                                    placeholder="Custom instructions (optional)"
                                                    value={agent.instructions}
                                                    onChange={(e) => setCustomAgents((prev) => prev.map((a, i) => i === idx ? { ...a, instructions: e.target.value } : a))}
                                                    disabled={submitted}
                                                    sx={{ fontSize: "0.82rem", color: "text.primary", alignItems: "flex-start", "& textarea::placeholder": { color: "text.secondary", opacity: 0.65, fontSize: "0.8rem" } }}
                                                />
                                            </Box>
                                        );
                                    })}
                                </Stack>
                                {customAgents.length < 5 && !submitted && (
                                    <Stack direction="row" alignItems="center" spacing={0.5}
                                        onClick={() => setCustomAgents((prev) => [...prev, { role: "", instructions: "" }])}
                                        sx={{ mt: 1.5, cursor: "pointer", color: "text.secondary", width: "fit-content", "&:hover": { color: "text.primary" }, transition: "color 0.15s", userSelect: "none" }}>
                                        <AddRoundedIcon sx={{ fontSize: 14 }} />
                                        <Typography variant="caption" sx={{ fontSize: "0.72rem", fontWeight: 600, color: "inherit" }}>Add agent</Typography>
                                    </Stack>
                                )}
                            </Box>
                        )}
                    </Box>

                    {/* Drawer footer — close / confirm */}
                    <Box sx={{ px: 2.5, py: 2, borderTop: "1px solid #1E2130", flexShrink: 0 }}>
                        <Stack
                            direction="row" alignItems="center" justifyContent="center"
                            onClick={() => setAgentDrawerOpen(false)}
                            sx={{
                                height: 40, borderRadius: "999px",
                                bgcolor: "primary.main", cursor: "pointer",
                                transition: "background-color 0.15s",
                                "&:hover": { bgcolor: "primary.light" },
                                userSelect: "none",
                            }}
                        >
                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F1117" }}>
                                Done — {selectedRoles.length} agents ready
                            </Typography>
                        </Stack>
                    </Box>
                </Drawer>

                {/* Error banner */}
                {error && (
                    <Box sx={{ width: "100%", maxWidth: 700, mt: 2 }}>
                        <Alert severity="error" onClose={reset}>{error}</Alert>
                    </Box>
                )}

                {/* Debate timeline */}
                {submitted && (
                    <Box sx={{ width: "100%", maxWidth: 900, mt: 4, pb: 6 }}>

                        {/* Loading skeleton while queued */}
                        {status === "queued" && messages.length === 0 && (
                            <Stack spacing={1.5} alignItems="center" sx={{ py: 6 }}>
                                <CircularProgress size={28} sx={{ color: "primary.main" }} />
                                <Typography variant="body2" sx={{ color: "text.secondary" }}>Agents are preparing their arguments…</Typography>
                            </Stack>
                        )}

                        {/* Rounds */}
                        {rounds.map((rn) => (
                            <Box key={rn} sx={{ mb: 4 }}>
                                {/* Round header */}
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Box sx={{ height: 1, flex: 1, bgcolor: "#2A2D3A" }} />
                                    <Typography variant="caption" sx={{ color: ROUND_COLORS[rn] ?? "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                                        Round {rn} — {ROUND_LABELS[rn] ?? ""}
                                    </Typography>
                                    <Box sx={{ height: 1, flex: 1, bgcolor: "#2A2D3A" }} />
                                </Stack>

                                {/* Messages in this round — side by side */}
                                <Stack direction="row" spacing={1.5} alignItems="stretch">
                                    {byRound[rn].map((msg) => {
                                        const { label, color } = getAgentMeta(msg.agentId);
                                        return (
                                            <Box key={msg.messageId} sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                                                <MessageBubble
                                                    agentId={msg.agentId}
                                                    agentLabel={label}
                                                    agentColor={color}
                                                    roundNumber={msg.roundNumber}
                                                    content={msg.content}
                                                />
                                            </Box>
                                        );
                                    })}
                                </Stack>
                            </Box>
                        ))}

                        {/* Pulsing indicator for current round streaming */}
                        {status === "running" && (
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                                <CircularProgress size={10} sx={{ color: ROUND_COLORS[currentRound] ?? "primary.main" }} />
                                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
                                    Round {currentRound} — agents generating…
                                </Typography>
                            </Stack>
                        )}
                    </Box>
                )}
            </Box>
        </AppShell>
    );
}

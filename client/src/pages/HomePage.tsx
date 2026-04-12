import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import BalanceIcon from "@mui/icons-material/Balance";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
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
import { useDebate } from "../hooks/useDebate";
import type { AgentCreateRequest, Round1Structured, Round2Structured, Round3Structured } from "../types/debate";

const MAX_CHARS = 500;

const TABS = [
    { icon: <BalanceIcon sx={{ fontSize: 15 }} />, label: "Start Debate", badge: null },
    { icon: <GroupsRoundedIcon sx={{ fontSize: 15 }} />, label: "Agent Setup", badge: "Configure agents" },
];

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

const DEFAULT_AGENTS: AgentCreateRequest[] = [
    { role: "Proponent", config: { model: { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.7 }, reasoning: { style: "balanced" } } },
    { role: "Opponent", config: { model: { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.7 }, reasoning: { style: "balanced" } } },
];

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

function MessageBubble({ agentLabel, agentColor, roundNumber, content }: MessageBubbleProps) {
    const parsed = parseContent(content);
    const roundColor = ROUND_COLORS[roundNumber] ?? "#9CA3AF";

    // Round 1 — opening statement
    if (parsed && "stance" in parsed) {
        const p = parsed as Round1Structured;
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
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.stance}</Typography>
                {p.key_points?.length > 0 && (
                    <Stack spacing={0.4} sx={{ mt: 0.5 }}>
                        {p.key_points.slice(0, 3).map((pt, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color: roundColor, mt: "1px", flexShrink: 0 }}>•</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{pt}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Box>
        );
    }

    // Round 2 — cross-examination / critique
    if (parsed && "critiques" in parsed) {
        const p = parsed as Round2Structured;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.65rem" }}>Response</Typography>
                </Stack>
                {p.critiques?.length > 0 && (
                    <Stack spacing={0.4}>
                        {p.critiques.slice(0, 2).map((d, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color: roundColor, mt: "1px", flexShrink: 0 }}>↳</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                                    <strong>vs {d.target_role}:</strong> {d.challenge}
                                </Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Box>
        );
    }

    // Round 3 — final synthesis
    if (parsed && "final_stance" in parsed) {
        const p = parsed as Round3Structured;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
                    <Typography variant="caption" sx={{ color: roundColor, fontSize: "0.65rem", fontWeight: 600 }}>Final Position</Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.final_stance}</Typography>
                {p.recommendation && (
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{p.recommendation}</Typography>
                )}
            </Box>
        );
    }

    // Fallback — raw text (plain string from LLM)
    return (
        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${agentColor}`, borderRadius: 2, p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: agentColor, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: agentColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>{agentLabel}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.6 }}>{content}</Typography>
        </Box>
    );
}

export default function HomePage() {
    const [tab, setTab] = useState(0);
    const [question, setQuestion] = useState("");
    const [moderatorOpen, setModeratorOpen] = useState(false);

    const { status, messages, currentRound, agentMap, error, start, reset } = useDebate();

    const submitted = status !== "idle";
    const isLoading = status === "queued" || status === "running" || status === "unknown";
    const canSubmit = question.trim().length > 0 && question.length <= MAX_CHARS && !isLoading;

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
        
        // Priority: Real DB role > static array map > fallback
        const role = agentMap[agentId] ?? DEFAULT_AGENTS[idx]?.role ?? `Agent ${idx + 1}`;
        const color = AGENT_PALETTE[Math.max(0, idx) % AGENT_PALETTE.length] ?? "#9CA3AF";
        return { label: role, color };
    }

    async function handleSubmit() {
        if (!canSubmit) return;
        await start(question.trim(), DEFAULT_AGENTS);
    }

    function handleReset() {
        reset();
        setQuestion("");
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
        const role = DEFAULT_AGENTS[i]?.role ?? `Agent ${i + 1}`;
        return role;
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

                    {/* Folder tabs */}
                    <Stack direction="row" spacing={1} sx={{ mb: "-1px", zIndex: 1, position: "relative", pl: 2 }}>
                        {TABS.map((t, i) => {
                            const selected = tab === i;
                            return (
                                <Stack
                                    key={t.label}
                                    direction="row"
                                    alignItems="center"
                                    spacing={0.75}
                                    onClick={() => setTab(i)}
                                    sx={{
                                        px: 2, py: 0.9,
                                        borderRadius: "10px 10px 0 0",
                                        border: "1px solid rgba(255,255,255,0.15)",
                                        borderBottom: selected ? "1px solid #1E2130" : "1px solid rgba(255,255,255,0.15)",
                                        bgcolor: selected ? "#1E2130" : "transparent",
                                        cursor: "pointer",
                                        userSelect: "none",
                                        transition: "all 0.15s",
                                        "&:hover": { bgcolor: selected ? "#1E2130" : "rgba(255,255,255,0.04)" },
                                    }}
                                >
                                    <Box sx={{ color: selected ? "text.primary" : "text.secondary", display: "flex" }}>{t.icon}</Box>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem", color: selected ? "text.primary" : "text.secondary", whiteSpace: "nowrap" }}>
                                        {t.label}
                                    </Typography>
                                    {t.badge && (
                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem", color: "primary.main" }}>{t.badge}</Typography>
                                    )}
                                </Stack>
                            );
                        })}
                    </Stack>

                    {/* Input card */}
                    <Box sx={{ bgcolor: "#1E2130", borderRadius: "16px", border: "1px solid #2E3248", boxShadow: "0 8px 40px rgba(0,0,0,0.45)", overflow: "hidden" }}>
                        <Box sx={{ px: 2.5, pt: 2, pb: 1 }}>
                            <InputBase
                                fullWidth
                                multiline
                                minRows={submitted ? 2 : 4}
                                maxRows={10}
                                placeholder={tab === 0 ? "Ask anything, debate anything…" : "Describe the agents you want — roles, perspectives, models…"}
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
                                <Tooltip title="Moderator Card">
                                    <IconButton size="small" onClick={() => setModeratorOpen(!moderatorOpen)} sx={{ width: 32, height: 32, color: "text.secondary", border: "1px solid #3A3E52", borderRadius: "50%", "&:hover": { color: "text.primary", borderColor: "text.secondary" } }}>
                                        <GavelRoundedIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="Agent personas">
                                    <IconButton size="small" sx={{ width: 32, height: 32, color: "text.secondary", border: "1px solid #3A3E52", borderRadius: "50%", "&:hover": { color: "text.primary", borderColor: "text.secondary" } }}>
                                        <GroupsRoundedIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="Debate settings">
                                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.25, height: 32, border: "1px solid #3A3E52", borderRadius: "999px", cursor: "pointer", color: "text.secondary", "&:hover": { color: "text.primary", borderColor: "text.secondary" }, transition: "all 0.15s" }}>
                                        <SettingsRoundedIcon sx={{ fontSize: 14 }} />
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.75rem", color: "inherit" }}>Settings</Typography>
                                    </Stack>
                                </Tooltip>

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
                                {/* Reset button when done / failed */}
                                {submitted && !isLoading && (
                                    <Stack direction="row" alignItems="center" spacing={0.75} onClick={handleReset}
                                        sx={{ px: 1.5, py: 0.85, borderRadius: "999px", cursor: "pointer", border: "1px solid #3A3E52", color: "text.secondary", "&:hover": { color: "text.primary", borderColor: "text.secondary" }, transition: "all 0.2s", userSelect: "none" }}>
                                        <StopRoundedIcon sx={{ fontSize: 14 }} />
                                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem" }}>New</Typography>
                                    </Stack>
                                )}

                                {/* Start button */}
                                <Stack direction="row" alignItems="center" spacing={0.75} onClick={handleSubmit}
                                    sx={{ bgcolor: canSubmit ? "primary.main" : "#2A2E42", borderRadius: "999px", px: 2, py: 0.85, cursor: canSubmit ? "pointer" : "default", transition: "all 0.2s", userSelect: "none", "&:hover": canSubmit ? { bgcolor: "primary.light" } : {} }}>
                                    <PlayArrowRoundedIcon sx={{ fontSize: 17, color: canSubmit ? "#0F1117" : "text.secondary" }} />
                                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem", color: canSubmit ? "#0F1117" : "text.secondary" }}>Start</Typography>
                                </Stack>
                            </Stack>
                        </Stack>
                    </Box>
                </Box>

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

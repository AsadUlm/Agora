import AddIcon from "@mui/icons-material/Add";
import BalanceIcon from "@mui/icons-material/Balance";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
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
import { useState } from "react";
import AppShell from "../components/layout/AppShell";
import ModeratorCard from "../components/debate/ModeratorCard";
import { useDebate } from "../hooks/useDebate";
import type { Round1Payload, Round2Payload, Round3Payload } from "../types/debate";

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

const DEFAULT_AGENTS = [
    { role: "Proponent", config: {} },
    { role: "Opponent", config: {} },
];

function parseContent(content: string): Round1Payload | Round2Payload | Round3Payload | null {
    try { return JSON.parse(content); } catch { return null; }
}

function MessageBubble({ agentId, roundNumber, content }: { agentId: string | null; roundNumber: number; content: string }) {
    const parsed = parseContent(content);
    const color = ROUND_COLORS[roundNumber] ?? "#9CA3AF";

    // Round 1 — opening statement
    if (parsed && "stance" in parsed) {
        const p = parsed as Round1Payload;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>
                        {agentId ? `Agent` : "Agent"}
                    </Typography>
                    <Chip label={`${Math.round(p.confidence * 100)}% confidence`} size="small"
                        sx={{ height: 18, fontSize: "0.6rem", bgcolor: "rgba(108,142,245,0.12)", color: "#6C8EF5", border: "none" }} />
                </Stack>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75 }}>{p.stance}</Typography>
                {p.key_points?.length > 0 && (
                    <Stack spacing={0.4} sx={{ mt: 0.5 }}>
                        {p.key_points.map((pt, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color, mt: "1px", flexShrink: 0 }}>•</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>{pt}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Box>
        );
    }

    // Round 2 — critique
    if (parsed && "disagreements" in parsed) {
        const p = parsed as Round2Payload;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>Response</Typography>
                </Stack>
                {p.revised_stance && (
                    <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75 }}>{p.revised_stance}</Typography>
                )}
                {p.disagreements?.length > 0 && (
                    <Stack spacing={0.4}>
                        {p.disagreements.map((d, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                <Typography variant="caption" sx={{ color, mt: "1px", flexShrink: 0 }}>↳</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>{d}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Box>
        );
    }

    // Round 3 — final synthesis
    if (parsed && "final_stance" in parsed) {
        const p = parsed as Round3Payload;
        return (
            <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderLeft: `3px solid ${color}`, borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}>Final Position</Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mb: 0.75 }}>{p.final_stance}</Typography>
                {p.recommendation && (
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.5 }}>{p.recommendation}</Typography>
                )}
            </Box>
        );
    }

    // Fallback — raw text
    return (
        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderRadius: 2, p: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.6 }}>{content}</Typography>
        </Box>
    );
}

export default function HomePage() {
    const [tab, setTab] = useState(0);
    const [question, setQuestion] = useState("");
    const [moderatorOpen, setModeratorOpen] = useState(true);

    const { status, messages, currentRound, error, start, reset } = useDebate();

    const submitted = status !== "idle";
    const isLoading = status === "queued" || status === "running";
    const canSubmit = question.trim().length > 0 && question.length <= MAX_CHARS && !isLoading;

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

    return (
        <AppShell>
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
                                <Tooltip title="Attach document">
                                    <IconButton size="small" sx={{ width: 32, height: 32, color: "text.secondary", border: "1px solid #3A3E52", borderRadius: "50%", "&:hover": { color: "text.primary", borderColor: "text.secondary" } }}>
                                        <AddIcon sx={{ fontSize: 16 }} />
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
                            </Stack>

                            <Stack direction="row" spacing={1} alignItems="center">
                                {/* Reset button when done */}
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

                {/* Error */}
                {error && (
                    <Box sx={{ width: "100%", maxWidth: 700, mt: 2 }}>
                        <Alert severity="error" onClose={reset}>{error}</Alert>
                    </Box>
                )}

                {/* Debate timeline */}
                {submitted && (
                    <Box sx={{ width: "100%", maxWidth: 700, mt: 4, pb: 6 }}>

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

                                {/* Messages in this round */}
                                <Stack spacing={1.5}>
                                    {byRound[rn].map((msg) => (
                                        <MessageBubble key={msg.id} agentId={msg.agentId} roundNumber={msg.roundNumber} content={msg.content} />
                                    ))}
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

            {/* Moderator card — fixed below amber button */}
            <ModeratorCard open={moderatorOpen && submitted} />

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
        </AppShell>
    );
}

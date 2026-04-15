import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    IconButton,
    Skeleton,
    Stack,
    Tab,
    Tabs,
    Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import DocumentsPanel from "../components/debate/DocumentsPanel";
import { buildWsUrl, getDebate } from "../services/debateService";
import type {
    AgentDTO,
    MessageDTO,
    Round1Structured,
    Round2Structured,
    Round3Structured,
    RoundDTO,
} from "../types/debate";
import type { WsEvent } from "../types/ws";

// ── Constants ──────────────────────────────────────────────────────────

const AGENT_PALETTE = ["#6C8EF5", "#F5A623", "#34D399", "#F472B6", "#A78BFA", "#38BDF8"];

const ROUND_LABELS: Record<number, string> = {
    1: "Round 1 — Initial Statements",
    2: "Round 2 — Critiques",
    3: "Round 3 — Final Synthesis",
};

const STATUS_COLOR: Record<string, "default" | "warning" | "info" | "success" | "error"> = {
    idle: "default",
    queued: "warning",
    running: "info",
    completed: "success",
    failed: "error",
    unknown: "default",
};

// ── Helpers ────────────────────────────────────────────────────────────

function agentColor(agents: AgentDTO[], agentId: string | null): string {
    if (!agentId) return "#9CA3AF";
    const idx = agents.findIndex((a) => a.id === agentId);
    return AGENT_PALETTE[idx >= 0 ? idx % AGENT_PALETTE.length : 0] ?? "#9CA3AF";
}

function agentLabel(agents: AgentDTO[], agentId: string | null, fallback: string | null): string {
    if (fallback) return fallback;
    if (!agentId) return "System";
    return agents.find((a) => a.id === agentId)?.role ?? "Agent";
}

function parsePayload(msg: MessageDTO): Record<string, unknown> | null {
    if (msg.payload && Object.keys(msg.payload).length > 0) return msg.payload;
    try { return JSON.parse(msg.text) as Record<string, unknown>; } catch { return null; }
}

function formatDate(iso: string | null | undefined) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
}

// ── Message Card ───────────────────────────────────────────────────────

interface MessageCardProps {
    msg: MessageDTO;
    agents: AgentDTO[];
}

function MessageCard({ msg, agents }: MessageCardProps) {
    const color = agentColor(agents, msg.agent_id);
    const label = agentLabel(agents, msg.agent_id, msg.agent_role);
    const parsed = parsePayload(msg);

    const renderContent = () => {
        if (!parsed) {
            return <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.6 }}>{msg.text || "—"}</Typography>;
        }

        // Round 1: Opening statement
        if ("stance" in parsed) {
            const p = parsed as unknown as Round1Structured;
            return (
                <Stack spacing={1}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, flex: 1 }}>
                            {p.stance}
                        </Typography>
                        {p.confidence !== undefined && (
                            <Chip
                                label={`${Math.round(p.confidence * 100)}% confidence`}
                                size="small"
                                sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(108,142,245,0.12)", color: "#6C8EF5" }}
                            />
                        )}
                    </Stack>
                    {p.key_points?.length > 0 && (
                        <Stack spacing={0.4} sx={{ pl: 0.5 }}>
                            {p.key_points.map((pt, i) => (
                                <Stack key={i} direction="row" spacing={1}>
                                    <Typography variant="caption" sx={{ color, mt: "1px", flexShrink: 0 }}>•</Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>{pt}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                    )}
                </Stack>
            );
        }

        // Round 2: Critiques
        if ("critiques" in parsed) {
            const p = parsed as unknown as Round2Structured;
            return (
                <Stack spacing={1}>
                    {p.critiques?.map((c, i) => (
                        <Box key={i} sx={{ pl: 1, borderLeft: "2px solid #2A2D3A" }}>
                            <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700 }}>
                                vs {c.target_role}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                                {c.challenge}
                            </Typography>
                            {c.weakness && (
                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                                    Weakness: {c.weakness}
                                </Typography>
                            )}
                        </Box>
                    ))}
                </Stack>
            );
        }

        // Round 3: Final synthesis
        if ("final_stance" in parsed) {
            const p = parsed as unknown as Round3Structured;
            return (
                <Stack spacing={1.5}>
                    <Box sx={{ bgcolor: "rgba(52,211,153,0.08)", borderRadius: 1, p: 1.5, border: "1px solid rgba(52,211,153,0.15)" }}>
                        <Typography variant="caption" sx={{ color: "#34D399", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.65rem" }}>
                            Final Position
                        </Typography>
                        <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600, mt: 0.5 }}>
                            {p.final_stance}
                        </Typography>
                    </Box>
                    {p.recommendation && (
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                            {p.recommendation}
                        </Typography>
                    )}
                    {p.remaining_concerns && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                            Remaining concerns: {p.remaining_concerns}
                        </Typography>
                    )}
                </Stack>
            );
        }

        // Generic object — render key/value
        return (
            <Stack spacing={0.5}>
                {Object.entries(parsed).slice(0, 8).map(([k, v]) => (
                    <Stack key={k} direction="row" spacing={1}>
                        <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 100, flexShrink: 0 }}>{k}:</Typography>
                        <Typography variant="caption" color="text.primary">
                            {typeof v === "string" ? v : JSON.stringify(v)}
                        </Typography>
                    </Stack>
                ))}
            </Stack>
        );
    };

    return (
        <Box
            sx={{
                bgcolor: "#151821",
                border: "1px solid #2A2D3A",
                borderLeft: `3px solid ${color}`,
                borderRadius: 2,
                p: 2,
            }}
        >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.65rem" }}>
                    {label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                    #{msg.sequence_no}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.62rem" }}>
                    {formatDate(msg.created_at)}
                </Typography>
            </Stack>
            {renderContent()}
        </Box>
    );
}

// ── Round Panel ─────────────────────────────────────────────────────────

interface RoundPanelProps {
    round: RoundDTO;
    agents: AgentDTO[];
    isLive: boolean;
}

function RoundPanel({ round, agents, isLive }: RoundPanelProps) {
    const sortedMessages = [...round.messages].sort((a, b) => a.sequence_no - b.sequence_no);
    const isRunning = round.status === "running" || (isLive && round.status !== "completed");

    return (
        <Box
            sx={{
                bgcolor: "#1A1D27",
                border: "1px solid #2A2D3A",
                borderRadius: 2,
                overflow: "hidden",
            }}
        >
            {/* Round header */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid #2A2D3A" }}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {ROUND_LABELS[round.round_number] ?? `Round ${round.round_number}`}
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1}>
                    {isRunning && <CircularProgress size={12} sx={{ color: "primary.main" }} />}
                    <Chip
                        label={round.status}
                        size="small"
                        color={STATUS_COLOR[round.status] ?? "default"}
                        sx={{ height: 20, fontSize: "0.68rem", fontWeight: 600 }}
                    />
                </Stack>
            </Stack>

            {/* Timestamps */}
            {(round.started_at || round.ended_at) && (
                <Stack direction="row" spacing={3} sx={{ px: 2.5, py: 1, borderBottom: "1px solid #2A2D3A" }}>
                    {round.started_at && (
                        <Typography variant="caption" color="text.secondary">Started: {formatDate(round.started_at)}</Typography>
                    )}
                    {round.ended_at && (
                        <Typography variant="caption" color="text.secondary">Ended: {formatDate(round.ended_at)}</Typography>
                    )}
                </Stack>
            )}

            {/* Messages */}
            <Stack spacing={1.5} sx={{ p: 2 }}>
                {sortedMessages.length === 0 && isRunning && (
                    <Stack spacing={1.5}>
                        {[1, 2].map((i) => (
                            <Box key={i} sx={{ bgcolor: "#151821", border: "1px solid #2A2D3A", borderLeft: "3px solid #2A2D3A", borderRadius: 2, p: 2 }}>
                                <Skeleton variant="text" width="30%" height={16} sx={{ mb: 1 }} />
                                <Skeleton variant="text" width="90%" height={14} />
                                <Skeleton variant="text" width="75%" height={14} />
                            </Box>
                        ))}
                    </Stack>
                )}
                {sortedMessages.map((msg) => (
                    <MessageCard key={msg.id} msg={msg} agents={agents} />
                ))}
            </Stack>
        </Box>
    );
}

// ── Agent Grid ─────────────────────────────────────────────────────────

function AgentsGrid({ agents }: { agents: AgentDTO[] }) {
    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 1.5,
            }}
        >
            {agents.map((agent, i) => {
                const color = AGENT_PALETTE[i % AGENT_PALETTE.length] ?? "#9CA3AF";
                return (
                    <Box
                        key={agent.id}
                        sx={{ bgcolor: "#151821", border: "1px solid #2A2D3A", borderLeft: `3px solid ${color}`, borderRadius: 2, p: 2 }}
                    >
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>
                                {agent.role}
                            </Typography>
                        </Stack>
                        <Stack spacing={0.4}>
                            <Typography variant="caption" color="text.secondary">{agent.provider} / {agent.model}</Typography>
                            <Typography variant="caption" color="text.secondary">Temp: {agent.temperature}</Typography>
                            <Typography variant="caption" color="text.secondary">Style: {agent.reasoning_style}</Typography>
                        </Stack>
                    </Box>
                );
            })}
        </Box>
    );
}

// ── Final Summary ──────────────────────────────────────────────────────

function FinalSummary({ summary }: { summary: Record<string, unknown> }) {
    const keys = Object.keys(summary);
    if (keys.length === 0) return null;

    return (
        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 2, p: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <CheckCircleIcon sx={{ color: "#34D399", fontSize: 18 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#34D399" }}>
                    Final Synthesis
                </Typography>
            </Stack>
            <Stack spacing={1.5}>
                {keys.map((k) => (
                    <Box key={k}>
                        <Typography variant="caption" sx={{ color: "#34D399", fontWeight: 700, textTransform: "uppercase", fontSize: "0.65rem", letterSpacing: "0.05em" }}>
                            {k.replace(/_/g, " ")}
                        </Typography>
                        <Typography variant="body2" color="text.primary" sx={{ mt: 0.25, lineHeight: 1.6 }}>
                            {typeof summary[k] === "string"
                                ? summary[k] as string
                                : Array.isArray(summary[k])
                                    ? (summary[k] as unknown[]).join(", ")
                                    : JSON.stringify(summary[k])}
                        </Typography>
                    </Box>
                ))}
            </Stack>
        </Box>
    );
}

// ── Progress Indicator ─────────────────────────────────────────────────

interface ProgressIndicatorProps {
    turnStatus: string;
    rounds: RoundDTO[];
    currentRoundNumber: number;
}

function ProgressIndicator({ turnStatus, rounds, currentRoundNumber }: ProgressIndicatorProps) {
    const steps = [
        { label: "Queued", done: turnStatus !== "queued" },
        { label: "Round 1", done: rounds.some((r) => r.round_number === 1 && r.status === "completed"), active: currentRoundNumber === 1 },
        { label: "Round 2", done: rounds.some((r) => r.round_number === 2 && r.status === "completed"), active: currentRoundNumber === 2 },
        { label: "Round 3", done: rounds.some((r) => r.round_number === 3 && r.status === "completed"), active: currentRoundNumber === 3 },
        { label: "Done", done: turnStatus === "completed", failed: turnStatus === "failed" },
    ];

    return (
        <Stack direction="row" alignItems="center" spacing={0.5}>
            {steps.map((step, i) => (
                <Stack key={step.label} direction="row" alignItems="center" spacing={0.5}>
                    <Stack alignItems="center" spacing={0.25}>
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                bgcolor: step.failed
                                    ? "error.main"
                                    : step.done
                                        ? "#34D399"
                                        : step.active
                                            ? "primary.main"
                                            : "#2A2D3A",
                                transition: "background 0.3s",
                            }}
                        />
                        <Typography variant="caption" sx={{ fontSize: "0.6rem", color: step.done || step.active ? "text.primary" : "text.secondary" }}>
                            {step.label}
                        </Typography>
                    </Stack>
                    {i < steps.length - 1 && (
                        <Box sx={{ width: 20, height: 1, bgcolor: step.done ? "#34D399" : "#2A2D3A", mt: "-12px", transition: "background 0.3s" }} />
                    )}
                </Stack>
            ))}
        </Stack>
    );
}

// ── Live WebSocket State ────────────────────────────────────────────────

interface LiveState {
    rounds: Map<number, RoundDTO>;
    turnStatus: string;
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function DebateDetailPage() {
    const { debateId } = useParams<{ debateId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState(0);
    const [wsError, setWsError] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "disconnected" | "error">("idle");
    const [liveState, setLiveState] = useState<LiveState | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectCountRef = useRef(0);
    const doneRef = useRef(false);

    const { data: session, isLoading, isError } = useQuery({
        queryKey: ["debate", debateId],
        queryFn: () => getDebate(debateId!),
        enabled: !!debateId,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (status === "running" || status === "queued") return 15_000;
            return false;
        },
    });

    // Determine the current turn and whether it is live
    const turn = session?.latest_turn ?? null;
    const isDebateLive = session?.status === "running" || session?.status === "queued";
    const currentRoundNumber = liveState
        ? Math.max(...Array.from(liveState.rounds.keys()), 0)
        : turn?.rounds.reduce((max, r) => Math.max(max, r.round_number), 0) ?? 0;

    // Build the effective rounds to render — merge live state over REST data
    const effectiveRounds: RoundDTO[] = (() => {
        if (!turn) return [];
        if (!liveState) return [...turn.rounds].sort((a, b) => a.round_number - b.round_number);

        const merged = new Map<number, RoundDTO>();
        for (const r of turn.rounds) merged.set(r.round_number, r);
        for (const [num, r] of liveState.rounds) {
            const existing = merged.get(num);
            if (!existing) {
                merged.set(num, r);
            } else {
                // Merge messages, deduplicate by id
                const msgMap = new Map<string, MessageDTO>();
                for (const m of existing.messages) msgMap.set(m.id, m);
                for (const m of r.messages) msgMap.set(m.id, m);
                merged.set(num, { ...existing, ...r, messages: Array.from(msgMap.values()) });
            }
        }
        return Array.from(merged.values()).sort((a, b) => a.round_number - b.round_number);
    })();

    // WebSocket connection handler
    const connectWs = useCallback((wsPath: string) => {
        if (!wsPath || doneRef.current) return;

        const fullUrl = buildWsUrl(wsPath);
        setConnectionStatus("connecting");

        const ws = new WebSocket(fullUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectCountRef.current = 0;
            setConnectionStatus("connected");
        };

        ws.onmessage = (e: MessageEvent) => {
            try {
                const event = JSON.parse(String(e.data)) as WsEvent;
                handleWsEvent(event);
            } catch {
                // ignore malformed messages
            }
        };

        ws.onclose = (ev: CloseEvent) => {
            wsRef.current = null;
            if (ev.code === 1000 || ev.code === 1001 || doneRef.current) {
                setConnectionStatus("disconnected");
                return;
            }
            if (reconnectCountRef.current < 3) {
                reconnectCountRef.current++;
                setConnectionStatus("disconnected");
                reconnectTimerRef.current = setTimeout(() => connectWs(wsPath), 2500);
            } else {
                setConnectionStatus("error");
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleWsEvent = useCallback((event: WsEvent) => {
        if (event.type === "turn_completed" || event.type === "turn_failed") {
            doneRef.current = true;
            wsRef.current?.close(1000);
            // Refetch to get authoritative final state
            setTimeout(() => {
                void queryClient.invalidateQueries({ queryKey: ["debate", debateId] });
            }, 500);
        }

        if (event.type === "turn_failed") {
            setWsError((event.payload.error as string) ?? "Debate failed");
        }

        setLiveState((prev) => {
            const rounds = new Map(prev?.rounds ?? []);
            const turnStatus = prev?.turnStatus ?? "running";

            if (event.type === "round_started" && event.round_number != null) {
                const existing = rounds.get(event.round_number);
                rounds.set(event.round_number, {
                    id: event.round_id ?? `live-round-${event.round_number}`,
                    round_number: event.round_number,
                    round_type: event.round_number === 1 ? "initial" : event.round_number === 2 ? "critique" : "final",
                    status: "running",
                    started_at: event.timestamp,
                    ended_at: null,
                    messages: existing?.messages ?? [],
                });
            }

            if (event.type === "message_created" && event.round_number != null) {
                const payload = event.payload;
                const newMsg: MessageDTO = {
                    id: (payload.message_id as string) ?? `live-msg-${Date.now()}`,
                    agent_id: event.agent_id,
                    agent_role: null,
                    message_type: (payload.message_type as string) ?? "agent_response",
                    sender_type: "agent",
                    payload: typeof payload.content === "string"
                        ? (() => { try { return JSON.parse(payload.content as string) as Record<string, unknown>; } catch { return {}; } })()
                        : {},
                    text: typeof payload.content === "string" ? payload.content : "",
                    sequence_no: (payload.sequence_no as number) ?? 0,
                    created_at: event.timestamp,
                };
                const existing = rounds.get(event.round_number) ?? {
                    id: event.round_id ?? `live-round-${event.round_number}`,
                    round_number: event.round_number,
                    round_type: event.round_number === 1 ? "initial" : event.round_number === 2 ? "critique" : "final",
                    status: "running",
                    started_at: event.timestamp,
                    ended_at: null,
                    messages: [],
                };
                const msgMap = new Map(existing.messages.map((m) => [m.id, m]));
                msgMap.set(newMsg.id, newMsg);
                rounds.set(event.round_number, { ...existing, messages: Array.from(msgMap.values()) });
            }

            if (event.type === "round_completed" && event.round_number != null) {
                const existing = rounds.get(event.round_number);
                if (existing) {
                    rounds.set(event.round_number, { ...existing, status: "completed", ended_at: event.timestamp });
                }
            }

            const newTurnStatus = event.type === "turn_completed"
                ? "completed"
                : event.type === "turn_failed"
                    ? "failed"
                    : event.type === "turn_started"
                        ? "running"
                        : turnStatus;

            return { rounds, turnStatus: newTurnStatus };
        });
    }, [debateId, queryClient]);

    // Connect WebSocket when session is live
    useEffect(() => {
        if (!session || !isDebateLive) return;
        if (wsRef.current || doneRef.current) return;
        const wsPath = session.latest_turn
            ? `/ws/chat-turns/${session.latest_turn.id}`
            : `/ws/chat-sessions/${session.id}`;
        connectWs(wsPath);
    }, [session, isDebateLive, connectWs]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            doneRef.current = true;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            wsRef.current?.close(1000);
        };
    }, []);

    const effectiveTurnStatus = liveState?.turnStatus ?? turn?.status ?? "unknown";

    // ── Render ────────────────────────────────────────────────────────

    return (
        <AppShell>
            <Box sx={{ maxWidth: 900, mx: "auto", px: 3, py: 4, width: "100%" }}>
                {/* Back button */}
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
                    <IconButton onClick={() => navigate("/debates")} size="small" sx={{ color: "text.secondary" }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="body2" color="text.secondary">All Debates</Typography>
                </Stack>

                {/* Loading */}
                {isLoading && (
                    <Stack spacing={2}>
                        <Skeleton variant="rounded" height={120} />
                        <Skeleton variant="rounded" height={80} />
                        <Skeleton variant="rounded" height={200} />
                    </Stack>
                )}

                {/* Error */}
                {isError && (
                    <Alert severity="error" action={
                        <Button size="small" startIcon={<RefreshIcon />} onClick={() => void queryClient.invalidateQueries({ queryKey: ["debate", debateId] })}>
                            Retry
                        </Button>
                    }>
                        Failed to load debate
                    </Alert>
                )}

                {/* Content */}
                {session && (
                    <Stack spacing={3}>
                        {/* Header block */}
                        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderRadius: 2, p: 2.5 }}>
                            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2} sx={{ mb: 1.5 }}>
                                <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
                                    {session.title || session.question}
                                </Typography>
                                <Chip
                                    label={session.status}
                                    color={STATUS_COLOR[session.status] ?? "default"}
                                    size="small"
                                    sx={{ flexShrink: 0, fontWeight: 600 }}
                                    icon={
                                        session.status === "running" ? <PlayArrowIcon sx={{ fontSize: "14px !important" }} /> :
                                            session.status === "completed" ? <CheckCircleIcon sx={{ fontSize: "14px !important" }} /> :
                                                session.status === "failed" ? <ErrorIcon sx={{ fontSize: "14px !important" }} /> :
                                                    <HourglassTopIcon sx={{ fontSize: "14px !important" }} />
                                    }
                                />
                            </Stack>

                            {session.title && session.title !== session.question && (
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.6 }}>
                                    {session.question}
                                </Typography>
                            )}

                            <Stack direction="row" spacing={3}>
                                <Typography variant="caption" color="text.secondary">
                                    Created: {formatDate(session.created_at)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Updated: {formatDate(session.updated_at)}
                                </Typography>
                            </Stack>

                            {/* WebSocket status and progress */}
                            {(isDebateLive || connectionStatus !== "idle") && (
                                <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid #2A2D3A" }}>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                                        <ProgressIndicator
                                            turnStatus={effectiveTurnStatus}
                                            rounds={effectiveRounds}
                                            currentRoundNumber={currentRoundNumber}
                                        />
                                        <Stack direction="row" alignItems="center" spacing={1}>
                                            {connectionStatus === "connecting" && <CircularProgress size={10} sx={{ color: "primary.main" }} />}
                                            {connectionStatus === "connected" && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#34D399" }} />}
                                            {connectionStatus === "error" && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} />}
                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.68rem" }}>
                                                {connectionStatus}
                                            </Typography>
                                        </Stack>
                                    </Stack>
                                </Box>
                            )}
                        </Box>

                        {/* WS error banner */}
                        {wsError && (
                            <Alert severity="error" onClose={() => setWsError(null)}>
                                {wsError}
                            </Alert>
                        )}

                        {/* Tabs */}
                        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                            <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ minHeight: 40 }}>
                                <Tab label="Debate" sx={{ fontWeight: 600, minHeight: 40 }} />
                                <Tab label="Agents" sx={{ fontWeight: 600, minHeight: 40 }} />
                                <Tab label="Documents" sx={{ fontWeight: 600, minHeight: 40 }} />
                            </Tabs>
                        </Box>

                        {/* Tab: Debate */}
                        {tab === 0 && (
                            <Stack spacing={3}>
                                {/* Final summary (if done) */}
                                {turn?.final_summary && Object.keys(turn.final_summary).length > 0 && (
                                    <FinalSummary summary={turn.final_summary} />
                                )}

                                {/* Round panels */}
                                {effectiveRounds.length === 0 && isDebateLive && (
                                    <Box sx={{ textAlign: "center", py: 6 }}>
                                        <CircularProgress size={32} sx={{ color: "primary.main", mb: 2 }} />
                                        <Typography variant="body2" color="text.secondary">
                                            Debate is starting…
                                        </Typography>
                                    </Box>
                                )}

                                {effectiveRounds.map((round) => (
                                    <RoundPanel
                                        key={round.id}
                                        round={round}
                                        agents={session.agents}
                                        isLive={isDebateLive}
                                    />
                                ))}
                            </Stack>
                        )}

                        {/* Tab: Agents */}
                        {tab === 1 && (
                            <Box>
                                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                                    Configured Agents ({session.agents.length})
                                </Typography>
                                <AgentsGrid agents={session.agents} />
                            </Box>
                        )}

                        {/* Tab: Documents */}
                        {tab === 2 && (
                            <DocumentsPanel sessionId={session.id} />
                        )}
                    </Stack>
                )}
            </Box>
        </AppShell>
    );
}

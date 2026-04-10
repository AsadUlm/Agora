import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    Paper,
    Stack,
    Typography,
} from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ForumIcon from "@mui/icons-material/Forum";
import MainContentLayout from "../../../components/layout/MainContentLayout";
import ModeratorPanelPlaceholder from "../../../components/layout/ModeratorPanelPlaceholder";
import type { DebatePhase, DebateRuntime } from "../../../types/ws";
import ConnectionStatusBar from "./ConnectionStatusBar";
import LiveRoundSection from "./LiveRoundSection";

// ── Header status badge ───────────────────────────────────────────────

const PHASE_CHIP: Record<
    DebatePhase,
    { label: string; color: "default" | "warning" | "success" | "error" | "info" }
> = {
    idle: { label: "Idle", color: "default" },
    starting: { label: "Starting…", color: "info" },
    live: { label: "Live", color: "warning" },
    completed: { label: "Completed", color: "success" },
    failed: { label: "Failed", color: "error" },
};

// ── Component ─────────────────────────────────────────────────────────

interface Props {
    runtime: DebateRuntime;
    phase: DebatePhase;
    onNewDebate: () => void;
}

export default function DebateLive({ runtime, phase, onNewDebate }: Props) {
    const chip = PHASE_CHIP[phase];
    const isDone = phase === "completed" || phase === "failed";

    return (
        <Box>
            {/* Page header */}
            <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={2}
                sx={{ mb: 4 }}
            >
                <Box>
                    <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        sx={{ mb: 0.5 }}
                    >
                        <ForumIcon color="primary" />
                        <Typography variant="h5">
                            {phase === "completed"
                                ? "Debate Complete"
                                : "Debate in Progress"}
                        </Typography>
                        <Chip
                            label={chip.label}
                            color={chip.color}
                            size="small"
                            sx={
                                phase === "live"
                                    ? {
                                        animation: "pulse 1.5s ease-in-out infinite",
                                        "@keyframes pulse": {
                                            "0%, 100%": { opacity: 1 },
                                            "50%": { opacity: 0.6 },
                                        },
                                    }
                                    : undefined
                            }
                        />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        {phase === "completed"
                            ? "All rounds have been completed."
                            : phase === "failed"
                                ? "The debate encountered an error."
                                : "AI agents are debating in real time…"}
                    </Typography>
                </Box>

                {isDone && (
                    <Button
                        variant="outlined"
                        startIcon={<AddCircleOutlineIcon />}
                        onClick={onNewDebate}
                        sx={{ flexShrink: 0 }}
                    >
                        New Debate
                    </Button>
                )}
            </Stack>

            <MainContentLayout
                timeline={
                    <Stack spacing={4}>
                        {/* Connection status bar */}
                        <ConnectionStatusBar
                            connectionStatus={runtime.connectionStatus}
                            phase={phase}
                        />

                        {/* Question banner */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 3,
                                bgcolor: "primary.main",
                                color: "common.white",
                                borderRadius: 2,
                            }}
                        >
                            <Typography
                                variant="caption"
                                sx={{
                                    opacity: 0.65,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.08em",
                                    fontWeight: 700,
                                    display: "block",
                                    mb: 0.75,
                                }}
                            >
                                Debate Question
                            </Typography>
                            <Typography
                                variant="h6"
                                sx={{ fontWeight: 600, lineHeight: 1.45 }}
                            >
                                {runtime.question}
                            </Typography>
                        </Paper>

                        {/* Failure banner */}
                        {phase === "failed" && runtime.error && (
                            <Alert severity="error">{runtime.error}</Alert>
                        )}

                        {/* Progressive round sections */}
                        {runtime.rounds.map((round, idx) => (
                            <Box key={round.roundNumber}>
                                {idx > 0 && <Divider sx={{ mb: 4 }} />}
                                <LiveRoundSection round={round} />
                            </Box>
                        ))}

                        {/* Empty state while connecting (no rounds yet) */}
                        {runtime.rounds.length === 0 &&
                            phase !== "failed" && (
                                <Box
                                    sx={{
                                        py: 6,
                                        textAlign: "center",
                                        color: "text.disabled",
                                    }}
                                >
                                    <ForumIcon
                                        sx={{ fontSize: 40, mb: 1, opacity: 0.4 }}
                                    />
                                    <Typography variant="body2">
                                        Waiting for first round to start…
                                    </Typography>
                                </Box>
                            )}

                        {/* Completion marker */}
                        {phase === "completed" && (
                            <Paper
                                elevation={0}
                                sx={{
                                    p: 2.5,
                                    textAlign: "center",
                                    bgcolor: "rgba(46, 125, 79, 0.08)",
                                    border: "1px solid",
                                    borderColor: "rgba(46, 125, 79, 0.3)",
                                    borderRadius: 2,
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    color="success.dark"
                                    sx={{ fontWeight: 600 }}
                                >
                                    All three rounds complete. The debate has concluded.
                                </Typography>
                            </Paper>
                        )}
                    </Stack>
                }
                sidebar={<ModeratorPanelPlaceholder />}
            />
        </Box>
    );
}

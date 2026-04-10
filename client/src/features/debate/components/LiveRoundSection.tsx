import {
    Box,
    Chip,
    CircularProgress,
    LinearProgress,
    Stack,
    Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { RoundType } from "../../../types/debate";
import type { LiveRound } from "../../../types/ws";
import LiveMessageCard from "./LiveMessageCard";

// ── Round metadata ────────────────────────────────────────────────────

const ROUND_META: Record<
    RoundType,
    { label: string; description: string; chipColor: string }
> = {
    initial: {
        label: "Round 1 — Opening Statements",
        description: "Each agent presents their initial position and key arguments.",
        chipColor: "#1B2A4A",
    },
    critique: {
        label: "Round 2 — Cross Examination",
        description: "Agents challenge and critique each other's positions.",
        chipColor: "#7B2FBE",
    },
    final: {
        label: "Round 3 — Final Synthesis",
        description: "Each agent reflects on the debate and delivers a final verdict.",
        chipColor: "#2E7D4F",
    },
};

function roundNumberToType(n: number): RoundType {
    if (n === 1) return "initial";
    if (n === 2) return "critique";
    return "final";
}

// ── Status indicators ─────────────────────────────────────────────────

function RoundStatusChip({ status }: { status: LiveRound["status"] }) {
    if (status === "completed") {
        return (
            <Chip
                icon={<CheckCircleOutlineIcon fontSize="small" />}
                label="Completed"
                size="small"
                color="success"
                variant="outlined"
            />
        );
    }
    return (
        <Chip
            icon={<CircularProgress size={12} color="inherit" />}
            label="Generating…"
            size="small"
            color="warning"
            variant="outlined"
        />
    );
}

// ── Component ─────────────────────────────────────────────────────────

interface Props {
    round: LiveRound;
}

export default function LiveRoundSection({ round }: Props) {
    const roundType = roundNumberToType(round.roundNumber);
    const meta = ROUND_META[roundType];
    const isRunning = round.status === "running";

    return (
        <Box>
            {/* Round header */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
            >
                <Box>
                    <Chip
                        label={meta.label}
                        size="small"
                        sx={{
                            bgcolor: meta.chipColor,
                            color: "common.white",
                            fontWeight: 600,
                            borderRadius: 1,
                            mb: 0.75,
                        }}
                    />
                    <Typography variant="body2" color="text.secondary">
                        {meta.description}
                    </Typography>
                </Box>
                <RoundStatusChip status={round.status} />
            </Stack>

            {/* Animated progress bar while running */}
            {isRunning && (
                <LinearProgress
                    sx={{ mb: 2, borderRadius: 1, height: 3 }}
                    color="warning"
                />
            )}

            {/* Messages */}
            <Stack spacing={2}>
                {round.messages.length > 0 ? (
                    round.messages.map((msg) => (
                        <LiveMessageCard key={msg.messageId} message={msg} />
                    ))
                ) : isRunning ? (
                    <Box sx={{ py: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
                        <CircularProgress size={14} thickness={4} color="inherit" />
                        <Typography variant="body2" color="text.secondary">
                            Waiting for agent responses…
                        </Typography>
                    </Box>
                ) : null}
            </Stack>
        </Box>
    );
}

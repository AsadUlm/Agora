import { Box, Chip, Stack, Typography } from "@mui/material";
import type { AgentRoundResult, RoundType } from "../../../types/debate";
import AgentOutput from "./AgentOutput";

const ROUND_META: Record<
    RoundType,
    { label: string; description: string; chipColor: string }
> = {
    initial: {
        label: "Round 1 — Opening Statements",
        description:
            "Each agent presents their initial position and key arguments.",
        chipColor: "#1B2A4A",
    },
    critique: {
        label: "Round 2 — Cross Examination",
        description: "Agents challenge and critique each other's positions.",
        chipColor: "#7B2FBE",
    },
    final: {
        label: "Round 3 — Final Synthesis",
        description:
            "Each agent reflects on the debate and delivers a final verdict.",
        chipColor: "#2E7D4F",
    },
};

interface RoundSectionProps {
    roundType: RoundType;
    results: AgentRoundResult[];
}

export default function RoundSection({ roundType, results }: RoundSectionProps) {
    const meta = ROUND_META[roundType];

    return (
        <Box>
            {/* Round header */}
            <Box sx={{ mb: 2.5 }}>
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

            {/* Agent outputs */}
            <Stack spacing={2}>
                {results.length > 0 ? (
                    results.map((r) => (
                        <AgentOutput key={r.agent_id} result={r} roundType={roundType} />
                    ))
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        No outputs for this round.
                    </Typography>
                )}
            </Stack>
        </Box>
    );
}

import {
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
import type {
    AgentRoundResult,
    DebateAgent,
    DebateDetail,
    GenerationStatus,
    RoundType,
} from "../../../types/debate";
import RoundSection from "./RoundSection";

// ── Adapt DebateDetail round data → AgentRoundResult[] ───────────────

function adaptRound(
    roundData: DebateDetail["rounds"][number]["data"],
    agents: DebateAgent[],
): AgentRoundResult[] {
    const agentMap: Record<string, string> = {};
    for (const a of agents) agentMap[a.id] = a.role;

    return roundData.map((entry) => ({
        agent_id: entry.agent_id,
        role: agentMap[entry.agent_id] ?? "Agent",
        content: JSON.stringify(entry.data),
        structured: entry.data,
        generation_status: "success" as GenerationStatus,
        error: null,
    }));
}

function roundTypeFor(n: number): RoundType {
    if (n === 1) return "initial";
    if (n === 2) return "critique";
    return "final";
}

interface DebateResultProps {
    response: DebateDetail;
    onNewDebate: () => void;
}

export default function DebateResult({
    response,
    onNewDebate,
}: DebateResultProps) {
    const { question, rounds, agents } = response;

    // Sort rounds by number and adapt to AgentRoundResult[]
    const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);

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
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
                        <ForumIcon color="primary" />
                        <Typography variant="h5">Debate Complete</Typography>
                        <Chip label="Completed" color="success" size="small" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        The AI agents have completed all three rounds.
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={<AddCircleOutlineIcon />}
                    onClick={onNewDebate}
                    sx={{ flexShrink: 0 }}
                >
                    New Debate
                </Button>
            </Stack>

            <MainContentLayout
                timeline={
                    <Stack spacing={4}>
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
                            <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.45 }}>
                                {question}
                            </Typography>
                        </Paper>

                        {sortedRounds.map((round, idx) => (
                            <Box key={round.id}>
                                {idx > 0 && <Divider />}
                                <RoundSection
                                    roundType={roundTypeFor(round.round_number)}
                                    results={adaptRound(round.data, agents)}
                                />
                            </Box>
                        ))}
                    </Stack>
                }
                sidebar={<ModeratorPanelPlaceholder />}
            />
        </Box>
    );
}

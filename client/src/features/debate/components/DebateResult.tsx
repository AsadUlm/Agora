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
import type { DebateStartResponse } from "../../../types/debate";
import RoundSection from "./RoundSection";

interface DebateResultProps {
    response: DebateStartResponse;
    onNewDebate: () => void;
}

export default function DebateResult({
    response,
    onNewDebate,
}: DebateResultProps) {
    const { question, result } = response;

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

                        {/* Round 1 */}
                        <RoundSection roundType="initial" results={result.round1} />
                        <Divider />

                        {/* Round 2 */}
                        <RoundSection roundType="critique" results={result.round2} />
                        <Divider />

                        {/* Round 3 */}
                        <RoundSection roundType="final" results={result.round3} />
                    </Stack>
                }
                sidebar={<ModeratorPanelPlaceholder />}
            />
        </Box>
    );
}

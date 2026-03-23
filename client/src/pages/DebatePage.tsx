import { useState } from "react";
import {
    Stack,
    Button,
    Divider,
    Alert,
    CircularProgress,
    Box,
    Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import AppShell from "../components/layout/AppShell";
import TopControlSection from "../components/layout/TopControlSection";
import MainContentLayout from "../components/layout/MainContentLayout";
import ModeratorPanelPlaceholder from "../components/layout/ModeratorPanelPlaceholder";

import QuestionComposer from "../components/debate/QuestionComposer";
import AgentSetup from "../components/debate/AgentSetup";
import SelectedAgents from "../components/debate/SelectedAgents";
import DebateSettings from "../components/debate/DebateSettings";
import DebateTimeline from "../components/debate/DebateTimeline";

import { useStartDebate } from "../hooks/useStartDebate";
import type { AgentInput } from "../types/debate";

const DEFAULT_AGENTS: AgentInput[] = [
    { role: "analyst" },
    { role: "critic" },
];

export default function DebatePage() {
    const [question, setQuestion] = useState("");
    const [agents, setAgents] = useState<AgentInput[]>(DEFAULT_AGENTS);
    const { result, loading, error, run } = useStartDebate();

    const canStart = question.trim().length > 0 && agents.length > 0 && !loading;

    const handleStart = () => {
        if (!canStart) return;
        run(question, agents);
    };

    const handleRemoveAgent = (index: number) => {
        setAgents((prev) => prev.filter((_, i) => i !== index));
    };

    return (
        <AppShell>
            {/* ── Top Control Area ───────────────────────────── */}
            <TopControlSection>
                <Stack spacing={3}>
                    <QuestionComposer
                        value={question}
                        onChange={setQuestion}
                        disabled={loading}
                    />

                    <Divider />

                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                            gap: 3,
                        }}
                    >
                        <AgentSetup
                            agents={agents}
                            onChange={setAgents}
                            disabled={loading}
                        />
                        <SelectedAgents
                            agents={agents}
                            onRemove={handleRemoveAgent}
                            disabled={loading}
                        />
                    </Box>

                    <Divider />

                    <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ sm: "center" }}
                        spacing={2}
                    >
                        <DebateSettings />

                        <Button
                            variant="contained"
                            size="large"
                            startIcon={
                                loading ? (
                                    <CircularProgress size={20} color="inherit" />
                                ) : (
                                    <PlayArrowIcon />
                                )
                            }
                            disabled={!canStart}
                            onClick={handleStart}
                            sx={{ minWidth: 180 }}
                        >
                            {loading ? "Running…" : "Start Debate"}
                        </Button>
                    </Stack>

                    {error && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                            {error}
                        </Alert>
                    )}
                </Stack>
            </TopControlSection>

            {/* ── Main Content: Timeline + Moderator ─────────── */}
            {result ? (
                <MainContentLayout
                    timeline={
                        <DebateTimeline result={result.result} question={result.question} />
                    }
                    sidebar={<ModeratorPanelPlaceholder />}
                />
            ) : (
                !loading && (
                    <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
                        <Typography variant="h6" sx={{ mb: 1 }}>
                            No debate yet
                        </Typography>
                        <Typography variant="body2">
                            Enter a question, configure your agents, and start the debate.
                        </Typography>
                    </Box>
                )
            )}
        </AppShell>
    );
}

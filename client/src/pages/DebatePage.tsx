import { useState } from "react";
import { Box, Typography } from "@mui/material";

import AppShell from "../components/layout/AppShell";
import MainContentLayout from "../components/layout/MainContentLayout";
import ModeratorPanelPlaceholder from "../components/layout/ModeratorPanelPlaceholder";

import DebateComposer from "../components/debate/DebateComposer";
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

    const handleAddAgent = (agent: AgentInput) => {
        setAgents((prev) => [...prev, agent]);
    };

    return (
        <AppShell>
            {/* ── Debate Composer ────────────────────────── */}
            <DebateComposer
                question={question}
                onQuestionChange={setQuestion}
                agents={agents}
                onAddAgent={handleAddAgent}
                onRemoveAgent={handleRemoveAgent}
                canStart={canStart}
                loading={loading}
                error={error}
                onStart={handleStart}
            />

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

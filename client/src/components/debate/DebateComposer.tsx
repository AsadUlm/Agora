import { Box, Alert } from "@mui/material";
import ComposerTextarea from "./ComposerTextarea";
import ComposerControlBar from "./ComposerControlBar";
import AgentPicker from "./AgentPicker";
import DebateMetaControls from "./DebateMetaControls";
import StartDebateButton from "./StartDebateButton";
import type { AgentInput } from "../../types/debate";

interface DebateComposerProps {
    question: string;
    onQuestionChange: (value: string) => void;
    agents: AgentInput[];
    onAddAgent: (agent: AgentInput) => void;
    onRemoveAgent: (index: number) => void;
    canStart: boolean;
    loading: boolean;
    error: string | null;
    onStart: () => void;
}

export default function DebateComposer({
    question,
    onQuestionChange,
    agents,
    onAddAgent,
    onRemoveAgent,
    canStart,
    loading,
    error,
    onStart,
}: DebateComposerProps) {
    return (
        <Box sx={{ width: "100%", mb: 4 }}>
            <Box
                sx={{
                    bgcolor: "background.paper",
                    borderRadius: 3,
                    border: "1px solid",
                    borderColor: "divider",
                    overflow: "hidden",
                    transition: "border-color 0.2s",
                    "&:focus-within": {
                        borderColor: "secondary.light",
                    },
                }}
            >
                {/* ── Textarea ──────────────────────────────── */}
                <ComposerTextarea
                    value={question}
                    onChange={onQuestionChange}
                    disabled={loading}
                />

                {/* ── Control Bar ───────────────────────────── */}
                <ComposerControlBar
                    left={
                        <AgentPicker
                            agents={agents}
                            onAdd={onAddAgent}
                            onRemove={onRemoveAgent}
                            disabled={loading}
                        />
                    }
                    right={
                        <>
                            <DebateMetaControls />
                            <StartDebateButton
                                disabled={!canStart}
                                loading={loading}
                                onClick={onStart}
                            />
                        </>
                    }
                />
            </Box>

            {/* Error below the composer */}
            {error && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                    {error}
                </Alert>
            )}
        </Box>
    );
}

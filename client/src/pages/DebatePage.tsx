import { Box, CircularProgress, Typography } from "@mui/material";
import AppShell from "../components/layout/AppShell";
import DebateForm from "../features/debate/components/DebateForm";
import DebateResult from "../features/debate/components/DebateResult";
import { useDebate } from "../features/debate/hooks/useDebate";

// ── Loading state while backend is running all 3 rounds ───────────────

function DebatingLoader() {
    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 420,
                gap: 3,
            }}
        >
            <CircularProgress size={52} thickness={3.5} />
            <Box sx={{ textAlign: "center" }}>
                <Typography variant="h6" sx={{ mb: 0.75 }}>
                    AI agents are debating…
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    All three rounds are being generated. This may take up to a minute.
                </Typography>
            </Box>
        </Box>
    );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function DebatePage() {
    const debate = useDebate();

    let content: React.ReactNode;

    if (debate.isSubmitting) {
        content = <DebatingLoader />;
    } else if (debate.result) {
        content = (
            <DebateResult response={debate.result} onNewDebate={debate.reset} />
        );
    } else {
        content = (
            <DebateForm
                question={debate.question}
                onQuestionChange={debate.setQuestion}
                agents={debate.agents}
                onAddAgent={debate.addAgent}
                onUpdateAgent={debate.updateAgent}
                onRemoveAgent={debate.removeAgent}
                onSubmit={debate.submit}
                isSubmitting={debate.isSubmitting}
                submitError={debate.submitError}
                onClearError={debate.clearError}
            />
        );
    }

    return <AppShell>{content}</AppShell>;
}

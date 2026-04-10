import { Box, CircularProgress, Typography } from "@mui/material";
import AppShell from "../components/layout/AppShell";
import DebateForm from "../features/debate/components/DebateForm";
import DebateLive from "../features/debate/components/DebateLive";
import { useDebate } from "../features/debate/hooks/useDebate";

// ── Brief spinner shown during POST + GET hydration (~200 ms) ─────────

function StartingLoader() {
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
                    Starting debate…
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Preparing agents and opening the live stream.
                </Typography>
            </Box>
        </Box>
    );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function DebatePage() {
    const debate = useDebate();

    // Evaluated before branching so TypeScript narrowing doesn't eliminate "starting"
    const isStarting = debate.phase === "starting";

    let content: React.ReactNode;

    if (debate.runtime) {
        // Live (starting → live → completed | failed)
        content = (
            <DebateLive
                runtime={debate.runtime}
                phase={debate.phase}
                onNewDebate={debate.reset}
            />
        );
    } else if (debate.phase !== "idle" && debate.phase !== "failed") {
        // Runtime not yet set but debate was submitted ("starting" phase, brief ~200ms)
        content = <StartingLoader />;
    } else {
        // idle (or failed before runtime was ever set)
        content = (
            <DebateForm
                question={debate.question}
                onQuestionChange={debate.setQuestion}
                agents={debate.agents}
                onAddAgent={debate.addAgent}
                onUpdateAgent={debate.updateAgent}
                onRemoveAgent={debate.removeAgent}
                onSubmit={debate.submit}
                isSubmitting={isStarting}
                submitError={debate.submitError}
                onClearError={debate.clearError}
            />
        );
    }

    return <AppShell>{content}</AppShell>;
}

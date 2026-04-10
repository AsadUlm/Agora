import {
    Box,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Stack,
    Typography,
} from "@mui/material";
import ForumIcon from "@mui/icons-material/Forum";
import { useEffect, useState } from "react";
import AppShell from "../components/layout/AppShell";
import { listDebates } from "../services/debateService";
import type { DebateListItem, DebateStatus } from "../types/debate";

// ── Helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<
    DebateStatus,
    "success" | "error" | "warning" | "default"
> = {
    completed: "success",
    failed: "error",
    running: "warning",
    queued: "default",
    unknown: "default",
};

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// ── Page ──────────────────────────────────────────────────────────────

export default function DebateHistoryPage() {
    const [debates, setDebates] = useState<DebateListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        listDebates()
            .then(setDebates)
            .catch(() => setError("Failed to load debate history. Please try again."))
            .finally(() => setLoading(false));
    }, []);

    function renderBody() {
        if (loading) {
            return (
                <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
                    <CircularProgress />
                </Box>
            );
        }

        if (error) {
            return (
                <Typography color="error" sx={{ py: 4 }}>
                    {error}
                </Typography>
            );
        }

        if (debates.length === 0) {
            return (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        py: 12,
                        gap: 2,
                    }}
                >
                    <ForumIcon sx={{ fontSize: 52, color: "text.disabled" }} />
                    <Typography variant="h6" color="text.secondary">
                        No debates yet
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Start your first debate from the home page.
                    </Typography>
                </Box>
            );
        }

        return (
            <Stack spacing={2}>
                {debates.map((d) => (
                    <Card key={d.id} elevation={0}>
                        <CardContent>
                            <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="flex-start"
                                spacing={2}
                            >
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography
                                        variant="body1"
                                        sx={{ fontWeight: 500, mb: 0.5, wordBreak: "break-word" }}
                                    >
                                        {d.title || "(No title)"}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatDate(d.created_at)}
                                    </Typography>
                                </Box>
                                <Chip
                                    label={d.status}
                                    color={STATUS_COLOR[d.status] ?? "default"}
                                    size="small"
                                    sx={{ flexShrink: 0, textTransform: "capitalize" }}
                                />
                            </Stack>
                        </CardContent>
                    </Card>
                ))}
            </Stack>
        );
    }

    return (
        <AppShell>
            <Box sx={{ maxWidth: 800, mx: "auto" }}>
                <Box sx={{ mb: 4 }}>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>
                        Debate History
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        All debates started in your account.
                    </Typography>
                </Box>
                {renderBody()}
            </Box>
        </AppShell>
    );
}

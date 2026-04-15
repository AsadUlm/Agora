import AddIcon from "@mui/icons-material/Add";
import ForumIcon from "@mui/icons-material/Forum";
import {
    Alert,
    Box,
    Button,
    Chip,
    Skeleton,
    Stack,
    Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { listDebates } from "../services/debateService";
import type { DebateStatus, SessionListItemDTO } from "../types/debate";

const STATUS_COLOR: Record<DebateStatus, "default" | "warning" | "info" | "success" | "error"> = {
    idle: "default",
    queued: "warning",
    running: "info",
    completed: "success",
    failed: "error",
    unknown: "default",
};

const STATUS_LABEL: Record<DebateStatus, string> = {
    idle: "Idle",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    unknown: "Unknown",
};

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function DebateCard({ debate, onClick }: { debate: SessionListItemDTO; onClick: () => void }) {
    const status = (debate.status ?? "unknown") as DebateStatus;
    return (
        <Box
            onClick={onClick}
            sx={{
                bgcolor: "#1A1D27",
                border: "1px solid #2A2D3A",
                borderRadius: 2,
                p: 2.5,
                cursor: "pointer",
                transition: "border-color 0.15s, box-shadow 0.15s",
                "&:hover": {
                    borderColor: "primary.main",
                    boxShadow: "0 0 0 1px rgba(245,166,35,0.25)",
                },
            }}
        >
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 700, color: "text.primary", mb: 0.5 }}
                        noWrap
                    >
                        {debate.title || debate.question}
                    </Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            mb: 1.5,
                        }}
                    >
                        {debate.question}
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Chip
                            label={STATUS_LABEL[status]}
                            color={STATUS_COLOR[status]}
                            size="small"
                            sx={{ height: 22, fontSize: "0.72rem", fontWeight: 600 }}
                        />
                        <Typography variant="caption" color="text.secondary">
                            {formatDate(debate.created_at)}
                        </Typography>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

function SkeletonCard() {
    return (
        <Box sx={{ bgcolor: "#1A1D27", border: "1px solid #2A2D3A", borderRadius: 2, p: 2.5 }}>
            <Skeleton variant="text" width="60%" height={24} sx={{ mb: 1 }} />
            <Skeleton variant="text" width="90%" height={18} />
            <Skeleton variant="text" width="70%" height={18} sx={{ mb: 1.5 }} />
            <Skeleton variant="rounded" width={80} height={22} />
        </Box>
    );
}

export default function DebatesPage() {
    const navigate = useNavigate();

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["debates"],
        queryFn: listDebates,
    });

    return (
        <AppShell>
            <Box sx={{ maxWidth: 800, mx: "auto", px: 3, py: 4, width: "100%" }}>
                {/* Header */}
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 4 }}>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700, color: "text.primary", mb: 0.5 }}>
                            Debates
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Your AI-powered debate sessions
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate("/debates/new")}
                        sx={{ flexShrink: 0 }}
                    >
                        New Debate
                    </Button>
                </Stack>

                {/* Loading state */}
                {isLoading && (
                    <Stack spacing={2}>
                        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
                    </Stack>
                )}

                {/* Error state */}
                {isError && (
                    <Alert severity="error">
                        {error instanceof Error ? error.message : "Failed to load debates"}
                    </Alert>
                )}

                {/* Empty state */}
                {!isLoading && !isError && (!data || data.length === 0) && (
                    <Box
                        sx={{
                            textAlign: "center",
                            py: 10,
                            color: "text.secondary",
                        }}
                    >
                        <ForumIcon sx={{ fontSize: 56, opacity: 0.25, mb: 2 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1, color: "text.secondary" }}>
                            No debates yet
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Start your first AI-powered debate and watch agents argue in real time.
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => navigate("/debates/new")}
                        >
                            Start a debate
                        </Button>
                    </Box>
                )}

                {/* Debate list */}
                {!isLoading && data && data.length > 0 && (
                    <Stack spacing={1.5}>
                        {data.map((debate) => (
                            <DebateCard
                                key={debate.id}
                                debate={debate}
                                onClick={() => navigate(`/debates/${debate.id}`)}
                            />
                        ))}
                    </Stack>
                )}
            </Box>
        </AppShell>
    );
}

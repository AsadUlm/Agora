import MenuIcon from "@mui/icons-material/Menu";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { Box, Chip, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { DebateStatus } from "../../types/debate";

export const MODERATOR_EXPANDED = 272;
export const MODERATOR_COLLAPSED = 48;
const SIDEBAR_BG = "#090B0F";

interface ModeratorSidebarProps {
    open: boolean;
    onToggle: () => void;
    // Live debate data (optional — gracefully defaults to "—")
    roundOverview?: string;
    agreementMap?: string;
    conflictMap?: string;
    keyInsight?: string;
    nextStep?: string;
    status?: DebateStatus;
    currentRound?: number;
}

const ROUND_LABELS: Record<number, string> = {
    1: "Opening Statements",
    2: "Cross Examination",
    3: "Final Synthesis",
};

const ROUND_COLORS: Record<number, string> = {
    1: "#6C8EF5",
    2: "#F5A623",
    3: "#34D399",
};

export default function ModeratorSidebar({
    open,
    onToggle,
    roundOverview = "Waiting for debate to begin…",
    agreementMap = "—",
    conflictMap = "—",
    keyInsight = "—",
    nextStep = "—",
    status,
    currentRound = 0,
}: ModeratorSidebarProps) {
    const sections = [
        {
            icon: <AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />,
            label: "Round Overview",
            content: roundOverview,
            extra: currentRound > 0 && (
                <Chip
                    label={`Round ${currentRound} — ${ROUND_LABELS[currentRound] ?? ""}`}
                    size="small"
                    sx={{
                        mt: 0.75,
                        height: 18,
                        fontSize: "0.6rem",
                        bgcolor: `${ROUND_COLORS[currentRound] ?? "#9CA3AF"}20`,
                        color: ROUND_COLORS[currentRound] ?? "#9CA3AF",
                        border: "none",
                        fontWeight: 700,
                    }}
                />
            ),
        },
        {
            icon: <HandshakeRoundedIcon sx={{ fontSize: 14 }} />,
            label: "Agreement Map",
            content: agreementMap,
            extra: null,
        },
        {
            icon: <CompareArrowsRoundedIcon sx={{ fontSize: 14 }} />,
            label: "Conflict Map",
            content: conflictMap,
            extra: null,
        },
        {
            icon: <LightbulbRoundedIcon sx={{ fontSize: 14 }} />,
            label: "Key Insight",
            content: keyInsight,
            extra: null,
        },
        {
            icon: <ArrowForwardRoundedIcon sx={{ fontSize: 14 }} />,
            label: "Next Step",
            content: nextStep,
            extra: status === "completed"
                ? <Chip label="✓ Debate Complete" size="small" sx={{ mt: 0.75, height: 18, fontSize: "0.6rem", bgcolor: "rgba(52,211,153,0.12)", color: "#34D399", border: "none", fontWeight: 700 }} />
                : null,
        },
    ];

    return (
        <Box
            component="aside"
            sx={{
                position: "fixed",
                top: 0,
                right: 0,
                height: "100vh",
                width: open ? MODERATOR_EXPANDED : MODERATOR_COLLAPSED,
                bgcolor: SIDEBAR_BG,
                borderLeft: "1px solid",
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
                zIndex: 100,
            }}
        >
            {/* Top row — hamburger */}
            <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ px: 1.25, py: 2, flexShrink: 0 }}
            >
                <Tooltip title={open ? "Collapse" : "Moderator"} placement="left">
                    <IconButton
                        size="small"
                        onClick={onToggle}
                        sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
                    >
                        <MenuIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                </Tooltip>

                <Box
                    sx={{
                        overflow: "hidden",
                        opacity: open ? 1 : 0,
                        width: open ? "auto" : 0,
                        transition: "opacity 0.18s, width 0.22s",
                        whiteSpace: "nowrap",
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                    }}
                >
                    <GavelRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: "text.primary" }}>
                        Moderator
                    </Typography>
                </Box>
            </Stack>

            <Divider sx={{ borderColor: "divider" }} />

            {/* Sections */}
            <Box
                sx={{
                    overflowY: "auto",
                    flexGrow: 1,
                    opacity: open ? 1 : 0,
                    transition: "opacity 0.18s",
                    pointerEvents: open ? "auto" : "none",
                }}
            >
                {sections.map((s, i) => (
                    <Box key={s.label}>
                        <Box sx={{ px: 2, py: 1.75 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                                <Box sx={{ color: "primary.main", display: "flex" }}>{s.icon}</Box>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontWeight: 700,
                                        color: "text.secondary",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.06em",
                                        fontSize: "0.65rem",
                                    }}
                                >
                                    {s.label}
                                </Typography>
                            </Stack>
                            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.6 }}>
                                {s.content}
                            </Typography>
                            {s.extra}
                        </Box>
                        {i < sections.length - 1 && <Divider sx={{ borderColor: "divider" }} />}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

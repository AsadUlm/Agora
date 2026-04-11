import MenuIcon from "@mui/icons-material/Menu";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { Box, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";

export const MODERATOR_EXPANDED = 260;
export const MODERATOR_COLLAPSED = 48;
const SIDEBAR_BG = "#090B0F";

interface ModeratorSidebarProps {
    open: boolean;
    onToggle: () => void;
}

const SECTIONS = [
    { icon: <AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />, label: "Round Overview", content: "Waiting for debate to begin…" },
    { icon: <HandshakeRoundedIcon sx={{ fontSize: 14 }} />, label: "Agreement Map", content: "—" },
    { icon: <CompareArrowsRoundedIcon sx={{ fontSize: 14 }} />, label: "Conflict Map", content: "—" },
    { icon: <LightbulbRoundedIcon sx={{ fontSize: 14 }} />, label: "Key Insight", content: "—" },
    { icon: <ArrowForwardRoundedIcon sx={{ fontSize: 14 }} />, label: "Next Step", content: "—" },
];

export default function ModeratorSidebar({ open, onToggle }: ModeratorSidebarProps) {
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
            {/* Top row — hamburger aligned with left sidebar logo */}
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
                {SECTIONS.map((s, i) => (
                    <Box key={s.label}>
                        <Box sx={{ px: 2, py: 1.75 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                                <Box sx={{ color: "primary.main", display: "flex" }}>{s.icon}</Box>
                                <Typography
                                    variant="caption"
                                    sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.65rem" }}
                                >
                                    {s.label}
                                </Typography>
                            </Stack>
                            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem", lineHeight: 1.6 }}>
                                {s.content}
                            </Typography>
                        </Box>
                        {i < SECTIONS.length - 1 && <Divider sx={{ borderColor: "divider" }} />}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

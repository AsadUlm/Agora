import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { Box, Button, Stack, Typography } from "@mui/material";

interface ModeratorCardProps {
    open: boolean;
}

const SECTIONS = [
    { icon: <AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />, label: "Round Overview", content: "Waiting for debate to begin…" },
    { icon: <HandshakeRoundedIcon sx={{ fontSize: 14 }} />, label: "Agreement Map", content: "—" },
    { icon: <CompareArrowsRoundedIcon sx={{ fontSize: 14 }} />, label: "Conflict Map", content: "—" },
    { icon: <LightbulbRoundedIcon sx={{ fontSize: 14 }} />, label: "Key Insight", content: "—" },
    { icon: <ArrowForwardRoundedIcon sx={{ fontSize: 14 }} />, label: "Next Step", content: "—" },
];

export default function ModeratorCard({ open }: ModeratorCardProps) {
    if (!open) return null;

    return (
        <Box
            sx={{
                width: 280,
                bgcolor: "#16192A",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 3,
                boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                overflow: "hidden",
                position: "fixed",
                top: 72,
                right: 20,
                zIndex: 200,
                maxHeight: "calc(100vh - 92px)",
                overflowY: "auto",
            }}
        >
            {/* Card header */}
            <Stack
                direction="row"
                alignItems="center"
                spacing={0.75}
                sx={{ px: 2, py: 1.75 }}
            >
                <GavelRoundedIcon sx={{ fontSize: 16, color: "primary.main" }} />
                <Typography variant="body2" sx={{ fontWeight: 700, color: "text.primary" }}>
                    Moderator
                </Typography>
            </Stack>

            {/* Sections */}
            {SECTIONS.map((s) => (
                <Box key={s.label} sx={{ px: 2, py: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
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
                </Box>
            ))}

            {/* Start Cross Debate button */}
            <Box sx={{ px: 2, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
                <Button
                    fullWidth
                    variant="contained"
                    sx={{
                        bgcolor: "primary.main",
                        color: "#0F1117",
                        fontWeight: 700,
                        borderRadius: "999px",
                        textTransform: "none",
                        "&:hover": { bgcolor: "primary.light" },
                    }}
                >
                    Start Cross Debate
                </Button>
            </Box>
        </Box>
    );
}

import AddIcon from "@mui/icons-material/Add";
import BalanceIcon from "@mui/icons-material/Balance";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { Box, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import AppShell from "../components/layout/AppShell";

const MAX_CHARS = 500;

interface TabDef {
    icon: React.ReactNode;
    label: string;
    badge?: string;
}

const TABS: TabDef[] = [
    { icon: <BalanceIcon sx={{ fontSize: 15 }} />, label: "Start Debate" },
    { icon: <GroupsRoundedIcon sx={{ fontSize: 15 }} />, label: "Agent Setup", badge: "Configure agents" },
];

export default function HomePage() {
    const [tab, setTab] = useState(0);
    const [question, setQuestion] = useState("");

    const remaining = MAX_CHARS - question.length;
    const canSubmit = question.trim().length > 0 && remaining >= 0;

    function handleSubmit() {
        if (!canSubmit) return;
        console.log("Starting debate:", question.trim());
    }

    return (
        <AppShell>
            <Box
                sx={{
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    px: 3,
                    minHeight: "100vh",
                }}
            >
                <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, color: "text.primary", mb: 4, textAlign: "center" }}
                >
                    Where should we begin?
                </Typography>

                {/* ── Folder bookmark tabs ── */}
                <Stack direction="row" spacing={1} sx={{ width: "100%", maxWidth: 700, mb: "-1px", zIndex: 1, position: "relative", pl: 2 }}>
                    {TABS.map((t, i) => {
                        const selected = tab === i;
                        return (
                            <Stack
                                key={t.label}
                                direction="row"
                                alignItems="center"
                                spacing={0.75}
                                onClick={() => setTab(i)}
                                sx={{
                                    px: 2,
                                    py: 0.9,
                                    borderRadius: "10px 10px 0 0",
                                    border: "1px solid rgba(255,255,255,0.15)",
                                    borderBottom: selected ? `1px solid #1E2130` : "1px solid rgba(255,255,255,0.15)",
                                    bgcolor: selected ? "#1E2130" : "transparent",
                                    cursor: "pointer",
                                    userSelect: "none",
                                    transition: "all 0.15s",
                                    "&:hover": {
                                        bgcolor: selected ? "#1E2130" : "rgba(255,255,255,0.04)",
                                    },
                                }}
                            >
                                <Box sx={{ color: selected ? "text.primary" : "text.secondary", display: "flex" }}>
                                    {t.icon}
                                </Box>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 600,
                                        fontSize: "0.85rem",
                                        color: selected ? "text.primary" : "text.secondary",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {t.label}
                                </Typography>
                                {t.badge && (
                                    <Typography
                                        variant="body2"
                                        sx={{ fontWeight: 600, fontSize: "0.85rem", color: "primary.main" }}
                                    >
                                        {t.badge}
                                    </Typography>
                                )}
                            </Stack>
                        );
                    })}
                </Stack>

                {/* ── Input card (no tabs inside) ── */}
                <Box
                    sx={{
                        width: "100%",
                        maxWidth: 700,
                        bgcolor: "#1E2130",
                        borderRadius: "16px",
                        border: "1px solid #2E3248",
                        boxShadow: "0 8px 40px rgba(0,0,0,0.45)",
                        overflow: "hidden",
                    }}
                >
                    {/* ── Text input area ── */}
                    <Box sx={{ position: "relative", px: 2.5, pt: 2, pb: 1 }}>
                        <InputBase
                            fullWidth
                            multiline
                            minRows={4}
                            maxRows={10}
                            placeholder={
                                tab === 0
                                    ? "Ask anything, debate anything…"
                                    : "Describe the agents you want — roles, perspectives, models…"
                            }
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            inputProps={{ maxLength: MAX_CHARS }}
                            sx={{
                                fontSize: "0.97rem",
                                color: "text.primary",
                                alignItems: "flex-start",
                                pr: 5,
                                "& textarea::placeholder": { color: "text.secondary", opacity: 1 },
                            }}
                        />
                        {/* Top-right icon — like Grammarly G */}
                        <Box
                            sx={{
                                position: "absolute",
                                top: 10,
                                right: 14,
                                width: 38,
                                height: 38,
                                borderRadius: "50%",
                                border: "2px solid",
                                borderColor: "primary.main",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                opacity: 0.7,
                            }}
                        >
                            <BalanceIcon sx={{ fontSize: 20, color: "primary.main" }} />
                        </Box>
                    </Box>

                    {/* ── Bottom toolbar ── */}
                    <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ px: 2, pb: 1.5, pt: 0.5 }}
                    >
                        {/* Left icons */}
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                            <Tooltip title="Attach document">
                                <IconButton
                                    size="small"
                                    sx={{
                                        width: 32, height: 32,
                                        color: "text.secondary",
                                        border: "1px solid #3A3E52",
                                        borderRadius: "50%",
                                        "&:hover": { color: "text.primary", borderColor: "text.secondary" },
                                    }}
                                >
                                    <AddIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Agent personas">
                                <IconButton
                                    size="small"
                                    sx={{
                                        width: 32, height: 32,
                                        color: "text.secondary",
                                        border: "1px solid #3A3E52",
                                        borderRadius: "50%",
                                        "&:hover": { color: "text.primary", borderColor: "text.secondary" },
                                    }}
                                >
                                    <GroupsRoundedIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                            {/* Settings pill — mirrors "Ultra" pill in reference */}
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={0.5}
                                sx={{
                                    px: 1.25, height: 32,
                                    border: "1px solid #3A3E52",
                                    borderRadius: "999px",
                                    cursor: "pointer",
                                    color: "text.secondary",
                                    "&:hover": { color: "text.primary", borderColor: "text.secondary" },
                                    transition: "all 0.15s",
                                }}
                            >
                                <SettingsRoundedIcon sx={{ fontSize: 14 }} />
                                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.75rem", color: "inherit" }}>
                                    Settings
                                </Typography>
                            </Stack>
                        </Stack>

                        {/* Right: char count + Start Debate pill */}
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                            {question.length > 0 && (
                                <Typography variant="caption" color={remaining < 50 ? "warning.main" : "text.secondary"}>
                                    {remaining}
                                </Typography>
                            )}
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={0.75}
                                onClick={handleSubmit}
                                sx={{
                                    bgcolor: canSubmit ? "primary.main" : "#2A2E42",
                                    color: canSubmit ? "#0F1117" : "text.secondary",
                                    borderRadius: "999px",
                                    px: 2, py: 0.85,
                                    cursor: canSubmit ? "pointer" : "default",
                                    transition: "all 0.2s",
                                    userSelect: "none",
                                    "&:hover": canSubmit ? { bgcolor: "primary.light" } : {},
                                }}
                            >
                                <PlayArrowRoundedIcon sx={{ fontSize: 17 }} />
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem" }}>
                                    Start Debate
                                </Typography>
                            </Stack>
                        </Stack>
                    </Stack>
                </Box>
            </Box>
        </AppShell>
    );
}

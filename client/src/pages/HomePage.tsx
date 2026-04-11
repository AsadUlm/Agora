import AddIcon from "@mui/icons-material/Add";
import BalanceIcon from "@mui/icons-material/Balance";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { Box, IconButton, InputBase, Stack, Tooltip, Typography, Zoom } from "@mui/material";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { useState } from "react";
import AppShell from "../components/layout/AppShell";
import ModeratorCard from "../components/debate/ModeratorCard";

const MAX_CHARS = 500;

const TABS = [
    { icon: <BalanceIcon sx={{ fontSize: 15 }} />, label: "Start Debate", badge: null },
    { icon: <GroupsRoundedIcon sx={{ fontSize: 15 }} />, label: "Agent Setup", badge: "Configure agents" },
];

export default function HomePage() {
    const [tab, setTab] = useState(0);
    const [question, setQuestion] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [moderatorOpen, setModeratorOpen] = useState(true);

    const canSubmit = question.trim().length > 0 && question.length <= MAX_CHARS;

    function handleSubmit() {
        if (!canSubmit) return;
        setSubmitted(true);
        // TODO: kick off debate session
        console.log("Starting debate:", question.trim());
    }

    return (
        <AppShell>
            <Box
                sx={{
                    display: "flex",
                    minHeight: "100vh",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: submitted ? "flex-start" : "center",
                    pt: submitted ? 3 : 0,
                    px: 3,
                    pr: submitted && moderatorOpen ? "316px" : 3,
                    transition: "padding-top 0.4s cubic-bezier(0.4,0,0.2,1), padding-right 0.25s cubic-bezier(0.4,0,0.2,1)",
                }}
            >
                {/* Heading — hides after submit */}
                {!submitted && (
                    <Typography
                        variant="h4"
                        sx={{ fontWeight: 700, color: "text.primary", mb: 4, textAlign: "center" }}
                    >
                        Where should we begin?
                    </Typography>
                )}

                {/* Prompt area */}
                <Box sx={{ width: "100%", maxWidth: 700 }}>

                    {/* Folder tabs */}
                    <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mb: "-1px", zIndex: 1, position: "relative", pl: 2 }}
                    >
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
                                        borderBottom: selected
                                            ? "1px solid #1E2130"
                                            : "1px solid rgba(255,255,255,0.15)",
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

                    {/* Input card */}
                    <Box
                        sx={{
                            bgcolor: "#1E2130",
                            borderRadius: "16px",
                            border: "1px solid #2E3248",
                            boxShadow: "0 8px 40px rgba(0,0,0,0.45)",
                            overflow: "hidden",
                        }}
                    >
                        {/* Text area */}
                        <Box sx={{ px: 2.5, pt: 2, pb: 1 }}>
                            <InputBase
                                fullWidth
                                multiline
                                minRows={submitted ? 2 : 4}
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
                                    "& textarea::placeholder": { color: "text.secondary", opacity: 1 },
                                }}
                            />
                        </Box>

                        {/* Bottom toolbar */}
                        <Stack
                            direction="row"
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ px: 2, pb: 1.5, pt: 0.5 }}
                        >
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
                                <Tooltip title="Debate settings">
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
                                </Tooltip>
                            </Stack>

                            {/* Start button */}
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={0.75}
                                onClick={handleSubmit}
                                sx={{
                                    bgcolor: canSubmit ? "primary.main" : "#2A2E42",
                                    borderRadius: "999px",
                                    px: 2, py: 0.85,
                                    cursor: canSubmit ? "pointer" : "default",
                                    transition: "all 0.2s",
                                    userSelect: "none",
                                    "&:hover": canSubmit ? { bgcolor: "primary.light" } : {},
                                }}
                            >
                                <PlayArrowRoundedIcon sx={{ fontSize: 17, color: canSubmit ? "#0F1117" : "text.secondary" }} />
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.82rem", color: canSubmit ? "#0F1117" : "text.secondary" }}>
                                    Start
                                </Typography>
                            </Stack>
                        </Stack>
                    </Box>
                </Box>

                {/* Debate timeline — appears after submit */}
                {submitted && (
                    <Box sx={{ width: "100%", mt: 4 }}>
                        {/* Round content will go here */}
                    </Box>
                )}

            </Box>

            {/* Moderator card — fixed below amber button */}
            <ModeratorCard open={moderatorOpen && submitted} />

            {/* Floating amber moderator toggle button */}
            {submitted && (
                <Zoom in={submitted}>
                    <Tooltip title="Moderator" placement="left">
                        <IconButton
                            onClick={() => setModeratorOpen((v) => !v)}
                            sx={{
                                position: "fixed",
                                top: 20,
                                right: 20,
                                width: 42,
                                height: 42,
                                bgcolor: "primary.main",
                                color: "#0F1117",
                                borderRadius: "50%",
                                boxShadow: "0 4px 16px rgba(245,166,35,0.35)",
                                zIndex: 201,
                                "&:hover": { bgcolor: "primary.light" },
                            }}
                        >
                            <MenuRoundedIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                </Zoom>
            )}

        </AppShell>
    );
}

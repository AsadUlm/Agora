import BalanceIcon from "@mui/icons-material/Balance";
import LogoutIcon from "@mui/icons-material/Logout";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionIcon from "@mui/icons-material/Description";
import HistoryIcon from "@mui/icons-material/History";
import { Avatar, Box, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";

import type { ReactNode } from "react";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";

interface AppShellProps {
    children: ReactNode;
}

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 60;
const SIDEBAR_BG = "#090B0F";

interface NavItem {
    icon: ReactNode;
    label: string;
}

const NAV_ITEMS: NavItem[] = [
    { icon: <SearchIcon fontSize="small" />, label: "Search" },
    { icon: <AddIcon fontSize="small" />, label: "New Debate" },
    { icon: <DescriptionIcon fontSize="small" />, label: "Documents" },
    { icon: <HistoryIcon fontSize="small" />, label: "History" },
];

export default function AppShell({ children }: AppShellProps) {
    const { user, logout } = useAuth();
    const [expanded, setExpanded] = useState(false);

    const sidebarWidth = expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;

    const initials = user?.display_name
        ? user.display_name.slice(0, 2).toUpperCase()
        : user?.email?.slice(0, 2).toUpperCase() ?? "??";

    return (
        <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
            {/* Sidebar */}
            <Box
                component="aside"
                sx={{
                    width: sidebarWidth,
                    flexShrink: 0,
                    bgcolor: SIDEBAR_BG,
                    display: "flex",
                    flexDirection: "column",
                    borderRight: "1px solid",
                    borderColor: "divider",
                    position: "fixed",
                    top: 0,
                    left: 0,
                    height: "100vh",
                    zIndex: 100,
                    overflow: "hidden",
                    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
                }}
            >
                {/* Logo / collapse trigger */}
                <Tooltip title={expanded ? "Collapse sidebar" : "Agora"} placement="right">
                    <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        onClick={() => setExpanded((v) => !v)}
                        sx={{
                            px: expanded ? 2 : 1.5,
                            py: 2,
                            cursor: "pointer",
                            borderRadius: 2,
                            mx: 0.5,
                            mt: 0.5,
                            flexShrink: 0,
                            transition: "padding 0.22s",
                            minWidth: 0,
                        }}
                    >
                        <BalanceIcon sx={{ color: "primary.main", fontSize: 26, flexShrink: 0 }} />
                        <Box
                            sx={{
                                overflow: "hidden",
                                opacity: expanded ? 1 : 0,
                                width: expanded ? "auto" : 0,
                                transition: "opacity 0.18s, width 0.22s",
                                whiteSpace: "nowrap",
                            }}
                        >
                            <Typography
                                variant="h6"
                                sx={{ fontWeight: 800, color: "primary.main", letterSpacing: "-0.03em", lineHeight: 1.1 }}
                            >
                                Agora
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1 }}>
                                AI Debate Platform
                            </Typography>
                        </Box>
                    </Stack>
                </Tooltip>

                {/* Nav items */}
                <Stack spacing={0.5} sx={{ px: 0.5, flexGrow: 1 }}>
                    {NAV_ITEMS.map((item) => (
                        <Tooltip
                            key={item.label}
                            title={expanded ? "" : item.label}
                            placement="right"
                        >
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={1.5}
                                sx={{
                                    px: expanded ? 1.5 : 1.5,
                                    py: 1.2,
                                    borderRadius: 2,
                                    cursor: "pointer",
                                    color: "text.secondary",
                                    "&:hover": {
                                        bgcolor: "rgba(245,166,35,0.08)",
                                        color: "primary.main",
                                    },
                                    transition: "background 0.15s, color 0.15s",
                                    minWidth: 0,
                                    overflow: "hidden",
                                }}
                            >
                                <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                                    {item.icon}
                                </Box>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 500,
                                        whiteSpace: "nowrap",
                                        opacity: expanded ? 1 : 0,
                                        width: expanded ? "auto" : 0,
                                        overflow: "hidden",
                                        transition: "opacity 0.18s, width 0.22s",
                                        color: "inherit",
                                    }}
                                >
                                    {item.label}
                                </Typography>
                            </Stack>
                        </Tooltip>
                    ))}
                </Stack>

                <Divider sx={{ borderColor: "divider", mx: 1, mt: 1 }} />

                {/* User info + logout */}
                {user && (
                    <Box sx={{ px: 0.5, pb: 0.5 }}>
                        {/* User row */}
                        <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1.5}
                            sx={{
                                px: expanded ? 1.5 : 1,
                                py: 1,
                                borderRadius: 2,
                                overflow: "hidden",
                                transition: "padding 0.22s",
                            }}
                        >
                            <Tooltip title={expanded ? "" : (user.display_name ?? user.email ?? "")} placement="right">
                                <Avatar
                                    sx={{
                                        width: 32,
                                        height: 32,
                                        bgcolor: "primary.dark",
                                        color: "#0F1117",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                        cursor: "default",
                                    }}
                                >
                                    {initials}
                                </Avatar>
                            </Tooltip>
                            <Box
                                sx={{
                                    flexGrow: 1,
                                    minWidth: 0,
                                    opacity: expanded ? 1 : 0,
                                    width: expanded ? "auto" : 0,
                                    overflow: "hidden",
                                    transition: "opacity 0.18s, width 0.22s",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", lineHeight: 1.2 }} noWrap>
                                    {user.display_name ?? user.email}
                                </Typography>
                                {user.display_name && (
                                    <Typography variant="caption" color="text.secondary" noWrap>
                                        {user.email}
                                    </Typography>
                                )}
                            </Box>
                        </Stack>

                        {/* Logout row — icon only when collapsed, icon+text when expanded */}
                        <Tooltip title={expanded ? "" : "Sign out"} placement="right">
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={1.5}
                                onClick={logout}
                                sx={{
                                    px: expanded ? 1.5 : 1,
                                    py: 0.85,
                                    borderRadius: 2,
                                    cursor: "pointer",
                                    color: "text.secondary",
                                    overflow: "hidden",
                                    transition: "padding 0.22s, color 0.15s",
                                    "&:hover": { color: "error.main", bgcolor: "rgba(248,113,113,0.06)" },
                                }}
                            >
                                <LogoutIcon sx={{ fontSize: 18, flexShrink: 0 }} />
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 500,
                                        fontSize: "0.82rem",
                                        whiteSpace: "nowrap",
                                        opacity: expanded ? 1 : 0,
                                        width: expanded ? "auto" : 0,
                                        overflow: "hidden",
                                        transition: "opacity 0.18s, width 0.22s",
                                        color: "inherit",
                                    }}
                                >
                                    Sign out
                                </Typography>
                            </Stack>
                        </Tooltip>
                    </Box>
                )}
            </Box>

            {/* Main content */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    ml: `${sidebarWidth}px`,
                    minHeight: "100vh",
                    display: "flex",
                    flexDirection: "column",
                    transition: "margin-left 0.22s cubic-bezier(0.4,0,0.2,1)",
                }}
            >
                {children}
            </Box>
        </Box>
    );
}

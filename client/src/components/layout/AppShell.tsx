import type { ReactNode } from "react";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

interface AppShellProps {
    children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
    const { user, logout } = useAuth();

    return (
        <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
            {/* Header */}
            <Box
                component="header"
                sx={{
                    bgcolor: "primary.main",
                    color: "common.white",
                    py: 2,
                    px: 3,
                    boxShadow: 1,
                }}
            >
                <Container maxWidth="xl">
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                            Agora
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{ color: "rgba(255,255,255,0.6)", mt: "2px !important" }}
                        >
                            AI Debate Platform
                        </Typography>

                        <Box sx={{ flexGrow: 1 }} />

                        {/* Navigation */}
                        <Stack direction="row" spacing={0.5}>
                            <Button
                                component={Link}
                                to="/"
                                size="small"
                                sx={{
                                    color: "rgba(255,255,255,0.85)",
                                    "&:hover": { color: "common.white", bgcolor: "rgba(255,255,255,0.08)" },
                                }}
                            >
                                New Debate
                            </Button>
                            <Button
                                component={Link}
                                to="/history"
                                size="small"
                                sx={{
                                    color: "rgba(255,255,255,0.85)",
                                    "&:hover": { color: "common.white", bgcolor: "rgba(255,255,255,0.08)" },
                                }}
                            >
                                History
                            </Button>
                        </Stack>

                        {user && (
                            <Stack direction="row" alignItems="center" spacing={2}>
                                <Typography
                                    variant="body2"
                                    sx={{ color: "rgba(255,255,255,0.75)" }}
                                >
                                    {user.display_name ?? user.email}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={logout}
                                    sx={{
                                        color: "common.white",
                                        borderColor: "rgba(255,255,255,0.4)",
                                        "&:hover": { borderColor: "common.white" },
                                    }}
                                >
                                    Sign out
                                </Button>
                            </Stack>
                        )}
                    </Stack>
                </Container>
            </Box>

            {/* Main content */}
            <Container maxWidth="xl" sx={{ py: 4 }}>
                {children}
            </Container>
        </Box>
    );
}

import type { ReactNode } from "react";
import { Box, Container, Typography, Stack } from "@mui/material";

interface AppShellProps {
    children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
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

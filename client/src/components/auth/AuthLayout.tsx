import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface AuthLayoutProps {
    title?: string;
    subtitle?: string;
    children: ReactNode;
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
    return (
        <Box
            sx={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "background.default",
                p: 2,
            }}
        >
            <Paper
                elevation={0}
                sx={{
                    width: "100%",
                    maxWidth: 440,
                    p: { xs: 3, sm: 4 },
                    border: "1px solid",
                    borderColor: "divider",
                    borderTop: "3px solid",
                    borderTopColor: "primary.main",
                    borderRadius: 3,
                    boxShadow: "0 0 40px rgba(245, 166, 35, 0.08)",
                }}
            >
                {/* Brand mark */}
                <Box sx={{ mb: 3, textAlign: "center" }}>
                    <Typography
                        variant="h5"
                        sx={{
                            fontWeight: 800,
                            color: "primary.main",
                            letterSpacing: "-0.03em",
                        }}
                    >
                        Agora
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        AI Debate Platform
                    </Typography>
                </Box>

                {title && (
                    <Typography variant="h6" sx={{ mb: 0.5, textAlign: "center" }}>
                        {title}
                    </Typography>
                )}
                {subtitle && (
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 3, textAlign: "center" }}
                    >
                        {subtitle}
                    </Typography>
                )}

                {children}
            </Paper>
        </Box>
    );
}

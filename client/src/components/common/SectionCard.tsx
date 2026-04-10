import type { ReactNode } from "react";
import { Card, CardContent, Typography, Box } from "@mui/material";

interface SectionCardProps {
    title?: string;
    subtitle?: string;
    children: ReactNode;
    sx?: Record<string, unknown>;
}

export default function SectionCard({
    title,
    subtitle,
    children,
    sx,
}: SectionCardProps) {
    return (
        <Card sx={{ ...sx }}>
            <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
                {title && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="h6">{title}</Typography>
                        {subtitle && (
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                {subtitle}
                            </Typography>
                        )}
                    </Box>
                )}
                {children}
            </CardContent>
        </Card>
    );
}

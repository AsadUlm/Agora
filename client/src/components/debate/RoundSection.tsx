import type { ReactNode } from "react";
import { Box, Typography, Stack, Chip } from "@mui/material";

interface RoundSectionProps {
    roundNumber: number;
    title: string;
    children: ReactNode;
}

const roundColors: Record<number, string> = {
    1: "#5C7CFA",
    2: "#D4860A",
    3: "#2E7D4F",
};

export default function RoundSection({
    roundNumber,
    title,
    children,
}: RoundSectionProps) {
    const accent = roundColors[roundNumber] ?? "#5C7CFA";

    return (
        <Box sx={{ mb: 4 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                <Chip
                    label={`Round ${roundNumber}`}
                    size="small"
                    sx={{
                        bgcolor: accent,
                        color: "#fff",
                        fontWeight: 600,
                    }}
                />
                <Typography variant="h6" sx={{ fontSize: "1.05rem" }}>
                    {title}
                </Typography>
            </Stack>

            <Stack spacing={2}>{children}</Stack>
        </Box>
    );
}

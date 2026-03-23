import type { ReactNode } from "react";
import { Box, Stack } from "@mui/material";

interface ComposerControlBarProps {
    left: ReactNode;
    right: ReactNode;
}

export default function ComposerControlBar({
    left,
    right,
}: ComposerControlBarProps) {
    return (
        <Box
            sx={{
                borderTop: "1px solid",
                borderColor: "divider",
                px: { xs: 2, md: 3 },
                py: 1.5,
            }}
        >
            <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={1.5}
            >
                {/* Left: agents */}
                <Box sx={{ flex: 1, minWidth: 0 }}>{left}</Box>

                {/* Right: meta + action */}
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1.5}
                    sx={{ flexShrink: 0 }}
                >
                    {right}
                </Stack>
            </Stack>
        </Box>
    );
}

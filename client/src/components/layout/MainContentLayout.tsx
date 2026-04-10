import type { ReactNode } from "react";
import { Box } from "@mui/material";

interface MainContentLayoutProps {
    timeline: ReactNode;
    sidebar: ReactNode;
}

export default function MainContentLayout({
    timeline,
    sidebar,
}: MainContentLayoutProps) {
    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", lg: "1fr 340px" },
                gap: 3,
                alignItems: "start",
            }}
        >
            {/* Debate timeline — main column */}
            <Box sx={{ minWidth: 0 }}>{timeline}</Box>

            {/* Moderator panel — sticky sidebar */}
            <Box
                sx={{
                    display: { xs: "block", lg: "block" },
                    position: { lg: "sticky" },
                    top: { lg: 24 },
                }}
            >
                {sidebar}
            </Box>
        </Box>
    );
}

import type { ReactNode } from "react";
import { Box } from "@mui/material";

interface TopControlSectionProps {
    children: ReactNode;
}

export default function TopControlSection({ children }: TopControlSectionProps) {
    return (
        <Box
            sx={{
                width: "100%",
                mb: 4,
                p: { xs: 2, md: 3 },
                bgcolor: "background.paper",
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
            }}
        >
            {children}
        </Box>
    );
}

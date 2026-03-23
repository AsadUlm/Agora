import { Box, Typography, Stack, Chip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";

export default function DebateSettings() {
    return (
        <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <SettingsIcon fontSize="small" color="action" />
                <Typography variant="subtitle1">Debate Settings</Typography>
            </Stack>

            <Stack direction="row" flexWrap="wrap" gap={1}>
                <Chip label="Mode: Structured" size="small" variant="outlined" />
                <Chip label="3 Rounds" size="small" variant="outlined" />
                <Chip label="Auto-moderated" size="small" variant="outlined" />
            </Stack>
        </Box>
    );
}

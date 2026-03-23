import { Stack, Chip } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";

export default function DebateMetaControls() {
    return (
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.75}>
            <TuneIcon sx={{ fontSize: 18, color: "text.secondary", mr: 0.25 }} />
            <Chip
                label="Structured"
                size="small"
                variant="outlined"
                sx={{ fontSize: "0.75rem", height: 26 }}
            />
            <Chip
                label="3 Rounds"
                size="small"
                variant="outlined"
                sx={{ fontSize: "0.75rem", height: 26 }}
            />
            <Chip
                label="Auto-moderated"
                size="small"
                variant="outlined"
                sx={{ fontSize: "0.75rem", height: 26 }}
            />
        </Stack>
    );
}

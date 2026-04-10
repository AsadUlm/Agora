import {
    Card,
    CardContent,
    Typography,
    Stack,
    Divider,
    Box,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";

const moderatorSections = [
    "Round Overview",
    "Agreement Map",
    "Conflict Map",
    "Key Debate Insight",
    "What Changed",
    "Next Step",
];

export default function ModeratorPanelPlaceholder() {
    return (
        <Card
            sx={{
                bgcolor: "background.paper",
                borderLeft: "3px solid",
                borderColor: "secondary.main",
            }}
        >
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <VisibilityIcon fontSize="small" color="secondary" />
                    <Typography variant="h6" sx={{ fontSize: "1rem" }}>
                        Moderator Panel
                    </Typography>
                </Stack>

                <Typography variant="body2" sx={{ mb: 2 }}>
                    AI-generated debate analysis will appear here as the debate
                    progresses.
                </Typography>

                <Divider sx={{ mb: 2 }} />

                <Stack spacing={1.5}>
                    {moderatorSections.map((label) => (
                        <Box
                            key={label}
                            sx={{
                                p: 1.5,
                                borderRadius: 1.5,
                                bgcolor: "action.hover",
                            }}
                        >
                            <Typography
                                variant="body2"
                                sx={{ fontWeight: 500, color: "text.secondary" }}
                            >
                                {label}
                            </Typography>
                        </Box>
                    ))}
                </Stack>
            </CardContent>
        </Card>
    );
}

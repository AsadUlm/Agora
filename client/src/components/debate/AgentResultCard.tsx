import {
    Card,
    CardContent,
    Typography,
    Stack,
    Box,
    Chip,
    Alert,
} from "@mui/material";
import StatusChip from "../common/StatusChip";
import type { Round1Entry } from "../../types/debate";

interface AgentResultCardProps {
    entry: Round1Entry;
}

export default function AgentResultCard({ entry }: AgentResultCardProps) {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: 1.5 }}
                >
                    <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 600, textTransform: "capitalize" }}
                    >
                        {entry.agent_role}
                    </Typography>
                    <StatusChip status={entry.generation_status} />
                </Stack>

                {entry.error && (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                        {entry.error}
                    </Alert>
                )}

                <Typography variant="body1" sx={{ mb: 1.5 }}>
                    {entry.stance}
                </Typography>

                {entry.key_points?.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                            Key Points
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={0.75}>
                            {entry.key_points.map((kp, i) => (
                                <Chip key={i} label={kp} size="small" variant="outlined" />
                            ))}
                        </Stack>
                    </Box>
                )}

                <Chip
                    label={`Confidence: ${Math.round(entry.confidence * 100)}%`}
                    size="small"
                    color="secondary"
                    variant="outlined"
                />
            </CardContent>
        </Card>
    );
}

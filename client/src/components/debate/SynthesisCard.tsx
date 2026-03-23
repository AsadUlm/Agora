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
import type { Round3Entry } from "../../types/debate";

interface SynthesisCardProps {
    entry: Round3Entry;
}

export default function SynthesisCard({ entry }: SynthesisCardProps) {
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

                <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        Final Stance
                    </Typography>
                    <Typography variant="body1">{entry.final_stance}</Typography>
                </Box>

                <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        What Changed
                    </Typography>
                    <Typography variant="body1">{entry.what_changed}</Typography>
                </Box>

                {entry.remaining_concerns?.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                            Remaining Concerns
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={0.75}>
                            {entry.remaining_concerns.map((c, i) => (
                                <Chip
                                    key={i}
                                    label={c}
                                    size="small"
                                    variant="outlined"
                                    color="warning"
                                />
                            ))}
                        </Stack>
                    </Box>
                )}

                <Box
                    sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        bgcolor: "secondary.main",
                        color: "common.white",
                    }}
                >
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
                        Recommendation
                    </Typography>
                    <Typography variant="body2" sx={{ color: "inherit" }}>
                        {entry.recommendation}
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
}

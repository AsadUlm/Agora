import {
    Card,
    CardContent,
    Typography,
    Stack,
    Box,
    Divider,
    Alert,
} from "@mui/material";
import StatusChip from "../common/StatusChip";
import type { Round2Entry } from "../../types/debate";

interface CrossExaminationCardProps {
    entry: Round2Entry;
}

export default function CrossExaminationCard({
    entry,
}: CrossExaminationCardProps) {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: 1.5 }}
                >
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        <Box
                            component="span"
                            sx={{ textTransform: "capitalize", color: "error.main" }}
                        >
                            {entry.challenger}
                        </Box>
                        {" → "}
                        <Box
                            component="span"
                            sx={{ textTransform: "capitalize", color: "success.main" }}
                        >
                            {entry.responder}
                        </Box>
                    </Typography>
                    <StatusChip status={entry.generation_status} />
                </Stack>

                {entry.error && (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                        {entry.error}
                    </Alert>
                )}

                <Stack spacing={1.5} divider={<Divider flexItem />}>
                    <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Challenge
                        </Typography>
                        <Typography variant="body1">{entry.challenge}</Typography>
                    </Box>
                    <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Response
                        </Typography>
                        <Typography variant="body1">{entry.response}</Typography>
                    </Box>
                    <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Rebuttal
                        </Typography>
                        <Typography variant="body1">{entry.rebuttal}</Typography>
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
}

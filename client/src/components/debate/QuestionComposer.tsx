import { TextField, Typography, Box } from "@mui/material";

interface QuestionComposerProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

export default function QuestionComposer({
    value,
    onChange,
    disabled,
}: QuestionComposerProps) {
    return (
        <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Debate Question
            </Typography>
            <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                placeholder="Enter the question or topic you want AI agents to debate…"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                slotProps={{
                    input: {
                        sx: {
                            fontSize: "1.05rem",
                            lineHeight: 1.6,
                            p: 2,
                        },
                    },
                }}
            />
        </Box>
    );
}

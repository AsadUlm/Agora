import { InputBase, Box } from "@mui/material";

interface ComposerTextareaProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

export default function ComposerTextarea({
    value,
    onChange,
    disabled,
}: ComposerTextareaProps) {
    return (
        <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 }, pb: 1 }}>
            <InputBase
                fullWidth
                multiline
                minRows={4}
                maxRows={12}
                placeholder="Ask a question for your AI panel to debate…"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                sx={{
                    fontSize: { xs: "1rem", md: "1.1rem" },
                    lineHeight: 1.7,
                    "& .MuiInputBase-input": {
                        p: 0,
                        "&::placeholder": {
                            color: "text.secondary",
                            opacity: 0.7,
                        },
                    },
                }}
            />
        </Box>
    );
}

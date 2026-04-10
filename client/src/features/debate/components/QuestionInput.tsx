import { TextField } from "@mui/material";

interface QuestionInputProps {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    error?: string | null;
}

export default function QuestionInput({
    value,
    onChange,
    disabled,
    error,
}: QuestionInputProps) {
    return (
        <TextField
            label="Debate Question"
            placeholder="e.g. Should AI systems be regulated by governments?"
            multiline
            minRows={3}
            maxRows={6}
            fullWidth
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            error={!!error}
            helperText={
                error ?? "Be specific — the more precise the question, the richer the debate."
            }
            inputProps={{ maxLength: 1000 }}
        />
    );
}

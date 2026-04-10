import { IconButton, Stack, TextField, Tooltip } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { AgentDraft } from "../hooks/useDebate";

interface AgentRowProps {
    agent: AgentDraft;
    index: number;
    onChange: (localId: string, role: string) => void;
    onRemove: (localId: string) => void;
    disabled?: boolean;
    canRemove: boolean;
    error?: string | null;
}

export default function AgentRow({
    agent,
    index,
    onChange,
    onRemove,
    disabled,
    canRemove,
    error,
}: AgentRowProps) {
    return (
        <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
                label={`Agent ${index + 1} — Role`}
                placeholder="e.g. Regulator, Scientist, Economist"
                size="small"
                fullWidth
                value={agent.role}
                onChange={(e) => onChange(agent.localId, e.target.value)}
                disabled={disabled}
                error={!!error}
                helperText={error ?? undefined}
                inputProps={{ maxLength: 80 }}
            />
            <Tooltip title={canRemove ? "Remove agent" : "At least one agent required"}>
                {/* span wrapper needed so Tooltip works when button is disabled */}
                <span>
                    <IconButton
                        size="small"
                        onClick={() => onRemove(agent.localId)}
                        disabled={disabled || !canRemove}
                        sx={{ mt: 0.5, color: "text.secondary" }}
                    >
                        <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </Stack>
    );
}

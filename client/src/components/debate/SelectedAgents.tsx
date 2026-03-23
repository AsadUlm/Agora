import { Box, Chip, Typography, Stack } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import type { AgentInput } from "../../types/debate";

interface SelectedAgentsProps {
    agents: AgentInput[];
    onRemove: (index: number) => void;
    disabled?: boolean;
}

export default function SelectedAgents({
    agents,
    onRemove,
    disabled,
}: SelectedAgentsProps) {
    if (agents.length === 0) return null;

    return (
        <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Agents ({agents.length})
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
                {agents.map((agent, idx) => (
                    <Chip
                        key={`${agent.role}-${idx}`}
                        icon={<PersonIcon />}
                        label={agent.role}
                        onDelete={disabled ? undefined : () => onRemove(idx)}
                        variant="outlined"
                        color="primary"
                        sx={{ textTransform: "capitalize" }}
                    />
                ))}
            </Stack>
        </Box>
    );
}

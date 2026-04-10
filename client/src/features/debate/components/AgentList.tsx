import { Box, Button, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AgentRow from "./AgentRow";
import type { AgentDraft } from "../hooks/useDebate";

const MAX_AGENTS = 4;

interface AgentListProps {
    agents: AgentDraft[];
    onAdd: () => void;
    onChange: (localId: string, role: string) => void;
    onRemove: (localId: string) => void;
    disabled?: boolean;
    errors?: Record<string, string>;
    globalError?: string | null;
}

export default function AgentList({
    agents,
    onAdd,
    onChange,
    onRemove,
    disabled,
    errors = {},
    globalError,
}: AgentListProps) {
    return (
        <Box>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                sx={{ mb: 2 }}
            >
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Debate Agents
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Each agent takes a distinct perspective in the debate.
                    </Typography>
                </Box>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={onAdd}
                    disabled={disabled || agents.length >= MAX_AGENTS}
                    sx={{ flexShrink: 0, ml: 2 }}
                >
                    Add agent
                </Button>
            </Stack>

            <Stack spacing={1.5}>
                {agents.map((agent, i) => (
                    <AgentRow
                        key={agent.localId}
                        agent={agent}
                        index={i}
                        onChange={onChange}
                        onRemove={onRemove}
                        disabled={disabled}
                        canRemove={agents.length > 1}
                        error={errors[agent.localId] || null}
                    />
                ))}
            </Stack>

            {globalError && (
                <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
                    {globalError}
                </Typography>
            )}

            {agents.length >= MAX_AGENTS && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    Maximum {MAX_AGENTS} agents per debate.
                </Typography>
            )}
        </Box>
    );
}

import { useState } from "react";
import { TextField, IconButton, Stack, Chip, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PersonIcon from "@mui/icons-material/Person";
import type { AgentInput } from "../../types/debate";

interface AgentPickerProps {
    agents: AgentInput[];
    onAdd: (agent: AgentInput) => void;
    onRemove: (index: number) => void;
    disabled?: boolean;
}

export default function AgentPicker({
    agents,
    onAdd,
    onRemove,
    disabled,
}: AgentPickerProps) {
    const [newRole, setNewRole] = useState("");

    const addAgent = () => {
        const role = newRole.trim();
        if (!role) return;
        onAdd({ role });
        setNewRole("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addAgent();
        }
    };

    return (
        <Stack
            direction="row"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
            sx={{ minWidth: 0 }}
        >
            {/* Selected agent chips */}
            {agents.map((agent, idx) => (
                <Chip
                    key={`${agent.role}-${idx}`}
                    icon={<PersonIcon />}
                    label={agent.role}
                    onDelete={disabled ? undefined : () => onRemove(idx)}
                    size="small"
                    variant="filled"
                    sx={{
                        textTransform: "capitalize",
                        bgcolor: "primary.main",
                        color: "common.white",
                        "& .MuiChip-icon": { color: "rgba(255,255,255,0.7)" },
                        "& .MuiChip-deleteIcon": {
                            color: "rgba(255,255,255,0.5)",
                            "&:hover": { color: "rgba(255,255,255,0.9)" },
                        },
                    }}
                />
            ))}

            {/* Inline add-agent input */}
            <Stack direction="row" alignItems="center" spacing={0.5}>
                <TextField
                    size="small"
                    placeholder="Add agent…"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    sx={{
                        width: 140,
                        "& .MuiOutlinedInput-root": {
                            borderRadius: 2,
                            fontSize: "0.85rem",
                            height: 32,
                        },
                    }}
                />
                <Tooltip title="Add agent">
                    <span>
                        <IconButton
                            size="small"
                            onClick={addAgent}
                            disabled={disabled || !newRole.trim()}
                            sx={{
                                bgcolor: "secondary.main",
                                color: "common.white",
                                width: 28,
                                height: 28,
                                "&:hover": { bgcolor: "secondary.dark" },
                                "&.Mui-disabled": {
                                    bgcolor: "action.disabledBackground",
                                    color: "action.disabled",
                                },
                            }}
                        >
                            <AddIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </span>
                </Tooltip>
            </Stack>
        </Stack>
    );
}

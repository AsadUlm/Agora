import { useState } from "react";
import {
    Box,
    TextField,
    Button,
    Stack,
    Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import type { AgentInput } from "../../types/debate";

interface AgentSetupProps {
    agents: AgentInput[];
    onChange: (agents: AgentInput[]) => void;
    disabled?: boolean;
}

export default function AgentSetup({
    agents,
    onChange,
    disabled,
}: AgentSetupProps) {
    const [newRole, setNewRole] = useState("");

    const addAgent = () => {
        const role = newRole.trim();
        if (!role) return;
        onChange([...agents, { role }]);
        setNewRole("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addAgent();
        }
    };

    return (
        <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Add Agent
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="stretch">
                <TextField
                    size="small"
                    placeholder="e.g. economist, ethicist, strategist…"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    sx={{ flex: 1 }}
                />
                <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={addAgent}
                    disabled={disabled || !newRole.trim()}
                >
                    Add
                </Button>
            </Stack>
        </Box>
    );
}

import { useState } from "react";
import {
    Box,
    Collapse,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Slider,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import type { AgentDraft } from "../hooks/useDebate";

// ── Static provider / model registry (mirrors server/app/services/debate_engine/_factory.py) ──

const MODELS: { id: string; label: string }[] = [
    { id: "llama-3.3-70b-versatile", label: "LLaMA 3.3 70B (Groq)" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8×7B (Groq)" },
    { id: "mock-model", label: "Mock (testing only)" },
];

const REASONING_STYLES = [
    { id: "balanced", label: "Balanced" },
    { id: "analytical", label: "Analytical" },
    { id: "creative", label: "Creative" },
    { id: "devil_advocate", label: "Devil's Advocate" },
];

interface AgentRowProps {
    agent: AgentDraft;
    index: number;
    onChange: (localId: string, patch: Partial<Omit<AgentDraft, "localId">>) => void;
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
    const [expanded, setExpanded] = useState(false);

    return (
        <Box
            sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                p: 1.5,
                bgcolor: "background.paper",
            }}
        >
            {/* ── Role row ── */}
            <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                    label={`Agent ${index + 1} — Role`}
                    placeholder="e.g. Regulator, Scientist, Economist"
                    size="small"
                    fullWidth
                    value={agent.role}
                    onChange={(e) => onChange(agent.localId, { role: e.target.value })}
                    disabled={disabled}
                    error={!!error}
                    helperText={error ?? undefined}
                    inputProps={{ maxLength: 80 }}
                />

                {/* Expand / collapse model settings */}
                <Tooltip title={expanded ? "Hide model settings" : "Model settings"}>
                    <IconButton
                        size="small"
                        onClick={() => setExpanded((v) => !v)}
                        disabled={disabled}
                        sx={{ mt: 0.5, color: "text.secondary" }}
                    >
                        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </IconButton>
                </Tooltip>

                <Tooltip title={canRemove ? "Remove agent" : "At least one agent required"}>
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

            {/* ── Collapsible model settings ── */}
            <Collapse in={expanded} unmountOnExit>
                <Stack spacing={2} sx={{ mt: 2 }}>
                    {/* Model */}
                    <FormControl size="small" fullWidth disabled={disabled}>
                        <InputLabel>Model</InputLabel>
                        <Select
                            label="Model"
                            value={agent.model}
                            onChange={(e) => onChange(agent.localId, { model: e.target.value })}
                        >
                            {MODELS.map((m) => (
                                <MenuItem key={m.id} value={m.id}>
                                    {m.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Reasoning style */}
                    <FormControl size="small" fullWidth disabled={disabled}>
                        <InputLabel>Reasoning style</InputLabel>
                        <Select
                            label="Reasoning style"
                            value={agent.reasoningStyle}
                            onChange={(e) => onChange(agent.localId, { reasoningStyle: e.target.value })}
                        >
                            {REASONING_STYLES.map((r) => (
                                <MenuItem key={r.id} value={r.id}>
                                    {r.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Temperature */}
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            Temperature: <b>{agent.temperature.toFixed(1)}</b>
                        </Typography>
                        <Slider
                            size="small"
                            min={0}
                            max={1}
                            step={0.1}
                            value={agent.temperature}
                            onChange={(_e, val) =>
                                onChange(agent.localId, { temperature: val as number })
                            }
                            disabled={disabled}
                            marks={[
                                { value: 0, label: "0" },
                                { value: 0.5, label: "0.5" },
                                { value: 1, label: "1" },
                            ]}
                        />
                    </Box>
                </Stack>
            </Collapse>
        </Box>
    );
}

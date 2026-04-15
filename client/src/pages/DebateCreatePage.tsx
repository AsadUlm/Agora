import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    IconButton,
    MenuItem,
    Slider,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { startDebate } from "../services/debateService";
import type { AgentCreateRequest } from "../types/debate";

const PROVIDERS = ["groq", "openai", "anthropic"];
const MODELS: Record<string, string[]> = {
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
    anthropic: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
};
const REASONING_STYLES = ["analytical", "balanced", "creative", "critical", "empirical"];
const REASONING_DEPTHS = ["shallow", "normal", "deep"];

const AGENT_PALETTE = ["#6C8EF5", "#F5A623", "#34D399", "#F472B6", "#A78BFA", "#38BDF8"];

function defaultAgent(index: number): AgentCreateRequest {
    const roles = ["Proponent", "Opponent", "Devil's Advocate", "Moderator", "Skeptic", "Advocate"];
    return {
        role: roles[index] ?? `Agent ${index + 1}`,
        config: {
            model: { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.7 },
            reasoning: { style: "analytical", depth: "normal" },
        },
    };
}

interface AgentFormProps {
    index: number;
    agent: AgentCreateRequest;
    onChange: (updated: AgentCreateRequest) => void;
    onRemove: () => void;
    canRemove: boolean;
}

function AgentForm({ index, agent, onChange, onRemove, canRemove }: AgentFormProps) {
    const color = AGENT_PALETTE[index % AGENT_PALETTE.length] ?? "#9CA3AF";
    const models = MODELS[agent.config.model.provider] ?? MODELS["groq"]!;

    function set<K extends keyof AgentCreateRequest>(key: K, value: AgentCreateRequest[K]) {
        onChange({ ...agent, [key]: value });
    }

    function setModelField(field: "provider" | "model" | "temperature", value: string | number) {
        const updated = { ...agent.config.model, [field]: value };
        if (field === "provider") {
            updated.model = (MODELS[value as string]?.[0]) ?? "";
        }
        onChange({ ...agent, config: { ...agent.config, model: updated } });
    }

    function setReasoningField(field: "style" | "depth", value: string) {
        onChange({ ...agent, config: { ...agent.config, reasoning: { ...agent.config.reasoning, [field]: value } } });
    }

    return (
        <Box
            sx={{
                bgcolor: "#151821",
                border: "1px solid #2A2D3A",
                borderLeft: `3px solid ${color}`,
                borderRadius: 2,
                p: 2.5,
            }}
        >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>
                        Agent {index + 1}
                    </Typography>
                </Stack>
                {canRemove && (
                    <Tooltip title="Remove agent">
                        <IconButton size="small" onClick={onRemove} sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
            </Stack>

            <Stack spacing={2}>
                <TextField
                    label="Role"
                    value={agent.role}
                    onChange={(e) => set("role", e.target.value)}
                    fullWidth
                    required
                    size="small"
                    placeholder="e.g. Proponent, Economist, Devil's Advocate"
                />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                        label="Provider"
                        select
                        value={agent.config.model.provider}
                        onChange={(e) => setModelField("provider", e.target.value)}
                        size="small"
                        sx={{ minWidth: 130 }}
                    >
                        {PROVIDERS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                    </TextField>

                    <TextField
                        label="Model"
                        select
                        value={agent.config.model.model}
                        onChange={(e) => setModelField("model", e.target.value)}
                        size="small"
                        fullWidth
                    >
                        {models.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                        label="Reasoning style"
                        select
                        value={agent.config.reasoning.style}
                        onChange={(e) => setReasoningField("style", e.target.value)}
                        size="small"
                        fullWidth
                    >
                        {REASONING_STYLES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>

                    <TextField
                        label="Reasoning depth"
                        select
                        value={agent.config.reasoning.depth}
                        onChange={(e) => setReasoningField("depth", e.target.value)}
                        size="small"
                        fullWidth
                    >
                        {REASONING_DEPTHS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                    </TextField>
                </Stack>

                <Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">Temperature</Typography>
                        <Chip
                            label={agent.config.model.temperature.toFixed(1)}
                            size="small"
                            sx={{ height: 20, fontSize: "0.72rem", bgcolor: "rgba(108,142,245,0.12)", color: "#6C8EF5" }}
                        />
                    </Stack>
                    <Slider
                        min={0}
                        max={1}
                        step={0.1}
                        value={agent.config.model.temperature}
                        onChange={(_, val) => setModelField("temperature", val as number)}
                        sx={{ color }}
                        size="small"
                    />
                    <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Focused</Typography>
                        <Typography variant="caption" color="text.secondary">Creative</Typography>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

export default function DebateCreatePage() {
    const navigate = useNavigate();
    const [question, setQuestion] = useState("");
    const [questionErr, setQuestionErr] = useState<string | null>(null);
    const [agents, setAgents] = useState<AgentCreateRequest[]>([defaultAgent(0), defaultAgent(1)]);
    const [agentErrors, setAgentErrors] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    function addAgent() {
        if (agents.length >= 6) return;
        setAgents((prev) => [...prev, defaultAgent(prev.length)]);
    }

    function removeAgent(i: number) {
        setAgents((prev) => prev.filter((_, idx) => idx !== i));
        setAgentErrors((prev) => prev.filter((_, idx) => idx !== i));
    }

    function updateAgent(i: number, updated: AgentCreateRequest) {
        setAgents((prev) => prev.map((a, idx) => (idx === i ? updated : a)));
        if (agentErrors[i]) {
            setAgentErrors((prev) => prev.map((e, idx) => (idx === i ? "" : e)));
        }
    }

    function validate(): boolean {
        let valid = true;
        if (!question.trim()) {
            setQuestionErr("Debate question is required");
            valid = false;
        } else if (question.trim().length < 10) {
            setQuestionErr("Question must be at least 10 characters");
            valid = false;
        } else {
            setQuestionErr(null);
        }

        const errs = agents.map((a) => (!a.role.trim() ? "Role is required" : ""));
        setAgentErrors(errs);
        if (errs.some((e) => e !== "")) valid = false;

        return valid;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const result = await startDebate({ question: question.trim(), agents });
            navigate(`/debates/${result.debate_id}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to start debate";
            setSubmitError(msg);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <AppShell>
            <Box sx={{ maxWidth: 760, mx: "auto", px: 3, py: 4, width: "100%" }}>
                {/* Header */}
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 4 }}>
                    <IconButton
                        onClick={() => navigate("/debates")}
                        size="small"
                        sx={{ color: "text.secondary" }}
                    >
                        <ArrowBackIcon />
                    </IconButton>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            New Debate
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Configure your question and AI agents
                        </Typography>
                    </Box>
                </Stack>

                <form onSubmit={handleSubmit} noValidate>
                    <Stack spacing={4}>
                        {submitError && (
                            <Alert severity="error" onClose={() => setSubmitError(null)}>
                                {submitError}
                            </Alert>
                        )}

                        {/* Question section */}
                        <Box>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>
                                Debate Question
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                minRows={3}
                                placeholder="Should artificial intelligence be regulated by governments?"
                                value={question}
                                onChange={(e) => {
                                    setQuestion(e.target.value);
                                    if (questionErr) setQuestionErr(null);
                                }}
                                error={!!questionErr}
                                helperText={questionErr ?? `${question.length}/500 characters`}
                                inputProps={{ maxLength: 500 }}
                                required
                            />
                        </Box>

                        <Divider sx={{ borderColor: "#2A2D3A" }} />

                        {/* Agents section */}
                        <Box>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                                <Box>
                                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                        Agents
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Configure who will debate. Each agent takes a distinct position.
                                    </Typography>
                                </Box>
                                <Tooltip title={agents.length >= 6 ? "Maximum 6 agents" : "Add agent"}>
                                    <span>
                                        <Button
                                            onClick={addAgent}
                                            startIcon={<AddIcon />}
                                            size="small"
                                            variant="outlined"
                                            disabled={agents.length >= 6}
                                            sx={{ flexShrink: 0 }}
                                        >
                                            Add Agent
                                        </Button>
                                    </span>
                                </Tooltip>
                            </Stack>

                            <Stack spacing={2}>
                                {agents.map((agent, i) => (
                                    <Box key={i}>
                                        <AgentForm
                                            index={i}
                                            agent={agent}
                                            onChange={(updated) => updateAgent(i, updated)}
                                            onRemove={() => removeAgent(i)}
                                            canRemove={agents.length > 1}
                                        />
                                        {agentErrors[i] && (
                                            <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1 }}>
                                                {agentErrors[i]}
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                            </Stack>
                        </Box>

                        {/* Submit */}
                        <Box sx={{ pt: 1 }}>
                            <Button
                                type="submit"
                                variant="contained"
                                size="large"
                                fullWidth
                                disabled={submitting}
                            >
                                {submitting ? "Starting debate…" : "Start Debate"}
                            </Button>
                        </Box>
                    </Stack>
                </form>
            </Box>
        </AppShell>
    );
}

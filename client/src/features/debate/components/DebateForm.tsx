import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import ForumIcon from "@mui/icons-material/Forum";
import { useState } from "react";
import SectionCard from "../../../components/common/SectionCard";
import type { AgentDraft } from "../hooks/useDebate";
import AgentList from "./AgentList";
import QuestionInput from "./QuestionInput";

// ── Validation ────────────────────────────────────────────────────────

interface FormErrors {
    question: string | null;
    agents: Record<string, string>;
    agentList: string | null;
}

function validate(question: string, agents: AgentDraft[]): FormErrors {
    const errors: FormErrors = { question: null, agents: {}, agentList: null };

    if (!question.trim()) {
        errors.question = "Please enter a debate question.";
    } else if (question.trim().length < 10) {
        errors.question = "Question is too short — be more specific.";
    }

    if (agents.length === 0) {
        errors.agentList = "Add at least one agent to the debate.";
    }

    agents.forEach((a) => {
        if (!a.role.trim()) {
            errors.agents[a.localId] = "Role cannot be empty.";
        }
    });

    return errors;
}

function hasErrors(e: FormErrors): boolean {
    return !!(
        e.question ||
        e.agentList ||
        Object.values(e.agents).some(Boolean)
    );
}

// ── Component ─────────────────────────────────────────────────────────

interface DebateFormProps {
    question: string;
    onQuestionChange: (v: string) => void;
    agents: AgentDraft[];
    onAddAgent: () => void;
    onUpdateAgent: (localId: string, patch: Partial<Omit<AgentDraft, "localId">>) => void;
    onRemoveAgent: (localId: string) => void;
    onSubmit: () => void;
    isSubmitting: boolean;
    submitError: string | null;
    onClearError: () => void;
}

export default function DebateForm({
    question,
    onQuestionChange,
    agents,
    onAddAgent,
    onUpdateAgent,
    onRemoveAgent,
    onSubmit,
    isSubmitting,
    submitError,
    onClearError,
}: DebateFormProps) {
    const [fieldErrors, setFieldErrors] = useState<FormErrors>({
        question: null,
        agents: {},
        agentList: null,
    });

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const errors = validate(question, agents);
        setFieldErrors(errors);
        if (hasErrors(errors)) return;
        onSubmit();
    }

    function handleQuestionChange(v: string) {
        if (fieldErrors.question) {
            setFieldErrors((prev) => ({ ...prev, question: null }));
        }
        onQuestionChange(v);
    }

    function handleAgentChange(localId: string, patch: Partial<Omit<AgentDraft, "localId">>) {
        if (patch.role !== undefined && fieldErrors.agents[localId]) {
            setFieldErrors((prev) => ({
                ...prev,
                agents: { ...prev.agents, [localId]: "" },
            }));
        }
        onUpdateAgent(localId, patch);
    }

    return (
        <Box
            component="form"
            onSubmit={handleSubmit}
            noValidate
            sx={{ maxWidth: 680, mx: "auto" }}
        >
            {/* Page heading */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" sx={{ mb: 0.5 }}>
                    New Debate
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Define a question and assign AI agents to debate it across three rounds.
                </Typography>
            </Box>

            <Stack spacing={3}>
                {submitError && (
                    <Alert severity="error" onClose={onClearError}>
                        {submitError}
                    </Alert>
                )}

                <SectionCard title="Question">
                    <QuestionInput
                        value={question}
                        onChange={handleQuestionChange}
                        disabled={isSubmitting}
                        error={fieldErrors.question}
                    />
                </SectionCard>

                <SectionCard>
                    <AgentList
                        agents={agents}
                        onAdd={onAddAgent}
                        onChange={handleAgentChange}
                        onRemove={onRemoveAgent}
                        disabled={isSubmitting}
                        errors={Object.fromEntries(
                            Object.entries(fieldErrors.agents).filter(([, v]) => Boolean(v)),
                        )}
                        globalError={fieldErrors.agentList}
                    />
                </SectionCard>

                <Divider />

                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={isSubmitting}
                        startIcon={
                            isSubmitting ? (
                                <CircularProgress size={18} color="inherit" />
                            ) : (
                                <ForumIcon />
                            )
                        }
                        sx={{ minWidth: 180 }}
                    >
                        {isSubmitting ? "Debating…" : "Start Debate"}
                    </Button>
                </Box>
            </Stack>
        </Box>
    );
}

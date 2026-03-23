import { Box, Typography } from "@mui/material";
import type { DebateResult } from "../../types/debate";
import RoundSection from "./RoundSection";
import AgentResultCard from "./AgentResultCard";
import CrossExaminationCard from "./CrossExaminationCard";
import SynthesisCard from "./SynthesisCard";

interface DebateTimelineProps {
    result: DebateResult;
    question: string;
}

export default function DebateTimeline({
    result,
    question,
}: DebateTimelineProps) {
    return (
        <Box>
            <Typography variant="h5" sx={{ mb: 0.5 }}>
                Debate Results
            </Typography>
            <Typography variant="body2" sx={{ mb: 3, maxWidth: 700 }}>
                {question}
            </Typography>

            {/* Round 1 */}
            <RoundSection roundNumber={1} title="Opening Statements">
                {result.round1.map((entry, i) => (
                    <AgentResultCard key={i} entry={entry} />
                ))}
            </RoundSection>

            {/* Round 2 */}
            <RoundSection roundNumber={2} title="Cross Examination">
                {result.round2.map((entry, i) => (
                    <CrossExaminationCard key={i} entry={entry} />
                ))}
            </RoundSection>

            {/* Round 3 */}
            <RoundSection roundNumber={3} title="Final Synthesis">
                {result.round3.map((entry, i) => (
                    <SynthesisCard key={i} entry={entry} />
                ))}
            </RoundSection>
        </Box>
    );
}

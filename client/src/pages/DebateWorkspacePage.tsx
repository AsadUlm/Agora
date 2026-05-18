import { useEffect } from "react";
import AgoraLogoIcon from "@/features/debate/ui/AgoraLogoIcon";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useDebateStore } from "@/features/debate/model/debate.store";
import DebateLayout from "@/features/debate/ui/DebateLayout";

export default function DebateWorkspacePage() {
    const { debateId } = useParams<{ debateId: string }>();
    const navigate = useNavigate();
    const loading = useDebateStore((s) => s.loading);
    const error = useDebateStore((s) => s.error);
    const turnStatus = useDebateStore((s) => s.turnStatus);
    const loadDebate = useDebateStore((s) => s.loadDebate);
    const reset = useDebateStore((s) => s.reset);

    useEffect(() => {
        if (debateId) {
            loadDebate(debateId);
        }
        return () => {
            reset();
        };
    }, [debateId, loadDebate, reset]);

    useEffect(() => {
        if (!debateId) return;
        if (turnStatus !== "queued" && turnStatus !== "running") return;

        // REST polling is a fallback for missed WS events; WS is the
        // primary channel. We intentionally avoid an immediate poll so
        // the first reveal remains WS-driven whenever possible. 2500ms is
        // gentle on the backend while still
        // recovering quickly if a WS event slips. Polling stops as soon
        // as turnStatus transitions to completed/failed.
        const intervalId = setInterval(() => {
            void loadDebate(debateId, { silent: true });
        }, 2500);
        return () => clearInterval(intervalId);
    }, [debateId, turnStatus, loadDebate]);

    if (loading) {
        return <LoadingScreen />;
    }

    if (error) {
        return (
            <ErrorScreen
                message={error}
                onRetry={() => debateId && loadDebate(debateId)}
                onBack={() => navigate("/debates")}
            />
        );
    }

    return <DebateLayout />;
}

function LoadingScreen() {
    return (
        <div className="h-screen w-screen flex items-center justify-center bg-agora-bg">
            <motion.div
                className="text-center space-y-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <motion.div
                    className="mx-auto w-fit"
                    animate={{ rotate: [0, 10, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                >
                    <AgoraLogoIcon size={64} />
                </motion.div>
                <p className="text-agora-text-muted text-sm">
                    Loading debate workspace...
                </p>
                <motion.div
                    className="h-0.5 w-32 mx-auto bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse" }}
                />
            </motion.div>
        </div>
    );
}

function ErrorScreen({
    message,
    onRetry,
    onBack,
}: {
    message: string;
    onRetry: () => void;
    onBack: () => void;
}) {
    return (
        <div className="h-screen w-screen flex items-center justify-center bg-agora-bg">
            <motion.div
                className="text-center space-y-4 max-w-md"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="text-4xl">⚠️</div>
                <h2 className="text-lg font-semibold text-white">
                    Failed to load debate
                </h2>
                <p className="text-sm text-agora-text-muted">{message}</p>
                <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                        onClick={onBack}
                        className="px-4 py-2 rounded-lg text-sm text-agora-text-muted hover:text-white bg-agora-surface-light hover:bg-agora-surface-light/80 transition-colors"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={onRetry}
                        className="px-4 py-2 rounded-lg text-sm text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

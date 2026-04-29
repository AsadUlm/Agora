import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/features/auth/model/auth.store";
import NewLoginPage from "@/pages/NewLoginPage";
import NewSignupPage from "@/pages/NewSignupPage";
import DebateListPage from "@/pages/DebateListPage";
import DebateWorkspacePage from "@/pages/DebateWorkspacePage";
import AppShell from "@/features/debate/ui/AppShell";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const loading = useAuthStore((s) => s.loading);

    if (loading) {
        return (
            <div className="min-h-screen bg-agora-bg flex items-center justify-center">
                <div className="text-agora-text-muted text-sm">Loading...</div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}

function SessionRestorer({ children }: { children: React.ReactNode }) {
    const restoreSession = useAuthStore((s) => s.restoreSession);

    useEffect(() => {
        restoreSession();
    }, [restoreSession]);

    return <>{children}</>;
}

export default function App() {
    return (
        <BrowserRouter>
            <SessionRestorer>
                <Routes>
                    <Route path="/login" element={<NewLoginPage />} />
                    <Route path="/signup" element={<NewSignupPage />} />
                    <Route
                        element={
                            <ProtectedRoute>
                                <AppShell />
                            </ProtectedRoute>
                        }
                    >
                        <Route path="/debates" element={<DebateListPage />} />
                    </Route>
                    <Route
                        path="/debates/:debateId"
                        element={
                            <ProtectedRoute>
                                <DebateWorkspacePage />
                            </ProtectedRoute>
                        }
                    />
                    <Route path="/" element={<Navigate to="/debates" replace />} />
                    <Route path="*" element={<Navigate to="/debates" replace />} />
                </Routes>
            </SessionRestorer>
        </BrowserRouter>
    );
}

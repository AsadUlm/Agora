import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import { AuthProvider } from "../context/AuthContext";
import LoginPage from "../pages/LoginPage";
import SignupPage from "../pages/SignupPage";
import DebatesPage from "../pages/DebatesPage";
import DebateCreatePage from "../pages/DebateCreatePage";
import DebateDetailPage from "../pages/DebateDetailPage";
import theme from "../theme";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
        },
    },
});

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <BrowserRouter>
                    <AuthProvider>
                        <Routes>
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/signup" element={<SignupPage />} />
                            <Route
                                path="/debates"
                                element={
                                    <ProtectedRoute>
                                        <DebatesPage />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/debates/new"
                                element={
                                    <ProtectedRoute>
                                        <DebateCreatePage />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/debates/:debateId"
                                element={
                                    <ProtectedRoute>
                                        <DebateDetailPage />
                                    </ProtectedRoute>
                                }
                            />
                            <Route path="/" element={<Navigate to="/debates" replace />} />
                            <Route path="*" element={<Navigate to="/debates" replace />} />
                        </Routes>
                    </AuthProvider>
                </BrowserRouter>
            </ThemeProvider>
        </QueryClientProvider>
    );
}

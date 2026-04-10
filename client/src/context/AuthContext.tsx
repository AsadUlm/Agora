import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as authService from "../services/authService";
import { tokenStorage } from "../services/authService";
import type { AuthState, LoginRequest, SignupRequest, UserBrief } from "../types/auth";

// ── Context shape ─────────────────────────────────────────────────────

interface AuthContextValue extends AuthState {
    login: (data: LoginRequest) => Promise<void>;
    signup: (data: SignupRequest) => Promise<void>;
    logout: () => void;
    clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const navigate = useNavigate();

    const [user, setUser] = useState<UserBrief | null>(null);
    const [loading, setLoading] = useState(true); // true while restoring session
    const [error, setError] = useState<string | null>(null);

    const isAuthenticated = user !== null;

    // ── Restore session on mount ──────────────────────────────────────

    const hasMounted = useRef(false);

    useEffect(() => {
        if (hasMounted.current) return;
        hasMounted.current = true;

        async function restoreSession() {
            const token = tokenStorage.getAccess();
            if (!token) {
                setLoading(false);
                return;
            }

            try {
                const me = await authService.getCurrentUser();
                setUser(me);
            } catch {
                // Token expired or invalid — try refresh
                const refreshToken = tokenStorage.getRefresh();
                if (refreshToken) {
                    try {
                        const result = await authService.refresh({ refresh_token: refreshToken });
                        setUser(result.user);
                    } catch {
                        tokenStorage.clear();
                    }
                } else {
                    tokenStorage.clear();
                }
            } finally {
                setLoading(false);
            }
        }

        restoreSession();
    }, []);

    // ── Auth actions ──────────────────────────────────────────────────

    const login = useCallback(
        async (data: LoginRequest) => {
            setError(null);
            setLoading(true);
            try {
                const result = await authService.login(data);
                setUser(result.user);
                navigate("/");
            } catch (err: unknown) {
                const msg = extractErrorMessage(err) ?? "Login failed";
                setError(msg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [navigate],
    );

    const signup = useCallback(
        async (data: SignupRequest) => {
            setError(null);
            setLoading(true);
            try {
                const result = await authService.signup(data);
                setUser(result.user);
                navigate("/");
            } catch (err: unknown) {
                const msg = extractErrorMessage(err) ?? "Signup failed";
                setError(msg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [navigate],
    );

    const logout = useCallback(() => {
        authService.logout();
        setUser(null);
        setError(null);
        navigate("/login");
    }, [navigate]);

    const clearError = useCallback(() => setError(null), []);

    const value = useMemo<AuthContextValue>(
        () => ({ user, isAuthenticated, loading, error, login, signup, logout, clearError }),
        [user, isAuthenticated, loading, error, login, signup, logout, clearError],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}

// ── Utility ───────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string | null {
    if (err && typeof err === "object" && "response" in err) {
        const response = (err as { response?: { data?: { detail?: string } } }).response;
        if (response?.data?.detail) return response.data.detail;
    }
    if (err instanceof Error) return err.message;
    return null;
}

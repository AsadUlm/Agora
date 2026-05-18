import { create } from "zustand";
import { tokenStorage } from "@/shared/api/client";
import {
    getMeApi,
    loginApi,
    signupApi,
    refreshTokenApi,
} from "../api/auth.api";
import type { LoginRequest, SignupRequest, UserBrief } from "./auth.types";

interface AuthStore {
    user: UserBrief | null;
    loading: boolean;
    error: string | null;
    isAuthenticated: boolean;

    login: (data: LoginRequest) => Promise<void>;
    signup: (data: SignupRequest) => Promise<void>;
    logout: () => void;
    restoreSession: () => Promise<void>;
    clearError: () => void;
}

function extractErrorMessage(err: unknown): string {
    if (err && typeof err === "object" && "response" in err) {
        const resp = (err as { response?: { data?: { detail?: string } } })
            .response;
        if (resp?.data?.detail) return resp.data.detail;
    }
    if (err instanceof Error) return err.message;
    return "An unexpected error occurred";
}

export const useAuthStore = create<AuthStore>((set) => ({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: false,

    login: async (data) => {
        set({ error: null, loading: true });
        try {
            const result = await loginApi(data);
            set({ user: result.user, isAuthenticated: true, loading: false });
        } catch (err) {
            set({ error: extractErrorMessage(err), loading: false });
            throw err;
        }
    },

    signup: async (data) => {
        set({ error: null, loading: true });
        try {
            const result = await signupApi(data);
            set({ user: result.user, isAuthenticated: true, loading: false });
        } catch (err) {
            set({ error: extractErrorMessage(err), loading: false });
            throw err;
        }
    },

    logout: () => {
        tokenStorage.clear();
        set({ user: null, isAuthenticated: false, error: null });
    },

    restoreSession: async () => {
        const token = tokenStorage.getAccess();
        if (!token) {
            set({ loading: false });
            return;
        }

        try {
            const me = await getMeApi();
            set({ user: me, isAuthenticated: true, loading: false });
        } catch {
            const refreshToken = tokenStorage.getRefresh();
            if (refreshToken) {
                try {
                    const result = await refreshTokenApi(refreshToken);
                    set({
                        user: result.user,
                        isAuthenticated: true,
                        loading: false,
                    });
                    return;
                } catch {
                    /* fall through */
                }
            }
            tokenStorage.clear();
            set({ loading: false });
        }
    },

    clearError: () => set({ error: null }),
}));

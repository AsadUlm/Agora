import api from "./api";
import type {
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserBrief,
} from "../types/auth";

// ── Token storage keys ────────────────────────────────────────────────

const ACCESS_TOKEN_KEY = "agora_access_token";
const REFRESH_TOKEN_KEY = "agora_refresh_token";

// ── Token persistence helpers ─────────────────────────────────────────

export const tokenStorage = {
    getAccess: () => localStorage.getItem(ACCESS_TOKEN_KEY),
    getRefresh: () => localStorage.getItem(REFRESH_TOKEN_KEY),
    set: (access: string, refresh: string) => {
        localStorage.setItem(ACCESS_TOKEN_KEY, access);
        localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    },
    clear: () => {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    },
};

// ── API calls ─────────────────────────────────────────────────────────

export async function signup(data: SignupRequest): Promise<TokenResponse> {
    const res = await api.post<TokenResponse>("/auth/signup", data);
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

export async function login(data: LoginRequest): Promise<TokenResponse> {
    const res = await api.post<TokenResponse>("/auth/login", data);
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

export async function refresh(data: RefreshRequest): Promise<TokenResponse> {
    const res = await api.post<TokenResponse>("/auth/refresh", data);
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

export async function getCurrentUser(): Promise<UserBrief> {
    const res = await api.get<UserBrief>("/users/me");
    return res.data;
}

export function logout(): void {
    tokenStorage.clear();
}

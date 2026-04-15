import apiClient, { tokenStorage } from "@/shared/api/client";
import type {
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UserBrief,
} from "../model/auth.types";

export async function loginApi(data: LoginRequest): Promise<TokenResponse> {
    const res = await apiClient.post<TokenResponse>("/auth/login", data);
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

export async function signupApi(data: SignupRequest): Promise<TokenResponse> {
    const res = await apiClient.post<TokenResponse>("/auth/signup", data);
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

export async function getMeApi(): Promise<UserBrief> {
    const res = await apiClient.get<UserBrief>("/users/me");
    return res.data;
}

export async function refreshTokenApi(
    refreshToken: string,
): Promise<TokenResponse> {
    const res = await apiClient.post<TokenResponse>("/auth/refresh", {
        refresh_token: refreshToken,
    });
    tokenStorage.set(res.data.access_token, res.data.refresh_token);
    return res.data;
}

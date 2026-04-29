export interface UserBrief {
    id: string;
    email: string;
    display_name: string | null;
}

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    user: UserBrief;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface SignupRequest {
    email: string;
    password: string;
    display_name?: string;
}

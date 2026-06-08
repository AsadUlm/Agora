import axios from "axios";

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "",
    headers: { "Content-Type": "application/json" },
    timeout: 120_000, // debates may take time with LLM calls
});

// ── Request interceptor: attach access token ──────────────────────────

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("agora_access_token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Response interceptor: auto-refresh on 401 ────────────────────────

let _isRefreshing = false;
let _refreshQueue: Array<(token: string) => void> = [];

function _drainQueue(token: string) {
    _refreshQueue.forEach((cb) => cb(token));
    _refreshQueue = [];
}

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;

        // Only attempt refresh once per request
        if (
            error.response?.status === 401 &&
            !original._retried &&
            !original.url?.includes("/auth/refresh") &&
            !original.url?.includes("/auth/login")
        ) {
            original._retried = true;

            const refreshToken = localStorage.getItem("agora_refresh_token");
            if (!refreshToken) {
                // No refresh token — clear session and redirect
                localStorage.removeItem("agora_access_token");
                localStorage.removeItem("agora_refresh_token");
                window.location.replace("/login");
                return Promise.reject(error);
            }

            if (_isRefreshing) {
                // Queue subsequent 401s until refresh completes
                return new Promise((resolve, reject) => {
                    _refreshQueue.push((token) => {
                        original.headers.Authorization = `Bearer ${token}`;
                        resolve(api(original));
                    });
                    _refreshQueue.push(() => reject(error));
                });
            }

            _isRefreshing = true;

            try {
                const res = await api.post<{
                    access_token: string;
                    refresh_token: string;
                }>("/auth/refresh", { refresh_token: refreshToken });

                const newAccess = res.data.access_token;
                const newRefresh = res.data.refresh_token;

                localStorage.setItem("agora_access_token", newAccess);
                localStorage.setItem("agora_refresh_token", newRefresh);

                _drainQueue(newAccess);
                original.headers.Authorization = `Bearer ${newAccess}`;
                return api(original);
            } catch {
                localStorage.removeItem("agora_access_token");
                localStorage.removeItem("agora_refresh_token");
                window.location.replace("/login");
                return Promise.reject(error);
            } finally {
                _isRefreshing = false;
            }
        }

        return Promise.reject(error);
    },
);

export default api;

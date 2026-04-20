import axios from "axios";

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000",
    headers: { "Content-Type": "application/json" },
    timeout: 120_000,
});

// ── Token helpers ───────────────────────────────────────────────────

const ACCESS_KEY = "agora_access_token";
const REFRESH_KEY = "agora_refresh_token";

export const tokenStorage = {
    getAccess: () => localStorage.getItem(ACCESS_KEY),
    getRefresh: () => localStorage.getItem(REFRESH_KEY),
    set(access: string, refresh: string) {
        localStorage.setItem(ACCESS_KEY, access);
        localStorage.setItem(REFRESH_KEY, refresh);
    },
    clear() {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
    },
};

// ── Request interceptor ─────────────────────────────────────────────

apiClient.interceptors.request.use((config) => {
    const token = tokenStorage.getAccess();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Response interceptor: auto-refresh on 401 ───────────────────────

let _isRefreshing = false;
let _refreshQueue: Array<(token: string) => void> = [];

function _drainQueue(token: string) {
    _refreshQueue.forEach((cb) => cb(token));
    _refreshQueue = [];
}

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;

        if (
            error.response?.status === 401 &&
            !original._retried &&
            !original.url?.includes("/auth/refresh") &&
            !original.url?.includes("/auth/login")
        ) {
            original._retried = true;

            const refreshToken = tokenStorage.getRefresh();
            if (!refreshToken) {
                tokenStorage.clear();
                window.location.replace("/login");
                return Promise.reject(error);
            }

            if (_isRefreshing) {
                return new Promise((resolve) => {
                    _refreshQueue.push((token) => {
                        original.headers.Authorization = `Bearer ${token}`;
                        resolve(apiClient(original));
                    });
                });
            }

            _isRefreshing = true;

            try {
                const res = await apiClient.post<{
                    access_token: string;
                    refresh_token: string;
                }>("/auth/refresh", { refresh_token: refreshToken });

                const newAccess = res.data.access_token;
                const newRefresh = res.data.refresh_token;

                tokenStorage.set(newAccess, newRefresh);
                _drainQueue(newAccess);
                original.headers.Authorization = `Bearer ${newAccess}`;
                return apiClient(original);
            } catch {
                tokenStorage.clear();
                window.location.replace("/login");
                return Promise.reject(error);
            } finally {
                _isRefreshing = false;
            }
        }

        return Promise.reject(error);
    },
);

export default apiClient;

import axios from "axios";

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000",
    headers: { "Content-Type": "application/json" },
    timeout: 120_000, // debates may take time with LLM calls
});

export default api;

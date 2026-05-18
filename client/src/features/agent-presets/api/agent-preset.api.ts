import apiClient from "@/shared/api/client";
import type {
    AgentPreset,
    AgentPresetCreatePayload,
    AgentPresetUpdatePayload,
} from "../model/agent-preset.types";

export interface ListPresetsOptions {
    query?: string;
    type?: "system" | "user" | "all";
    includeArchived?: boolean;
}

export async function listAgentPresets(
    opts: ListPresetsOptions = {},
): Promise<AgentPreset[]> {
    const params: Record<string, string> = {};
    if (opts.query) params.query = opts.query;
    if (opts.type) params.type = opts.type;
    if (opts.includeArchived) params.include_archived = "true";
    const res = await apiClient.get<AgentPreset[]>("/agent-presets", { params });
    return res.data;
}

export async function getAgentPreset(id: string): Promise<AgentPreset> {
    const res = await apiClient.get<AgentPreset>(`/agent-presets/${id}`);
    return res.data;
}

export async function createAgentPreset(
    payload: AgentPresetCreatePayload,
): Promise<AgentPreset> {
    const res = await apiClient.post<AgentPreset>("/agent-presets", payload);
    return res.data;
}

export async function updateAgentPreset(
    id: string,
    payload: AgentPresetUpdatePayload,
): Promise<AgentPreset> {
    const res = await apiClient.patch<AgentPreset>(`/agent-presets/${id}`, payload);
    return res.data;
}

export async function deleteAgentPreset(
    id: string,
    options: { archive?: boolean } = {},
): Promise<void> {
    await apiClient.delete(`/agent-presets/${id}`, {
        params: options.archive ? { archive: "true" } : undefined,
    });
}

export async function duplicateAgentPreset(id: string): Promise<AgentPreset> {
    const res = await apiClient.post<AgentPreset>(`/agent-presets/${id}/duplicate`);
    return res.data;
}

export async function setDefaultAgentPreset(id: string): Promise<AgentPreset> {
    const res = await apiClient.post<AgentPreset>(`/agent-presets/${id}/set-default`);
    return res.data;
}

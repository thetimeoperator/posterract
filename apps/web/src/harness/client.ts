import type { AgentChatSummary, AgentCredentialSummary, ForgeMessage } from "@/state/harness";
import type { AgentProviderId } from "./catalog";
import type { PublicSkill } from "./catalog";
import { cloudJson } from "@/lib/cloudRequest";

const configuredBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const API_BASE = configuredBase ?? "/api";

export const REMOTE_HARNESS = Boolean(configuredBase);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return cloudJson<T>(API_BASE, path, init);
}

export async function listPublicSkills() {
  const result = await request<{ skills: Array<Omit<PublicSkill, "accent" | "featured">> }>("/v1/skills");
  return result.skills;
}

export async function listAgentCredentials() {
  const result = await request<{ credentials: AgentCredentialSummary[] }>("/v1/agent-credentials");
  return result.credentials;
}

export function createAgentCredential(input: { provider: AgentProviderId; label: string; model: string; secret: string }) {
  return request<AgentCredentialSummary>("/v1/agent-credentials", { method: "POST", body: JSON.stringify(input) });
}

export function deleteAgentCredential(id: string) {
  return request<void>(`/v1/agent-credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listAgentChats() {
  return request<{ chats: AgentChatSummary[] }>("/v1/chats").then((result) => result.chats);
}

export function createAgentChat(title?: string) {
  return request<AgentChatSummary>("/v1/chats", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function getAgentChat(id: string) {
  return request<{ chat: AgentChatSummary; messages: ForgeMessage[] }>(`/v1/chats/${encodeURIComponent(id)}`);
}

export function runAgent(input: { credentialId: string; chatId?: string; skillIds: string[]; message: string }) {
  return request<{ id: string; chatId?: string; output: { text: string }; skillVersions: Record<string, string> }>("/v1/agent-runs", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export type WorkspaceApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  stats: {
    apiActions: number;
    postsCreated: number;
    postsScheduled: number;
    postsPublished: number;
  };
};

export async function listWorkspaceApiKeys() {
  const result = await request<{ keys: WorkspaceApiKey[] }>("/v1/api-keys");
  return result.keys;
}

export function createWorkspaceApiKey(input: { name: string; scopes: string[] }) {
  return request<WorkspaceApiKey & { secret: string }>("/v1/api-keys", { method: "POST", body: JSON.stringify(input) });
}

export function revokeWorkspaceApiKey(id: string) {
  return request<void>(`/v1/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}

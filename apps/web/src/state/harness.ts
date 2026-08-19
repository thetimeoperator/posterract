import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlatformId } from "@posterract/contract";
import type { AgentProviderId } from "@/harness/catalog";

export type AgentCredentialSummary = {
  id: string;
  provider: AgentProviderId;
  label: string;
  model: string;
  lastFour: string;
  connectedAt: number;
};

export type ForgeMessage = {
  id: string;
  role: "user" | "agent";
  body: string;
  at: number;
  skillIds?: string[];
};

type HarnessState = {
  credentials: AgentCredentialSummary[];
  activeCredentialId?: string;
  activeSkillIds: string[];
  activePlatforms: PlatformId[];
  messages: ForgeMessage[];
  addCredential: (input: { provider: AgentProviderId; label: string; model: string; secret: string }) => AgentCredentialSummary;
  upsertCredential: (credential: AgentCredentialSummary) => void;
  replaceCredentials: (credentials: AgentCredentialSummary[]) => void;
  removeCredential: (id: string) => void;
  setActiveCredential: (id: string) => void;
  toggleSkill: (id: string) => void;
  setSkills: (ids: string[]) => void;
  togglePlatform: (platform: PlatformId) => void;
  addMessage: (message: Omit<ForgeMessage, "id" | "at">) => ForgeMessage;
  clearMessages: () => void;
};

const initialMessages: ForgeMessage[] = [
  {
    id: "welcome",
    role: "agent",
    body: "Your content harness is online. Choose an agent connection and one or more private skills, then tell me what you want to create.",
    at: Date.now(),
  },
];

export const useHarness = create<HarnessState>()(
  persist(
    (set) => ({
      credentials: [],
      activeSkillIds: ["hook-architect", "shortform-script"],
      activePlatforms: ["instagram", "tiktok"],
      messages: initialMessages,
      addCredential: ({ provider, label, model, secret }) => {
        const credential: AgentCredentialSummary = {
          id: `agent_${crypto.randomUUID()}`,
          provider,
          label: label.trim() || `${provider} agent`,
          model,
          lastFour: secret.trim().slice(-4).padStart(4, "•"),
          connectedAt: Date.now(),
        };
        // The demo store deliberately keeps metadata only. Cloud mode sends
        // the secret to the server vault and receives this same safe shape.
        set((state) => ({ credentials: [...state.credentials, credential], activeCredentialId: credential.id }));
        return credential;
      },
      upsertCredential: (credential) => set((state) => ({
        credentials: [...state.credentials.filter((item) => item.id !== credential.id), credential],
        activeCredentialId: credential.id,
      })),
      replaceCredentials: (credentials) => set((state) => ({
        credentials,
        activeCredentialId: credentials.some((item) => item.id === state.activeCredentialId)
          ? state.activeCredentialId
          : credentials[0]?.id,
      })),
      removeCredential: (id) =>
        set((state) => ({
          credentials: state.credentials.filter((credential) => credential.id !== id),
          activeCredentialId: state.activeCredentialId === id ? undefined : state.activeCredentialId,
        })),
      setActiveCredential: (activeCredentialId) => set({ activeCredentialId }),
      toggleSkill: (id) =>
        set((state) => ({
          activeSkillIds: state.activeSkillIds.includes(id)
            ? state.activeSkillIds.filter((skillId) => skillId !== id)
            : [...state.activeSkillIds, id],
        })),
      setSkills: (activeSkillIds) => set({ activeSkillIds }),
      togglePlatform: (platform) =>
        set((state) => ({
          activePlatforms: state.activePlatforms.includes(platform)
            ? state.activePlatforms.filter((value) => value !== platform)
            : [...state.activePlatforms, platform],
        })),
      addMessage: (input) => {
        const message: ForgeMessage = { ...input, id: `msg_${crypto.randomUUID()}`, at: Date.now() };
        set((state) => ({ messages: [...state.messages, message] }));
        return message;
      },
      clearMessages: () => set({ messages: initialMessages }),
    }),
    {
      name: "posterract.harness",
      partialize: (state) => ({
        credentials: state.credentials,
        activeCredentialId: state.activeCredentialId,
        activeSkillIds: state.activeSkillIds,
        activePlatforms: state.activePlatforms,
      }),
    },
  ),
);

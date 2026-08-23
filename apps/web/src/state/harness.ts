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

export type AgentChatSummary = {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

type HarnessState = {
  credentials: AgentCredentialSummary[];
  activeCredentialId?: string;
  activeSkillIds: string[];
  activePlatforms: PlatformId[];
  chats: AgentChatSummary[];
  activeChatId?: string;
  messages: ForgeMessage[];
  addCredential: (input: { provider: AgentProviderId; label: string; model: string; secret: string }) => AgentCredentialSummary;
  upsertCredential: (credential: AgentCredentialSummary) => void;
  replaceCredentials: (credentials: AgentCredentialSummary[]) => void;
  removeCredential: (id: string) => void;
  setActiveCredential: (id: string) => void;
  toggleSkill: (id: string) => void;
  setSkills: (ids: string[]) => void;
  togglePlatform: (platform: PlatformId) => void;
  setChats: (chats: AgentChatSummary[]) => void;
  startChat: (chat: AgentChatSummary) => void;
  openChat: (chat: AgentChatSummary, messages: ForgeMessage[]) => void;
  addMessage: (message: Omit<ForgeMessage, "id" | "at">) => ForgeMessage;
};

const initialMessages: ForgeMessage[] = [];

export const useHarness = create<HarnessState>()(
  persist(
    (set) => ({
      credentials: [],
      activeSkillIds: ["hook-architect", "shortform-script"],
      activePlatforms: ["instagram", "tiktok"],
      chats: [],
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
      setChats: (chats) => set((state) => ({
        chats,
        activeChatId: chats.some((chat) => chat.id === state.activeChatId)
          ? state.activeChatId
          : chats[0]?.id,
      })),
      startChat: (chat) => set((state) => ({
        chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)],
        activeChatId: chat.id,
        messages: [],
      })),
      openChat: (chat, messages) => set((state) => ({
        chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)],
        activeChatId: chat.id,
        messages,
      })),
      addMessage: (input) => {
        const message: ForgeMessage = { ...input, id: `msg_${crypto.randomUUID()}`, at: Date.now() };
        set((state) => ({
          messages: [...state.messages, message],
          chats: state.chats.map((chat) => chat.id === state.activeChatId
            ? {
                ...chat,
                title: chat.messageCount === 0 && message.role === "user"
                  ? message.body.slice(0, 80)
                  : chat.title,
                messageCount: chat.messageCount + 1,
                updatedAt: message.at,
              }
            : chat),
        }));
        return message;
      },
    }),
    {
      name: "posterract.harness",
      partialize: (state) => ({
        credentials: state.credentials,
        activeCredentialId: state.activeCredentialId,
        activeSkillIds: state.activeSkillIds,
        activePlatforms: state.activePlatforms,
        activeChatId: state.activeChatId,
      }),
    },
  ),
);

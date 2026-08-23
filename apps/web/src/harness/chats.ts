import { createAgentChat, REMOTE_HARNESS } from "./client";
import { useHarness, type AgentChatSummary } from "@/state/harness";

export async function beginNewChat() {
  const now = Date.now();
  const chat: AgentChatSummary = REMOTE_HARNESS
    ? await createAgentChat()
    : {
        id: `chat_${crypto.randomUUID()}`,
        title: "New chat",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
  useHarness.getState().startChat(chat);
  return chat;
}

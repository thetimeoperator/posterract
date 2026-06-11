import { capsuleId, nowIso } from "../lib/timing";
import type { ContentCapsule, VidtryxMode } from "./types";

type FakeRunCapsuleRequest = {
  mode: VidtryxMode;
  prompt: string;
  outputUrl?: string;
};

const titleFromPrompt = (prompt: string, mode: VidtryxMode) => {
  const cleanPrompt = prompt.trim().replace(/\s+/g, " ");
  if (!cleanPrompt) return `${mode.name.replace(" Mode", "")} Capsule`;
  return cleanPrompt.length > 58 ? `${cleanPrompt.slice(0, 58)}...` : cleanPrompt;
};

export function createFakeRunCapsule({ mode, prompt, outputUrl }: FakeRunCapsuleRequest): ContentCapsule {
  return {
    id: capsuleId(),
    title: titleFromPrompt(prompt, mode),
    modeId: mode.id,
    status: "ready",
    summary: `${mode.shortName} output generated from the current Vidtryx run.`,
    duration: "0:42",
    aspect: "9:16",
    outputUrl,
    thumbnailTone: mode.color,
    caption: prompt.trim() || mode.description,
    hashtags: ["#Vidtryx", "#AIvideo", "#CreatorTools"],
    createdAt: nowIso(),
  };
}

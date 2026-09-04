/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generation for agents, on the user's plan.
 *
 * A skill that needs an image, a clip or a voice track asks for one here
 * instead of carrying provider keys of its own. That is the whole point: the
 * skill folder stays a folder of instructions, the keys stay on our server,
 * and every call lands on the ledger that makes a plan meterable.
 *
 * The project's own keys still win when it has them — the same rule the
 * Generate panel follows — because a user who brought a key is paying their
 * provider directly and should not also be spending credits.
 */

import { assert } from "@/utils";
import {
  aiGenerateLocal,
  aiGenerateMetered,
  aiKeysStatus,
  hasDesktopAi,
  KEY_FOR_KIND,
} from "@/lib/ai-bridge";

import type { AiGenerationRequest } from "@/lib/ai-bridge";

export interface GenerateImageRequest {
  prompt: string;
  resolution?: "1k" | "2k";
}

export interface GenerateVideoRequest {
  prompt: string;
  resolution?: "768p" | "2k";
  durationSec?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
}

export interface GenerateVoiceRequest {
  text: string;
  voiceId?: string;
}

/** What every generation hands back: a path a `src` can name. */
export interface GenerateResult {
  path: string;
  mimeType: string;
  /** Which account paid: the project's own provider key, or the plan. */
  billedTo: "project-key" | "plan";
}

async function run(
  projectDir: () => string,
  request: AiGenerationRequest,
): Promise<GenerateResult> {
  assert(hasDesktopAi(), "Generation needs the desktop app, where the keys and the plan live.");
  const dir = projectDir();
  assert(dir, "No project is open to generate into.");

  const keys = await aiKeysStatus(dir).catch(() => null);
  if (keys?.[KEY_FOR_KIND[request.kind]]) {
    const output = await aiGenerateLocal(dir, request);
    return { path: output.path, mimeType: output.mimeType, billedTo: "project-key" };
  }

  const result = await aiGenerateMetered(request, `mcp-${crypto.randomUUID()}`);
  const path = result.output?.url;
  assert(path, "The generation finished but returned no file.");
  return {
    path,
    mimeType: result.output?.mimeType ?? "application/octet-stream",
    billedTo: "plan",
  };
}

export function handleGenerateImage(projectDir: () => string) {
  return (request: GenerateImageRequest): Promise<GenerateResult> =>
    run(projectDir, {
      kind: "image",
      prompt: request.prompt,
      aspectRatio: "9:16",
      resolution: request.resolution === "2k" ? "2K" : "1K",
    });
}

export function handleGenerateVideo(projectDir: () => string) {
  return (request: GenerateVideoRequest): Promise<GenerateResult> =>
    run(projectDir, {
      kind: "video",
      prompt: request.prompt,
      aspectRatio: request.aspectRatio ?? "9:16",
      durationSec: request.durationSec ?? 6,
      quality: request.resolution === "2k" ? "2K" : "768P",
    });
}

export function handleGenerateVoice(projectDir: () => string) {
  return (request: GenerateVoiceRequest): Promise<GenerateResult> =>
    run(projectDir, { kind: "voice", text: request.text, voiceId: request.voiceId ?? "" });
}

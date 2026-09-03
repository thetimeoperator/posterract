/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The editor's side of bring-your-own-keys AI generation. There is no cloud
 * middleman and no credit system: the desktop main process reads the user's
 * own provider keys from the project's `api-keys.json`, calls the providers
 * directly, and writes the finished media into the project's
 * `assets/generated/`. This module is the thin typed door to those three
 * main-process channels, plus the option tables the Generate panel renders.
 */

import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';

import type { AiLocalGeneration } from '@desktop/main-channels';

export type ImageResolution = '1K' | '2K';
export type VideoQuality = '768P' | '2K';
export type VideoAspect = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
export type ImageAspect = VideoAspect;

/**
 * What the editor asks to generate. A video request may carry
 * `referenceImage` — a downscaled data URL that becomes the clip's first
 * frame (image-to-video).
 */
export type AiGenerationRequest =
	| { kind: 'image'; prompt: string; aspectRatio: ImageAspect; resolution: ImageResolution }
	| { kind: 'video'; prompt: string; aspectRatio: VideoAspect; durationSec: number; quality: VideoQuality; referenceImage?: string }
	| { kind: 'voice'; text: string; voiceId: string };

export type AiGenerationKind = AiGenerationRequest['kind'];

/** Which key in api-keys.json powers each kind of generation. */
export const KEY_FOR_KIND = { image: 'gemini', video: 'minimax', voice: 'fish' } as const;

export const PROVIDER_LABELS = {
	gemini: { name: 'Google Gemini', site: 'aistudio.google.com/apikey' },
	minimax: { name: 'MiniMax', site: 'platform.minimax.io' },
	fish: { name: 'Fish Audio', site: 'fish.audio' },
} as const;

export interface AiKeysStatus {
	minimax: boolean;
	fish: boolean;
	gemini: boolean;
	/** The keys file's name inside the project folder. */
	path: string;
}

export interface AiLocalOutput {
	/** Project-relative path of the finished media in assets/generated. */
	path: string;
	mimeType: string;
	/** Inline preview for images — thumbnails and re-animation, no server. */
	previewDataUrl?: string;
}

/** Whether the desktop main process — where the keys and providers live — is reachable. */
export function hasDesktopAi(): boolean {
	return typeof window !== 'undefined' && Boolean((window as { desktop?: unknown }).desktop);
}

export function aiKeysStatus(dir: string): Promise<AiKeysStatus> {
	return mainBridge.call(MAIN_CHANNELS.AI_KEYS_STATUS, { dir });
}

/** Which provider a key field belongs to. */
export type AiKeyProvider = 'minimax' | 'fish' | 'gemini';

/** Saves the keys the user typed; blank fields keep the existing value. */
export function aiSaveKeys(
	dir: string,
	keys: Partial<Record<AiKeyProvider, string>>,
): Promise<{ minimax: boolean; fish: boolean; gemini: boolean }> {
	return mainBridge.call(MAIN_CHANNELS.AI_KEYS_SAVE, { dir, keys });
}

/** Reveals api-keys.json in the file manager, for anyone who prefers the file. */
export function aiRevealKeys(dir: string): Promise<{ path: string }> {
	return mainBridge.call(MAIN_CHANNELS.AI_KEYS_REVEAL, { dir });
}

/** Opens a provider's website in the user's real browser. */
export function openExternal(url: string): Promise<void> {
	return mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url });
}

export function aiGenerateLocal(dir: string, request: AiGenerationRequest): Promise<AiLocalOutput> {
	const generation: AiLocalGeneration =
		request.kind === 'voice'
			? { kind: 'voice', text: request.text, voiceId: request.voiceId || undefined }
			: request.kind === 'image'
				? { kind: 'image', prompt: request.prompt, aspectRatio: request.aspectRatio, resolution: request.resolution }
				: {
						kind: 'video',
						prompt: request.prompt,
						aspectRatio: request.aspectRatio,
						durationSec: request.durationSec,
						quality: request.quality,
						referenceImage: request.referenceImage,
					};
	return mainBridge.call(MAIN_CHANNELS.AI_GENERATE, { dir, generation });
}

// ---------------------------------------------------------------------------
// Option tables the panel renders. No prices — the user pays their providers
// directly, at provider rates, with their own keys.
// ---------------------------------------------------------------------------

export const IMAGE_RESOLUTIONS: ReadonlyArray<ImageResolution> = ['1K', '2K'];

export const VIDEO_QUALITIES: ReadonlyArray<{ value: VideoQuality; label: string }> = [
	{ value: '768P', label: 'Standard' },
	{ value: '2K', label: 'HD' },
];

export const VIDEO_ASPECTS: ReadonlyArray<VideoAspect> = ['9:16', '16:9', '1:1', '4:3', '3:4'];

export const VIDEO_DURATION = { min: 4, max: 15 } as const;

export function videoQualityLabel(quality: VideoQuality): string {
	return VIDEO_QUALITIES.find((entry) => entry.value === quality)?.label ?? quality;
}

/** The ceiling a reference-image data URL must stay under. */
export const AI_REFERENCE_IMAGE_MAX_CHARS = 1_000_000;

/** The supported aspect closest to `width : height`. */
export function nearestAspect(width: number, height: number): VideoAspect {
	if (!(width > 0) || !(height > 0)) return '1:1';
	const ratio = width / height;
	let best: VideoAspect = '1:1';
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const aspect of VIDEO_ASPECTS) {
		const [w, h] = aspect.split(':').map(Number);
		const distance = Math.abs(Math.log(ratio / (w! / h!)));
		if (distance < bestDistance) {
			bestDistance = distance;
			best = aspect;
		}
	}
	return best;
}

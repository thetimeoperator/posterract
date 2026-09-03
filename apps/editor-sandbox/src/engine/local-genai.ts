/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `generate.*` written in a composition, made real — on the user's own keys.
 *
 * A declaration in the source is a promise about *what* an element shows, not
 * an instruction to spend money every time the project opens. So a generation
 * is content-addressed: the hash of its fully-resolved options is the asset's
 * `generation.key`, and a key already in the library is used as it is. The
 * same file therefore renders the same video today and next year, offline,
 * without another provider call — and changing the prompt (or the seed) is
 * what asks for a new one, because it is a different key.
 *
 * Nothing here talks to a provider directly: the keys live in the project's
 * `api-keys.json` and only the desktop main process reads them.
 */

import { getAssetSpec, isAssetRef } from '@posterract/composition';
import { GenAi } from '@posterract/video-runtime';
import { aiGenerateLocal, hasDesktopAi } from '@/lib/ai-bridge';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';

import type { AssetRef, AssetSpecInput } from '@posterract/composition';
import type { Asset, AssetLibrary } from '@posterract/video-assets';
import type { SourceModifierValues } from '@posterract/video-runtime';
import type { Entity, World } from 'koota';

/** A stable short hash of a declaration, used as its `generation.key`. */
async function keyOf(spec: Record<string, unknown>): Promise<string> {
	// Sorted, so a spec written with its options in another order is the same
	// declaration and resolves to the same asset.
	const canonical = JSON.stringify(spec, Object.keys(spec).sort());
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The aspect ratio the local providers accept, from the composition's spelling. */
function aspectOf(spec: AssetSpecInput): '9:16' | '16:9' | '1:1' | '4:3' | '3:4' {
	const value = 'aspectRatio' in spec ? spec.aspectRatio : undefined;
	return value === '16:9' || value === '9:16' || value === '4:3' || value === '3:4' ? value : '1:1';
}

export class LocalGenAi extends GenAi {
	private readonly library: () => AssetLibrary | null;
	private readonly projectDir: () => string;
	/** Declarations already running, so two elements naming one share a run. */
	private readonly inFlight = new Map<string, Promise<Asset>>();

	public constructor(library: () => AssetLibrary | null, projectDir: () => string) {
		super();
		this.library = library;
		this.projectDir = projectDir;
	}

	public async resolve(ref: AssetRef): Promise<Asset> {
		const spec = getAssetSpec(ref);

		// Nested declarations first: a video whose first frame is a generated
		// image needs that image to exist before it can be asked for, and its
		// key is part of this one's key — the same chain is the same result.
		const resolved: Record<string, unknown> = { ...spec };
		if (spec.type === 'image' && spec.refs?.length) {
			resolved.refs = await Promise.all(spec.refs.map((input) => this.inputKey(input)));
		}
		if (spec.type === 'video') {
			if (spec.startFrame !== undefined) resolved.startFrame = await this.inputKey(spec.startFrame);
			if (spec.endFrame !== undefined) resolved.endFrame = await this.inputKey(spec.endFrame);
		}

		const key = await keyOf(resolved);

		const library = this.library();
		if (!library) throw new Error('No project is open, so nothing can be generated into it.');

		// Already made — in a previous session, or by an identical declaration
		// elsewhere in this file. Never generated twice.
		const existing = library.list().find((asset) => asset.generation?.key === key);
		if (existing) return existing;

		const running = this.inFlight.get(key);
		if (running) return running;

		const run = this.produce(spec, key, library).finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, run);
		return run;
	}

	/**
	 * What a nested input contributes to the outer key: the generated asset's
	 * own key when it is a declaration, the string itself when it is a path.
	 */
	private async inputKey(input: string | AssetRef): Promise<string> {
		if (!isAssetRef(input)) return input;
		const asset = await this.resolve(input);
		return asset.generation?.key ?? asset.id;
	}

	private async produce(spec: AssetSpecInput, key: string, library: AssetLibrary): Promise<Asset> {
		if (!hasDesktopAi()) {
			throw new Error('Generating from code needs the desktop app, where your provider keys live.');
		}

		const dir = this.projectDir();
		if (spec.type === 'audio') {
			throw new Error('generate.audio has no local provider yet; use generate.voice or an audio file.');
		}

		const output = await aiGenerateLocal(
			dir,
			spec.type === 'voice'
				? { kind: 'voice', text: spec.prompt, voiceId: spec.voice ?? '' }
				: spec.type === 'image'
					? { kind: 'image', prompt: spec.prompt, aspectRatio: aspectOf(spec), resolution: '2K' }
					: {
							kind: 'video',
							prompt: spec.prompt,
							aspectRatio: aspectOf(spec),
							durationSec: spec.duration ?? 5,
							quality: '768P',
							// A generated first frame is passed by the path main
							// wrote it to; main reads it back itself.
							referenceImage: undefined,
						},
		);

		// The bytes are already inside the project — main wrote them into
		// `assets/generated/`. Importing records them in the library with the
		// key, which is what makes the next open free.
		const result = await library.import([output.path], { folder: 'generated', generation: { key } });
		const asset = result.assets[0];
		if (!asset) {
			throw new Error(result.failed[0]?.error.message ?? 'The generated file could not be read back.');
		}
		return asset;
	}

	public async transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
		void world;
		void scene;
		void seed;
		// Scene-level transcription needs the scene's mixed audio rendered
		// first; `posterract_media_transcribe` and the captions panel do the
		// per-file case, which is the one anything asks for today.
		throw new Error(
			'Transcribing a whole scene from code is not supported yet — use Auto captions on a <captions> element, or posterract_media_transcribe on a file.',
		);
	}

	public async derive(asset: Asset, modifiers: SourceModifierValues): Promise<Asset> {
		void modifiers;
		// Source modifiers are a hosted-pipeline feature; without one the
		// honest answer is the original, not a silent no-op that looks applied.
		throw new Error(`Source modifiers are not available locally, so "${asset.path}" is used unchanged.`);
	}
}

/** Whether the running app can generate at all (desktop, with a project open). */
export function canGenerateLocally(): boolean {
	return hasDesktopAi() && typeof mainBridge.call === 'function' && Boolean(MAIN_CHANNELS.AI_GENERATE);
}

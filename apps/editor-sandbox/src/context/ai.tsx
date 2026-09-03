/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Bring-your-own-keys generation state, shared by the Generate panel. One
 * place holds the key status and the generation rows, so closing the panel
 * does not lose a run in progress. Each generation is a single awaited call
 * into the desktop main process, which talks to the user's providers with
 * the user's own keys and writes the result into the project's
 * assets/generated folder.
 */

import { createContext, createSignal, onCleanup, onMount, useContext } from 'solid-js';

import { aiGenerateLocal, aiKeysStatus, aiRevealKeys, aiSaveKeys, hasDesktopAi } from '@/lib/ai-bridge';
import { assert } from '@/utils';

import type { AiGenerationKind, AiGenerationRequest, AiKeyProvider, AiKeysStatus, AiLocalOutput } from '@/lib/ai-bridge';
import type { Accessor, JSX } from 'solid-js';

/** What the panel shows per generation, newest first. */
export interface AiGenerationRow {
	id: string;
	kind: AiGenerationKind;
	/** The prompt (or voice text), for the row's label. */
	label: string;
	status: 'running' | 'succeeded' | 'failed';
	output?: AiLocalOutput;
	error?: string;
	createdAt: number;
}

/** 'no-desktop' means the editor runs without the app shell (dev tab). */
export type AiAvailability = 'no-desktop' | 'ready';

interface AiContextValue {
	availability: Accessor<AiAvailability>;
	keys: Accessor<AiKeysStatus | undefined>;
	generations: Accessor<AiGenerationRow[]>;
	busy: Accessor<boolean>;
	/** Re-reads api-keys.json's status; called on mount and after a save. */
	refreshKeys: () => Promise<void>;
	/** Saves one pasted provider key into the project's api-keys.json. */
	saveKey: (provider: AiKeyProvider, value: string) => Promise<void>;
	/** Reveals the keys file, for anyone who prefers editing it directly. */
	revealKeys: () => Promise<void>;
	/**
	 * Runs one generation with the project's keys. `onOutput` fires with the
	 * finished asset — how a generation targets a specific canvas element.
	 */
	generate: (request: AiGenerationRequest, onOutput?: (output: AiLocalOutput) => void) => Promise<void>;
}

const AiContext = createContext<AiContextValue>();

export function AiProvider(props: { dir: () => string | undefined; children: JSX.Element }) {
	const [availability] = createSignal<AiAvailability>(hasDesktopAi() ? 'ready' : 'no-desktop');
	const [keys, setKeys] = createSignal<AiKeysStatus>();
	const [rows, setRows] = createSignal<AiGenerationRow[]>([]);
	const [busy, setBusy] = createSignal(false);
	let disposed = false;
	onCleanup(() => {
		disposed = true;
	});

	const projectDir = (): string | undefined => props.dir();

	const refreshKeys = async (): Promise<void> => {
		const dir = projectDir();
		if (!dir || !hasDesktopAi()) return;
		try {
			const next = await aiKeysStatus(dir);
			if (!disposed) setKeys(next);
		} catch {
			// The project may not be mounted yet; the panel re-asks on open.
		}
	};

	const saveKey = async (provider: AiKeyProvider, value: string): Promise<void> => {
		const dir = projectDir();
		if (!dir) return;
		const next = await aiSaveKeys(dir, { [provider]: value.trim() });
		if (!disposed) setKeys((current) => ({ ...(current ?? { path: 'api-keys.json' }), ...next }));
	};

	const revealKeys = async (): Promise<void> => {
		const dir = projectDir();
		if (dir) await aiRevealKeys(dir);
	};

	const updateRow = (id: string, patch: Partial<AiGenerationRow>) => {
		setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
	};

	const generate = async (
		request: AiGenerationRequest,
		onOutput?: (output: AiLocalOutput) => void,
	): Promise<void> => {
		const dir = projectDir();
		if (!dir || busy()) return;
		setBusy(true);
		const id = `gen-${crypto.randomUUID()}`;
		setRows((current) => [
			{
				id,
				kind: request.kind,
				label: request.kind === 'voice' ? request.text : request.prompt,
				status: 'running',
				createdAt: Date.now(),
			},
			...current,
		]);
		try {
			const output = await aiGenerateLocal(dir, request);
			if (disposed) return;
			updateRow(id, { status: 'succeeded', output });
			if (onOutput) {
				try {
					onOutput(output);
				} catch {
					// The target element may be gone; the result still sits in
					// the list for a manual insert.
				}
			}
		} catch (error) {
			if (disposed) return;
			updateRow(id, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	onMount(() => void refreshKeys());

	return (
		<AiContext.Provider
			value={{ availability, keys, generations: rows, busy, refreshKeys, saveKey, revealKeys, generate }}
		>
			{props.children}
		</AiContext.Provider>
	);
}

export function useAi(): AiContextValue {
	const ctx = useContext(AiContext);
	assert(ctx, 'useAi must be used within AiProvider');
	return ctx;
}

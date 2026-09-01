/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generation state over the AI bridge, shared by the Generate panel and the
 * credits chip: one place holds the balance, the generation rows and the
 * polling, so closing the panel does not abandon a run and the chip in the
 * chrome always agrees with the panel's footer.
 *
 * The flow per generation is the bridge contract's: `quote` confirms the
 * price, `execute` reserves the credits and starts the run, `status` is
 * polled until it settles. A run that fails is refunded by the server, so a
 * failed row can honestly say no credits were charged.
 */

import { createContext, createMemo, createSignal, onCleanup, onMount, useContext } from 'solid-js';

import {
	AiBridgeError,
	aiRequest,
	estimateCredits,
	hasAiHost,
} from '@/lib/ai-bridge';
import { assert } from '@/utils';

import type {
	AiCredits,
	AiExecuteResult,
	AiGenerationKind,
	AiGenerationOutput,
	AiGenerationRequest,
	AiGenerationStatus,
	AiQuote,
	AiStatusResult,
} from '@/lib/ai-bridge';
import type { Accessor, JSX } from 'solid-js';

const POLL_INTERVAL_MS = 2_500;
const POLL_DEADLINE_MS = 5 * 60_000;
/** The first probe decides "no shell" quickly rather than after the full 30s. */
const PROBE_TIMEOUT_MS = 6_000;

/** What the panel shows per generation, newest first. */
export interface AiGenerationRow {
	id: string;
	kind: AiGenerationKind;
	/** The prompt (or voice text), for the row's label. */
	label: string;
	credits: number;
	status: 'pending' | AiGenerationStatus;
	output?: AiGenerationOutput;
	error?: string;
	/** Whether the failure was the provider's, i.e. the server refunded it. */
	refunded?: boolean;
	createdAt: number;
}

/**
 * Why generating is locked: no plan, an empty balance, or a generation the
 * balance could not cover (`needed` present, from `insufficient_credits`).
 */
export interface AiLock {
	balance: number;
	needed?: number;
	cycleResetsAt?: string | null;
	noPlan?: boolean;
}

/** 'unknown' until the first probe answers or times out. */
export type AiAvailability = 'unknown' | 'connected' | 'offline';

interface AiContextValue {
	availability: Accessor<AiAvailability>;
	credits: Accessor<AiCredits | undefined>;
	generations: Accessor<AiGenerationRow[]>;
	lock: Accessor<AiLock | null>;
	busy: Accessor<boolean>;
	/** Re-reads the balance; also how availability is (re)probed. */
	refreshCredits: () => Promise<void>;
	/** What the panel calls on open: balance plus the server's generation list. */
	hydrate: () => Promise<void>;
	/** quote → execute → poll. Resolves when the run is accepted, not when it finishes. */
	generate: (request: AiGenerationRequest) => Promise<void>;
}

const AiContext = createContext<AiContextValue>();

export function AiProvider(props: { children: JSX.Element }) {
	const [availability, setAvailability] = createSignal<AiAvailability>(hasAiHost() ? 'unknown' : 'offline');
	const [credits, setCredits] = createSignal<AiCredits>();
	const [rows, setRows] = createSignal<AiGenerationRow[]>([]);
	const [shortfall, setShortfall] = createSignal<AiLock | null>(null);
	const [busy, setBusy] = createSignal(false);

	const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
	let disposed = false;
	onCleanup(() => {
		disposed = true;
		// Resolve rather than abandon: a suspended poll loop wakes, sees
		// `disposed`, and returns instead of hanging on a promise forever.
		for (const [timer, resolve] of timers) {
			clearTimeout(timer);
			resolve();
		}
		timers.clear();
	});

	const wait = (ms: number) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				timers.delete(timer);
				resolve();
			}, ms);
			timers.set(timer, resolve);
		});

	const updateRow = (id: string, patch: Partial<AiGenerationRow>) => {
		setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
	};

	const removeRow = (id: string) => {
		setRows((current) => current.filter((row) => row.id !== id));
	};

	/**
	 * The lock the UI acts on: a recorded shortfall wins (it carries `needed`),
	 * otherwise a balance the next generation could never draw from. A
	 * refreshed balance that covers the recorded shortfall clears it.
	 */
	const lock = createMemo<AiLock | null>(() => {
		const recorded = shortfall();
		const state = credits();
		if (recorded) {
			if (state && recorded.needed !== undefined && state.balance >= recorded.needed) return null;
			return recorded;
		}
		if (!state) return null;
		if (!state.plan) return { balance: state.balance, cycleResetsAt: state.cycleResetsAt, noPlan: true };
		if (state.balance <= 0) return { balance: state.balance, cycleResetsAt: state.cycleResetsAt };
		return null;
	});

	const refreshCredits = async (): Promise<void> => {
		if (!hasAiHost()) {
			setAvailability('offline');
			return;
		}
		try {
			const timeout = availability() === 'connected' ? undefined : PROBE_TIMEOUT_MS;
			const next = await aiRequest<AiCredits>('credits', undefined, timeout);
			if (disposed) return;
			setCredits(next);
			setAvailability('connected');
		} catch (error) {
			if (disposed) return;
			// A shell that never answers is the standalone case; a shell that
			// answers with an error is connected and merely unhappy.
			if (error instanceof AiBridgeError && error.timedOut) setAvailability('offline');
		}
	};

	/** One server record folded into a row; undefined for one too malformed to show. */
	const normalizeServerRow = (entry: unknown): AiGenerationRow | undefined => {
		if (!entry || typeof entry !== 'object') return undefined;
		const record = entry as Record<string, unknown>;
		const id = typeof record.generationId === 'string' ? record.generationId
			: typeof record.id === 'string' ? record.id : undefined;
		if (!id) return undefined;
		const kind = (typeof record.kind === 'string' ? record.kind : typeof record.type === 'string' ? record.type : '') as AiGenerationKind;
		if (kind !== 'image' && kind !== 'video' && kind !== 'voice') return undefined;
		const status = typeof record.status === 'string' ? record.status as AiGenerationStatus : 'running';
		const createdAt = typeof record.createdAt === 'number' ? record.createdAt
			: typeof record.createdAt === 'string' ? Date.parse(record.createdAt) || Date.now() : Date.now();
		return {
			id,
			kind,
			label: typeof record.prompt === 'string' ? record.prompt
				: typeof record.text === 'string' ? record.text
				: typeof record.label === 'string' ? record.label : '',
			credits: typeof record.credits === 'number' ? record.credits : 0,
			status: status === 'reserved' || status === 'running' || status === 'succeeded' || status === 'failed' ? status : 'running',
			output: record.output && typeof record.output === 'object' ? record.output as AiGenerationOutput : undefined,
			error: typeof record.error === 'string' ? record.error : undefined,
			refunded: status === 'failed' ? true : undefined,
			createdAt,
		};
	};

	const hydrate = async (): Promise<void> => {
		await refreshCredits();
		if (availability() !== 'connected') return;
		try {
			const data = await aiRequest<unknown>('generations', undefined);
			if (disposed) return;
			const list = Array.isArray(data) ? data
				: data && typeof data === 'object' && Array.isArray((data as { generations?: unknown[] }).generations)
					? (data as { generations: unknown[] }).generations
					: [];
			const server = list.map(normalizeServerRow).filter((row) => row !== undefined);
			setRows((current) => {
				// Server records replace what they name; local rows the server
				// does not know yet (an execute still in flight) stay.
				const known = new Set(server.map((row) => row.id));
				const kept = current.filter((row) => !known.has(row.id));
				return [...server, ...kept].sort((a, b) => b.createdAt - a.createdAt);
			});
			// A run from a previous panel session that is still going gets its
			// polling back.
			for (const row of server) {
				if (row.status === 'reserved' || row.status === 'running') void poll(row.id);
			}
		} catch {
			// The list is a convenience; the panel still works without history.
		}
	};

	const polled = new Set<string>();

	/** Polls `status` for one generation until it settles or 5 minutes pass. */
	const poll = async (generationId: string): Promise<void> => {
		if (polled.has(generationId)) return;
		polled.add(generationId);
		const deadline = Date.now() + POLL_DEADLINE_MS;
		try {
			while (!disposed && Date.now() < deadline) {
				await wait(POLL_INTERVAL_MS);
				if (disposed) return;
				let result: AiStatusResult;
				try {
					result = await aiRequest<AiStatusResult>('status', { generationId }, 10_000);
				} catch {
					continue; // One missed answer is not a verdict; the deadline is.
				}
				if (disposed) return;
				if (result.status === 'succeeded') {
					updateRow(generationId, { status: 'succeeded', output: result.output });
					void refreshCredits();
					return;
				}
				if (result.status === 'failed') {
					updateRow(generationId, {
						status: 'failed',
						error: result.error || 'The provider could not finish this generation.',
						refunded: true,
					});
					void refreshCredits();
					return;
				}
				updateRow(generationId, { status: result.status });
			}
			if (!disposed) {
				updateRow(generationId, {
					status: 'failed',
					error: 'Took longer than 5 minutes — stopped checking. It may still finish; reopen the panel to refresh.',
				});
			}
		} finally {
			polled.delete(generationId);
		}
	};

	const generate = async (request: AiGenerationRequest): Promise<void> => {
		if (busy()) return;
		setBusy(true);
		const localId = `local-${crypto.randomUUID()}`;
		try {
			// The server confirms the number before anything is reserved; the
			// local table only ever labeled the button.
			const quote = await aiRequest<AiQuote>('quote', request);
			const quoted = quote?.credits ?? estimateCredits(request);

			setShortfall(null);
			setRows((current) => [
				{
					id: localId,
					kind: request.kind,
					label: request.kind === 'voice' ? request.text : request.prompt,
					credits: quoted,
					status: 'pending',
					createdAt: Date.now(),
				},
				...current,
			]);

			const result = await aiRequest<AiExecuteResult>('execute', request);
			if (disposed) return;

			if (result.deduped && result.status === 'succeeded') {
				// Already made once; nothing new was charged.
				updateRow(localId, { status: 'succeeded', output: result.output, credits: result.credits ?? 0 });
				void refreshCredits();
				return;
			}

			const generationId = result.generationId ?? localId;
			updateRow(localId, {
				id: generationId,
				status: result.status === 'succeeded' || result.status === 'failed' ? result.status : 'running',
				credits: result.credits ?? quoted,
			});
			if (result.status === 'succeeded' || result.status === 'failed') {
				void refreshCredits();
				return;
			}
			void poll(generationId);
			void refreshCredits();
		} catch (error) {
			if (disposed) return;
			const bridgeError = error instanceof AiBridgeError ? error : new AiBridgeError(String(error));
			if (bridgeError.insufficientCredits) {
				// Not a failed run — nothing ran. The locked state is the answer.
				removeRow(localId);
				setShortfall({
					balance: bridgeError.balance ?? credits()?.balance ?? 0,
					needed: bridgeError.needed,
					cycleResetsAt: bridgeError.cycleResetsAt ?? credits()?.cycleResetsAt,
				});
				void refreshCredits();
				return;
			}
			if (bridgeError.timedOut) setAvailability('offline');
			// An execute that failed leaves its row to carry the message — the
			// server reserved nothing, so no credits were charged. A quote that
			// failed made no row yet, and the caller's toast is the report.
			let hadRow = false;
			setRows((current) => {
				hadRow = current.some((row) => row.id === localId);
				return hadRow
					? current.map((row) => (row.id === localId ? { ...row, status: 'failed' as const, error: bridgeError.message, refunded: true } : row))
					: current;
			});
			if (!hadRow) throw bridgeError;
		} finally {
			setBusy(false);
		}
	};

	// One probe up front, so the chrome's chip exists without the panel ever
	// opening — and so standalone mode settles into its quiet state quickly.
	onMount(() => void refreshCredits());

	return (
		<AiContext.Provider
			value={{
				availability,
				credits,
				generations: rows,
				lock,
				busy,
				refreshCredits,
				hydrate,
				generate,
			}}
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

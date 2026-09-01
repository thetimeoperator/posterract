/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The editor's side of the Posterract AI bridge. The editor runs in an iframe
 * of the Posterract app; generation, credits and billing live in that shell,
 * so every AI feature here is a postMessage round trip: the editor posts
 * `posterract-ai-request` to its parent and the shell answers with
 * `posterract-ai-response`, matched by id. Standalone (dev server, plain
 * browser tab) there is no one on the other side, and every feature built on
 * this module has to degrade to a quiet disabled state rather than crash.
 */

export type AiAction = 'credits' | 'quote' | 'execute' | 'status' | 'generations' | 'transcribe';

/** The account's credit state, as `credits` answers. */
export interface AiCredits {
	/** The plan's id/name; null or empty when the account has none. */
	plan: string | null;
	balance: number;
	/** What a full cycle grants. */
	allotment: number;
	/** ISO timestamp of the next cycle reset. */
	cycleResetsAt: string | null;
}

export interface AiQuoteLineItem {
	label: string;
	credits: number;
}

/** The server's price for a generation, as `quote` answers. */
export interface AiQuote {
	credits: number;
	lineItems: AiQuoteLineItem[];
}

export type AiGenerationStatus = 'reserved' | 'running' | 'succeeded' | 'failed';

export interface AiGenerationOutput {
	url?: string;
	mediaId?: string;
	mimeType?: string;
	width?: number;
	height?: number;
	durationSec?: number;
}

/** What `execute` answers: a generation to poll, or a deduped finished one. */
export interface AiExecuteResult {
	generationId?: string;
	credits?: number;
	status?: AiGenerationStatus;
	/** An identical generation already existed; `output` is it, nothing was charged. */
	deduped?: boolean;
	output?: AiGenerationOutput;
}

export interface AiStatusResult {
	status: AiGenerationStatus;
	output?: AiGenerationOutput;
	error?: string;
}

/** One spoken word, timed in seconds from the start of the media. */
export interface AiTranscriptWord {
	text: string;
	start: number;
	end: number;
}

export interface AiTranscriptSegment {
	text: string;
	words: AiTranscriptWord[];
}

/** What `transcribe` answers, verbatim from POST /v1/ai/transcribe. */
export interface AiTranscriptionResult {
	segments: AiTranscriptSegment[];
	creditsSettled: number;
}

/**
 * What `transcribe` asks for. The bytes ride the postMessage boundary as an
 * ArrayBuffer (structured clone copies it), and the shell turns them into the
 * endpoint's multipart upload — the editor never holds the credentials that
 * upload needs.
 */
export interface AiTranscribeRequest {
	fileName: string;
	mimeType: string;
	/** Whole seconds of media; the server prices 1 credit per started minute. */
	durationSec: number;
	bytes: ArrayBuffer;
}

/** The endpoint's ceiling on one inline upload. */
export const AI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/** The endpoint's ceiling on billable duration: four hours. */
export const AI_TRANSCRIBE_MAX_SECONDS = 14_400;

/**
 * Transcription is an upload plus a provider round trip, so it gets a
 * render-class budget rather than the bridge's 30s default. It stays inside
 * the MCP tool's own 600s timeout so the agent sees this message, not a
 * severed mailbox.
 */
export const AI_TRANSCRIBE_TIMEOUT_MS = 540_000;

/** What every transcription entry point says when there is no shell to ask. */
export const AI_TRANSCRIBE_NO_HOST_MESSAGE =
	'Transcription needs the Posterract app shell and a signed-in workspace.';

/**
 * What the editor asks to generate. The same payload goes to `quote` and to
 * `execute`; the host is the authority on price and validity.
 */
export type AiGenerationRequest =
	| { kind: 'image'; prompt: string; aspectRatio: ImageAspect; resolution: ImageResolution }
	| { kind: 'video'; prompt: string; aspectRatio: VideoAspect; durationSec: number; quality: VideoQuality }
	| { kind: 'voice'; text: string; voiceId: string };

export type AiGenerationKind = AiGenerationRequest['kind'];

/** The message shown when the shell never answers. */
export const AI_TIMEOUT_MESSAGE = "The Posterract app didn't respond — AI features need the app shell";

/**
 * A failed AI request. Carries the wire error's structure when the host sent
 * one — `insufficient_credits` arrives with the shortfall attached, so the
 * panel can say "Needs 72 cr — you have 40" rather than just "failed".
 */
export class AiBridgeError extends Error {
	public readonly code?: string;
	public readonly needed?: number;
	public readonly balance?: number;
	public readonly cycleResetsAt?: string;
	public readonly timedOut: boolean;

	public constructor(message: string, detail: { code?: string; needed?: number; balance?: number; cycleResetsAt?: string; timedOut?: boolean } = {}) {
		super(message);
		this.name = 'AiBridgeError';
		this.code = detail.code;
		this.needed = detail.needed;
		this.balance = detail.balance;
		this.cycleResetsAt = detail.cycleResetsAt;
		this.timedOut = detail.timedOut ?? false;
	}

	public get insufficientCredits(): boolean {
		return this.code === 'insufficient_credits';
	}

	/** The wire's `error` field as an AiBridgeError, whatever shape it took. */
	public static fromWire(error: unknown): AiBridgeError {
		if (typeof error === 'string') return new AiBridgeError(error);
		if (error && typeof error === 'object') {
			const wire = error as { code?: string; message?: string; needed?: number; balance?: number; cycleResetsAt?: string };
			const message = wire.message
				?? (wire.code === 'insufficient_credits' ? 'Not enough credits' : wire.code ?? 'AI request failed');
			return new AiBridgeError(message, {
				code: wire.code,
				needed: typeof wire.needed === 'number' ? wire.needed : undefined,
				balance: typeof wire.balance === 'number' ? wire.balance : undefined,
				cycleResetsAt: typeof wire.cycleResetsAt === 'string' ? wire.cycleResetsAt : undefined,
			});
		}
		return new AiBridgeError('AI request failed');
	}
}

interface PendingRequest {
	resolve: (data: unknown) => void;
	reject: (error: AiBridgeError) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
let bound = false;

function bind(): void {
	if (bound) return;
	bound = true;
	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) return;
		const data = event.data as { type?: string; id?: string; ok?: boolean; data?: unknown; error?: unknown } | undefined;
		if (data?.type !== 'posterract-ai-response' || typeof data.id !== 'string') return;
		const entry = pending.get(data.id);
		if (!entry) return;
		pending.delete(data.id);
		clearTimeout(entry.timer);
		if (data.ok) entry.resolve(data.data);
		else entry.reject(AiBridgeError.fromWire(data.error));
	});
}

/** Whether there is a shell to talk to at all: standalone, the editor is its own top window. */
export function hasAiHost(): boolean {
	try {
		return window.parent !== window;
	} catch {
		return false;
	}
}

/**
 * One request to the shell: posts `posterract-ai-request` and resolves with
 * the matching response's `data`. Rejects with an `AiBridgeError` — a timed
 * out one (`timedOut`) when nothing answers within `timeoutMs`, which is what
 * standalone mode looks like from here.
 */
export function aiRequest<T>(action: AiAction, payload?: unknown, timeoutMs = 30_000): Promise<T> {
	if (!hasAiHost()) {
		return Promise.reject(new AiBridgeError(AI_TIMEOUT_MESSAGE, { timedOut: true }));
	}
	bind();
	const id = crypto.randomUUID();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new AiBridgeError(AI_TIMEOUT_MESSAGE, { timedOut: true }));
		}, timeoutMs);
		pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer });
		window.parent.postMessage({ type: 'posterract-ai-request', id, action, payload }, '*');
	});
}

// ---------------------------------------------------------------------------
// The local price table: a mirror of the server's, for live labels only. The
// `quote` action is the authority — these numbers never charge anyone, they
// let the button say "Generate · 72 cr" before anything crosses the bridge.
// ---------------------------------------------------------------------------

export type ImageResolution = '1K' | '2K';
export type VideoQuality = '768P' | '2K';
export type VideoAspect = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
export type ImageAspect = VideoAspect;

export const IMAGE_RESOLUTIONS: ReadonlyArray<{ value: ImageResolution; credits: number }> = [
	{ value: '1K', credits: 10 },
	{ value: '2K', credits: 15 },
];

export const VIDEO_QUALITIES: ReadonlyArray<{ value: VideoQuality; label: string; perSecond: number }> = [
	{ value: '768P', label: 'Standard', perSecond: 12 },
	{ value: '2K', label: 'HD', perSecond: 20 },
];

export const VIDEO_ASPECTS: ReadonlyArray<VideoAspect> = ['9:16', '16:9', '1:1', '4:3', '3:4'];

export const VIDEO_DURATION = { min: 4, max: 15 } as const;

export const VOICE_CREDITS_PER_1K_CHARS = 3;

export function imageCredits(resolution: ImageResolution): number {
	return IMAGE_RESOLUTIONS.find((entry) => entry.value === resolution)?.credits ?? 0;
}

export function videoQualityLabel(quality: VideoQuality): string {
	return VIDEO_QUALITIES.find((entry) => entry.value === quality)?.label ?? quality;
}

export function videoCredits(durationSec: number, quality: VideoQuality): number {
	const perSecond = VIDEO_QUALITIES.find((entry) => entry.value === quality)?.perSecond ?? 0;
	const seconds = Math.min(VIDEO_DURATION.max, Math.max(VIDEO_DURATION.min, Math.round(durationSec)));
	return seconds * perSecond;
}

/** 3 cr per started 1,000 characters; nothing for nothing. */
export function voiceCredits(chars: number): number {
	if (chars <= 0) return 0;
	return Math.ceil(chars / 1000) * VOICE_CREDITS_PER_1K_CHARS;
}

/** The local estimate for `request`, in credits — what the labels show before a quote. */
export function estimateCredits(request: AiGenerationRequest): number {
	switch (request.kind) {
		case 'image':
			return imageCredits(request.resolution);
		case 'video':
			return videoCredits(request.durationSec, request.quality);
		case 'voice':
			return voiceCredits(request.text.length);
	}
}

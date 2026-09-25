/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The microphone, for the voice bar and only while the talk key is held. It
// opens on the first hold, stays warm for a minute so the next command starts
// at once, then closes — the menu-bar microphone light is never left on.
//
// A hold records one short Opus clip and, as it records, measures the voice
// for the wave: how loud (the level) and where (low, mid, high bands). The
// analyser is never connected to the speakers.

export type VoiceClip = { bytes: Uint8Array; mime: string; durationMs: number; peakLevel: number };
export type CaptureLevels = { low: number; mid: number; high: number; level: number };

/** How long the stream stays open after the last command. */
const KEEP_WARM_MS = 60_000;
/** Recording goes on this long after release, so the last syllable is not clipped. */
const TAIL_MS = 150;
/**
 * Below either of these a clip is not sent: Whisper invents phrases such as
 * "Thank you." out of silence and taps.
 */
const MIN_DURATION_MS = 300;
const MIN_PEAK = 0.15;
/** A command is a sentence; a hold longer than this is ended for the person. */
export const MAX_CAPTURE_MS = 15_000;

const MIME = 'audio/webm;codecs=opus';
const BITS_PER_SECOND = 32_000;

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let peak = 0;
let frame = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let limitTimer: ReturnType<typeof setTimeout> | undefined;

const live = () => Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'));

/**
 * Opens the microphone, or keeps the open one: 'ready' once it is live. The
 * first open takes a moment, and the bar waits for it — the wave appearing
 * is the person's cue to speak.
 */
export async function warmMicrophone(): Promise<'ready' | 'denied' | 'no-device'> {
	clearTimeout(releaseTimer);
	if (live() && analyser) return 'ready';
	releaseMicrophone();

	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
	} catch (error) {
		const name = error instanceof DOMException ? error.name : '';
		return name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-device' : 'denied';
	}

	context = new AudioContext();
	analyser = context.createAnalyser();
	analyser.fftSize = 1024;
	analyser.smoothingTimeConstant = 0.6;
	context.createMediaStreamSource(stream).connect(analyser);
	return 'ready';
}

/** The mean of the analyser's bins between two frequencies, 0–1, eased up a little so speech reads. */
function band(bins: Uint8Array, binHz: number, from: number, to: number): number {
	const first = Math.max(0, Math.floor(from / binHz));
	const last = Math.min(bins.length - 1, Math.ceil(to / binHz));
	if (last < first) return 0;
	let sum = 0;
	for (let index = first; index <= last; index += 1) sum += bins[index]!;
	return Math.pow(sum / (last - first + 1) / 255, 0.8);
}

/**
 * Starts recording and measuring. `onLevels` is called once a frame with the
 * voice as it is now; `onLimit` when the hold has gone on too long.
 */
export function startCapture(onLevels: (levels: CaptureLevels) => void, onLimit?: () => void): void {
	if (!stream || !analyser || !context) return;
	clearTimeout(releaseTimer);
	if (context.state === 'suspended') void context.resume();

	chunks = [];
	peak = 0;
	startedAt = performance.now();
	const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : undefined;
	recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITS_PER_SECOND });
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};
	recorder.start(100);

	const meter = analyser;
	const time = new Float32Array(meter.fftSize);
	const bins = new Uint8Array(meter.frequencyBinCount);
	const binHz = context.sampleRate / meter.fftSize;

	const measure = () => {
		frame = requestAnimationFrame(measure);
		meter.getFloatTimeDomainData(time);
		let squares = 0;
		for (const sample of time) squares += sample * sample;
		const rms = Math.sqrt(squares / time.length);
		const db = 20 * Math.log10(Math.max(rms, 1e-5));
		// −50 dB is nothing, −10 dB is a raised voice.
		const level = Math.min(1, Math.max(0, (db + 50) / 40));
		peak = Math.max(peak, level);

		meter.getByteFrequencyData(bins);
		onLevels({
			low: band(bins, binHz, 80, 300),
			mid: band(bins, binHz, 300, 2_000),
			high: band(bins, binHz, 2_000, 8_000),
			level,
		});
	};
	frame = requestAnimationFrame(measure);
	limitTimer = setTimeout(() => onLimit?.(), MAX_CAPTURE_MS);
}

function scheduleRelease(): void {
	clearTimeout(releaseTimer);
	releaseTimer = setTimeout(releaseMicrophone, KEEP_WARM_MS);
}

/** Stops the recorder, after the tail, and waits for its last chunk. */
async function finish(): Promise<string> {
	const active = recorder;
	recorder = null;
	clearTimeout(limitTimer);
	cancelAnimationFrame(frame);
	if (!active) return '';
	const stopped = new Promise<void>((resolve) => {
		active.onstop = () => resolve();
	});
	if (active.state !== 'inactive') active.stop();
	await stopped;
	scheduleRelease();
	return active.mimeType || 'audio/webm';
}

/**
 * Ends the hold and hands back the clip — or null when there is nothing worth
 * sending: too short, or too quiet to be a voice.
 */
export async function stopCapture(): Promise<VoiceClip | null> {
	if (!recorder) return null;
	const durationMs = performance.now() - startedAt;
	await new Promise((resolve) => setTimeout(resolve, TAIL_MS));
	const mime = await finish();
	if (durationMs < MIN_DURATION_MS || peak < MIN_PEAK) return null;
	const blob = new Blob(chunks, { type: mime });
	chunks = [];
	return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, durationMs, peakLevel: peak };
}

/** Ends the hold and throws the recording away: Escape, or the window losing focus. */
export async function cancelCapture(): Promise<void> {
	await finish();
	chunks = [];
}

/** Closes the microphone now. */
export function releaseMicrophone(): void {
	clearTimeout(releaseTimer);
	cancelAnimationFrame(frame);
	if (recorder && recorder.state !== 'inactive') recorder.stop();
	recorder = null;
	for (const track of stream?.getTracks() ?? []) track.stop();
	stream = null;
	analyser = null;
	void context?.close().catch(() => undefined);
	context = null;
}

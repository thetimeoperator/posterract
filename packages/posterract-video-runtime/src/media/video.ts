/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, Input, InputVideoTrack, EncodedPacketSink, EncodedPacket, CanvasSink, type WrappedCanvas } from 'mediabunny';

import { AssetId, VideoDecoderHandle, Mode } from '../traits';
import { assert } from '../utils/assert';
import { getAsset, getAssetSource, getSequenceFrameRate } from '../actions/assets';
import { FrameCache } from './frame-cache';
import { getKeyframeIndex } from './keyframe-index';
import { SequenceDecoder } from './sequence';

import type { Entity, World } from 'koota';
import type { KeyframeIndex } from './keyframe-index';
import type { VideoAsset } from '@posterract/video-assets';


export type VideoBufferMode = 'discarded' | 'idle' | 'alive';

/**
 * Inactivity window after which an `alive` buffer automatically drops to
 * `idle`, freeing its decoder and frame cache while keeping the display canvas.
 */
const IDLE_TIMEOUT_MS = 10_000;

/**
 * Max extra frames we are willing to decode forward from the live cursor in
 * order to avoid a keyframe lookup + decoder reseed. Higher = stronger bias.
 */
const FORWARD_BIAS_FRAMES = 24;

/**
 * Frames decoded past the target of a backward seek, so the target is pushed out
 * of the decoder. H.264 lets a decoder hold up to 16 frames back to put them in
 * presentation order, and one that isn't told how many the file needs holds that
 * many: macOS screen recordings measured nine.
 */
const DRAIN_FRAMES = 16;

/** Packets let wait in the decoder's queue before a fill holds the next one back. */
const MAX_DECODE_QUEUE = 2;

/**
 * How long the decoder may go without taking a packet or finishing a flush before
 * it counts as stuck and is restarted. Fills run one at a time, so a decoder that
 * stopped would otherwise hold every seek after it and freeze the preview for good.
 */
const STALL_TIMEOUT_MS = 2_000;

/**
 * How far the preview may drift from the requested frame. A neighbour this close
 * beats holding the last drawn frame while the exact one is still decoding.
 */
const DISPLAY_TOLERANCE_FRAMES = 4;

/**
 * Total pixel budget of the preview frame cache
 */
const CACHE_PIXEL_BUDGET = 768 * 432 * 81; // 81 tiles at 768x432

/**
 * Per-tile pixel cap (~720p) — enough detail for the preview canvas.
 */
const MAX_TILE_PIXELS = 1280 * 720;

/**
 * Two seeks arriving closer together than this are treated as one continuous drag.
 */
const SCRUB_EVENT_WINDOW_MS = 250;

/**
 * Quiet period after the last scrub seek before the exact frame is resolved.
 */
const SCRUB_SETTLE_MS = 120;

const MIN_CACHE_COUNT = 30;
const MAX_CACHE_COUNT = 81;

export class VideoBuffer {
	public errored = false;
	public asset: VideoAsset;
	public firstPacketTimestamp = 0;
	public packetSink: EncodedPacketSink | null = null;
	public mode: VideoBufferMode = 'alive';
	public initialized: Promise<void>;

	public readonly cache: FrameCache;
	public readonly queue = new VideoDecoderQueue(this.frameCallback.bind(this));

	// user facing display canvas
	public readonly canvas = new OffscreenCanvas(0, 0);
	public readonly ctx = this.canvas.getContext('2d')!;

	private currentFrame: number = -1;
	private isDirty: boolean = true;
	private keyframes: KeyframeIndex | null = null;

	/**
	 * Frame the preview is aiming to show. Tracks `currentFrame` except while scrubbing,
	 * where it points at the covering keyframe instead of the requested frame.
	 */
	private displayFrame: number = -1;

	/**
	 * Keyframes a scrub is waiting on. The preview keeps showing the last one that landed
	 * until the next arrives, so a drag never blanks out for the length of a decode.
	 * Holds several at once: decoder output trails submission by a handful of packets.
	 */
	private readonly pendingScrub = new Set<number>();

	/** The project's frame rate, as the last seek gave it: what decides which frames are ever shown. */
	private displayRate = 0;

	/**
	 * The decoder's current run: the keyframe it was started from and the last frame
	 * it has put out since (-1 for none). Output comes in presentation order, so every
	 * frame in between has come out already or is one the file does not have.
	 */
	private runStart: number = -1;
	private lastOutput: number = -1;

	private lastFrameIndex: number = 0;
	private seekGeneration = 0;
	private seekLock: Promise<void> = Promise.resolve();
	private iterator: AsyncGenerator<EncodedPacket, void, unknown> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private settleTimer: ReturnType<typeof setTimeout> | null = null;
	private lastSeekAt: number = -Infinity;

	public constructor(asset: VideoAsset) {
		this.asset = asset;

		const pixels = Math.min(asset.width * asset.height, MAX_TILE_PIXELS);
		const count = Math.min(MAX_CACHE_COUNT, Math.max(MIN_CACHE_COUNT, Math.floor(CACHE_PIXEL_BUDGET / pixels)));
		this.cache = new FrameCache({ pixels, count });

		this.initialized = this.initialize();
	}

	private async initialize() {
		try {
			const videoTrack = await getVideoTrack(this.asset);

			assert(videoTrack, 'Video track not found');

			this.keyframes = getKeyframeIndex(this.asset.id, videoTrack);

			await this.queue.init(videoTrack);

			this.cache.rotation = videoTrack.rotation;
			this.packetSink = new EncodedPacketSink(videoTrack);
			this.firstPacketTimestamp = Math.max(0, await videoTrack.getFirstTimestamp() ?? 0);
			this.lastFrameIndex = Math.max(0, Math.round(this.asset.duration * this.asset.frameRate) - 1);
			this.isDirty = true;
		} catch (e) {
			console.error('Error initializing video decoder', e);
			this.errored = true;
		}
	}

	private frameCallback(frame: VideoFrame) {
		const timestampSeconds = frame.timestamp / 1e6;
		const frameIndex = this.secondsToFrames(timestampSeconds);
		if (frameIndex >= this.runStart) {
			this.lastOutput = Math.max(this.lastOutput, frameIndex);
		}
		// Decoded, since the frames after it are built from it, but never drawn: the
		// project shows none of it. A keyframe a scrub is waiting on is shown regardless.
		if (!this.isShown(frameIndex) && !this.pendingScrub.has(frameIndex)) return;
		this.cache.insert(frame, frameIndex);
		this.isDirty = true;

		// A scrub keyframe takes over the preview the moment it lands, and only then:
		// matching on the index keeps frames from an abandoned fill out of the display.
		if (this.pendingScrub.delete(frameIndex)) {
			this.displayFrame = frameIndex;
		}
	}

	public seekTo(frame: number, frameRate: number): undefined {
		this.displayRate = frameRate;
		const targetFrame = Math.round((frame / frameRate) * this.asset.frameRate);

		const isEmpty = !this.packetSink;
		const isCurrentFrame = targetFrame === this.currentFrame;
		const isCached = this.cache.has(targetFrame) && isCurrentFrame;
		const isIdle = this.mode === 'idle' && isCurrentFrame;
		const errored = this.errored;

		if (isEmpty || isCurrentFrame || isCached || isIdle || errored) {
			return;
		}

		const previousFrame = this.currentFrame;
		const consecutive = performance.now() - this.lastSeekAt < SCRUB_EVENT_WINDOW_MS;
		this.lastSeekAt = performance.now();

		this.currentFrame = targetFrame;
		this.isDirty = true;

		this.touch();

		// A run of large jumps is a drag, not a playback step. Walking each GOP to the
		// exact frame costs more than the gap between pointer events, so every walk gets
		// cancelled by the next one and nothing ever paints.
		const jumped = Math.abs(targetFrame - previousFrame) > FORWARD_BIAS_FRAMES;

		if (consecutive && jumped && this.scrubTo(targetFrame)) {
			return;
		}

		this.exactSeekTo(targetFrame, previousFrame);
	}

	/**
	 * Paints the keyframe covering `targetFrame` rather than the frame itself: one packet,
	 * no walk through the GOP. Returns false when the keyframe index cannot place the
	 * target yet, leaving the caller to fall back to an exact seek.
	 */
	private scrubTo(targetFrame: number): boolean {
		const keyTimestamp = this.keyframes?.floor(this.framesToSeconds(targetFrame)) ?? null;

		if (keyTimestamp === null) {
			return false;
		}

		const keyFrame = this.secondsToFrames(keyTimestamp);
		this.scheduleSettle();

		// Supersedes any fill still running for a position we have already left.
		const generation = ++this.seekGeneration;

		// Consecutive positions inside one GOP resolve to a keyframe we already hold.
		if (this.cache.has(keyFrame)) {
			this.displayFrame = keyFrame;
			return true;
		}

		this.pendingScrub.add(keyFrame);

		this.seekLock = this.seekLock
			.then(() => this.decodeKeyframe(keyTimestamp, generation))
			.catch(() => { });

		return true;
	}

	private async decodeKeyframe(keyTimestamp: number, generation: number): Promise<void> {
		if (generation !== this.seekGeneration) return;

		const keyPacket = await this.packetSink?.getKeyPacket(keyTimestamp);
		if (!keyPacket || generation !== this.seekGeneration) return;

		// Whatever the decoder still holds is for a position the drag has already left.
		await this.iterator?.return();
		this.iterator = null;
		this.startRun(keyPacket);

		await this.queue.decode(keyPacket);
		// A decoder holds frames back to put them in presentation order, so a keyframe on
		// its own would only come out once the next one pushed it: a whole step behind the
		// drag, and the last one never. Flushing puts it on screen now; the settle pass
		// decodes forward from it again.
		await this.queue.flush();
	}

	/**
	 * Points the decoder at a keyframe to decode forward from. Resets it first, dropping
	 * what it still has queued for the old position — left in, that work is decoded
	 * ahead of the frames now wanted, and repeated jumps stack it up until the preview
	 * stops for seconds.
	 */
	private startRun(keyPacket: EncodedPacket) {
		this.queue.reseed();
		this.runStart = this.secondsToFrames(keyPacket.timestamp);
		this.lastOutput = -1;
	}

	/**
	 * Re-runs the seek for real once the drag stops.
	 */
	private scheduleSettle() {
		if (this.settleTimer !== null) {
			clearTimeout(this.settleTimer);
		}

		this.settleTimer = setTimeout(() => {
			this.settleTimer = null;
			if (this.mode !== 'alive' || this.errored) return;
			this.exactSeekTo(this.currentFrame, this.currentFrame);
		}, SCRUB_SETTLE_MS);
	}

	private exactSeekTo(targetFrame: number, previousFrame: number) {
		this.displayFrame = targetFrame;
		this.pendingScrub.clear();

		const forward = this.isBlockedFrame(targetFrame)
			? targetFrame >= previousFrame
			: true;

		const generation = ++this.seekGeneration;

		const [left, right] = this.computeWindow(targetFrame, forward);
		this.cache.leftFrameIndex = left;
		this.cache.rightFrameIndex = right;

		let seed = targetFrame;
		let run: Promise<void>
		if (forward) {
			while (this.isBlockedFrame(seed) && seed <= this.cache.rightFrameIndex) {
				seed++;
			}

			run = this.seekLock.then(() => this.fillCache([seed, this.cache.rightFrameIndex], generation));
		} else {
			while (this.cache.has(seed) && seed >= this.cache.leftFrameIndex) {
				seed--;
			}

			// TODO: Find a better solution for DRAIN_FRAMES
			run = this.seekLock.then(() => this.fillCache([this.cache.leftFrameIndex, seed + DRAIN_FRAMES], generation));
		}

		// Run after the previous seek finishes — never concurrently.
		this.seekLock = run.catch(() => { });
	}

	private framesToSeconds(frames: number) {
		return Math.max(this.firstPacketTimestamp, (frames / this.asset.frameRate) + this.firstPacketTimestamp);
	}

	private secondsToFrames(seconds: number) {
		return Math.max(0, Math.round((seconds - this.firstPacketTimestamp) * this.asset.frameRate));
	}

	/**
	 * Whether `frame` is already taken care of — decoded into the cache, or still in-flight.
	 */
	private isBlockedFrame(frame: number) {
		// Nothing will ever ask for it, so nothing is waiting on it either.
		if (!this.isShown(frame)) return true;
		if (this.cache.has(frame)) return true;

		// The decoder has already put out a later frame of this run, so this one came out
		// before it or the file does not have it: a variable-rate recording skips frame
		// numbers wherever it dropped a frame. Asking again only decodes the run twice.
		if (this.runStart >= 0 && frame >= this.runStart && frame <= this.lastOutput) return true;

		for (const micros of this.queue.inFlight) {
			if (this.secondsToFrames(micros / 1e6) === frame) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether the project ever shows frame `frameIndex` of the video. The playhead
	 * only asks for whole project frames (see `forwardVideoDecoder`), whatever the
	 * clip's speed, and each maps to one frame of the video — so a 60fps clip in a
	 * 30fps project shows every other frame and never the rest. Every frame is
	 * shown when the video's rate is no higher than the project's.
	 */
	private isShown(frameIndex: number): boolean {
		const rate = this.displayRate;
		const source = this.asset.frameRate;
		if (!(rate > 0) || !(source > rate)) return true;
		const nearest = Math.round((frameIndex / source) * rate);
		return Math.round((nearest / rate) * source) === frameIndex;
	}

	/** How many of the video's frames go by per frame the project shows; 1 at most one each. */
	private frameStride(): number {
		const rate = this.displayRate;
		const source = this.asset.frameRate;
		return rate > 0 && source > rate ? source / rate : 1;
	}

	private computeWindow(targetFrame: number, forward: boolean): [number, number] {
		// Only shown frames are kept (see `isShown`), so the window spans as many of
		// the video's frames as it takes to hold as many of those as the cache fits,
		// less one for rounding: a 60fps clip in a 30fps project is buffered twice
		// as far ahead as it was. The whole video fits when it is short enough.
		const span = Math.floor((this.cache.config.count - 3) * this.frameStride()) + 1;

		// Whole video fits in the cache — keep all of it.
		if (this.lastFrameIndex <= span) {
			return [0, this.lastFrameIndex];
		}

		const ahead = Math.round((span * 2) / 3);
		const behind = span - ahead;

		let left = targetFrame - (forward ? behind : ahead);
		let right = targetFrame + (forward ? ahead : behind);

		// Push budget that falls outside the boundaries onto the other side.
		if (left < 0) {
			right -= left;
			left = 0;
		}
		if (right > this.lastFrameIndex) {
			left -= right - this.lastFrameIndex;
			right = this.lastFrameIndex;
		}

		return [Math.max(0, left), Math.min(this.lastFrameIndex, right)];
	}

	private async fillCache(range: [number, number], generation: number): Promise<void> {
		if (generation !== this.seekGeneration || Math.abs(range[1] - range[0]) <= 3) return;
		// Note: only decode for three or more frames at a time to avoid unnecessary reseeding

		const fromSecs = this.framesToSeconds(range[0]);
		const untilSecs = this.framesToSeconds(range[1]);
		const cursor = this.queue.lastSubmitted;
		const live = !!(this.iterator && this.queue.isAlive && cursor);

		// Carry on from where the decoder is whenever the range starts past what this run
		// has put out: what lies in between is on its way, held back for ordering. Going
		// back to the keyframe instead, as a cursor that had merely run past the end of the
		// range once did, decoded the run again on top of everything still queued.
		let reuse = live && range[0] >= this.runStart && range[0] > this.lastOutput;
		let keyTimestamp = this.keyframes?.floor(fromSecs) ?? null;

		// If the cursor lags far behind the range start, skip forward to the nearest
		// keyframe rather than decoding through the whole gap.
		const biasSecs = FORWARD_BIAS_FRAMES / this.asset.frameRate;
		if (reuse && cursor!.timestamp < fromSecs - biasSecs) {
			keyTimestamp ??= (await this.packetSink?.getKeyPacket(fromSecs))?.timestamp ?? null;
			if (keyTimestamp !== null && keyTimestamp - cursor!.timestamp > biasSecs) {
				reuse = false; // jumping to the keyframe
			}
		}

		// we cant reuse the iterator, so we need to reseed the decoder
		// and get create a new iterator
		if (!reuse) {
			const keyPacket = (await this.packetSink?.getKeyPacket(keyTimestamp ?? fromSecs)) ?? null;
			if (!keyPacket || generation !== this.seekGeneration) return;
			await this.iterator?.return();
			this.iterator = this.packetSink?.packets(keyPacket) ?? null;
			this.startRun(keyPacket);
		}

		const iterator = this.iterator;
		if (generation !== this.seekGeneration || !iterator) return;

		while (true) {
			const { value: packet, done } = await iterator.next();
			if (done || !packet) {
				// The end of the file: push out the frames the decoder was holding back, or the
				// last of them never show. Every frame of the run has come out after this.
				await this.queue.flush();
				this.lastOutput = Infinity;
				break;
			}

			await this.queue.decode(packet);

			// No packet in flight means the decoder was restarted under the fill (see
			// `VideoDecoderQueue.decode`), and it takes nothing but a keyframe now.
			if (generation !== this.seekGeneration || packet.timestamp >= untilSecs || !this.queue.lastSubmitted) break;
		}
	}

	public toBitmap() {
		if (this.isDirty && this.displayFrame >= 0) {

			const nearest = this.cache.findNearest(this.displayFrame, DISPLAY_TOLERANCE_FRAMES);
			const tile = nearest === undefined ? undefined : this.cache.findTile(nearest);
			const ctx = this.ctx;

			if (tile && (this.canvas.width !== tile.width || this.canvas.height !== tile.height)) {
				this.canvas.width = tile.width;
				this.canvas.height = tile.height;
				this.ctx.imageSmoothingEnabled = false;
			}

			if (tile) {
				ctx.drawImage(
					this.cache.atlas,
					tile.x,
					tile.y,
					tile.width,
					tile.height,
					0,
					0,
					tile.width,
					tile.height,
				);
				this.isDirty = false;
			}
		}

		if (this.canvas.width === 0 || this.canvas.height === 0) {
			return null;
		}

		return this.canvas;
	}

	private touch() {
		this.mode = 'alive';
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
		}
		this.idleTimer = setTimeout(() => this.idle(), IDLE_TIMEOUT_MS);
	}

	public idle() {
		if (this.mode !== 'alive') return;
		this.mode = 'idle';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		if (this.settleTimer !== null) {
			clearTimeout(this.settleTimer);
			this.settleTimer = null;
		}

		this.pendingScrub.clear();
		this.cache.dispose();
		this.queue.dispose();
		this.iterator?.return();
		this.iterator = null;
		this.runStart = -1;
		this.lastOutput = -1;
	}

	public dispose() {
		if (this.mode === 'discarded') return;
		this.mode = 'discarded';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		if (this.settleTimer !== null) {
			clearTimeout(this.settleTimer);
			this.settleTimer = null;
		}

		this.pendingScrub.clear();
		this.cache.dispose();
		this.queue.dispose();
		this.iterator?.return();
		this.iterator = null;
		this.runStart = -1;
		this.lastOutput = -1;

		// Release the display canvas backing store.
		this.canvas.width = 0;
		this.canvas.height = 0;
	}
}

class VideoDecoderQueue {
	private config: VideoDecoderConfig | null = null;
	private decoder: VideoDecoder | null = null;
	private resolver: ReturnType<typeof Promise.withResolvers> | null = null;
	private callback: (frame: VideoFrame) => void;
	public lastSubmitted: EncodedPacket | null = null;
	public readonly inFlight = new Set<number>();

	public constructor(callback: (frame: VideoFrame) => void) {
		this.callback = callback;
	}

	public get isAlive() {
		return this.decoder?.state === 'configured';
	}

	/**
	 * Synchronously discard all in-flight work and re-arm the decoder for a fresh keyframe
	 */
	public reseed() {
		if (!this.decoder) return;
		this.decoder.reset();
		assert(this.config, 'Decoder config not available');
		this.decoder.configure(this.config);
		this.resolver?.resolve(null);
		this.resolver = null;
		this.lastSubmitted = null;
		this.inFlight.clear();
	}

	private handleOutput(frame: VideoFrame) {
		this.resolver?.resolve(null);
		this.inFlight.delete(frame.timestamp);

		for (const micros of this.inFlight) {
			if (micros < frame.timestamp) {
				this.inFlight.delete(micros);
			}
		}

		this.callback(frame);
		frame.close();
	}

	private handleDequeue() {
		this.resolver?.resolve(null);
		this.resolver = null;
	};

	private handleError(e?: DOMException) {
		console.error(e?.message);
		this.dispose();
	}

	public async init(track: InputVideoTrack) {
		this.config = await track.getDecoderConfig();
		assert(this.config, 'Failed to get decoder config from track');
		const support = await VideoDecoder.isConfigSupported(this.config);
		assert(support.supported, 'Decoder config not supported');
	}

	private ensureDecoder(packet: EncodedPacket) {
		if (this.decoder || packet.type === 'delta') return;

		assert(this.config, 'Decoder config not available');

		this.decoder = new VideoDecoder({
			error: this.handleError.bind(this),
			output: this.handleOutput.bind(this),
		});

		this.decoder.addEventListener('dequeue', this.handleDequeue.bind(this));
		this.decoder.configure(this.config);
	}

	public async decode(packet: EncodedPacket) {
		this.ensureDecoder(packet);

		const decoder = this.decoder;
		if (decoder?.state !== 'configured') {
			this.lastSubmitted = null;
			this.resolver?.resolve(null);
			this.resolver = null;
			this.inFlight.clear();
			return;
		}

		decoder.decode(packet.toEncodedVideoChunk());
		this.lastSubmitted = packet;
		this.inFlight.add(packet.microsecondTimestamp);

		// Hand over the next packet only once the queue is back down. An output wakes the
		// wait as well as a dequeue, so it checks again rather than taking every wake as
		// room: that let a fill queue two packets for each one the decoder took.
		const since = performance.now();
		while (this.decoder === decoder && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
			if (performance.now() - since > STALL_TIMEOUT_MS) {
				console.warn('[video] the decoder stopped taking packets; restarting it');
				this.reseed();
				return;
			}

			const wake = Promise.withResolvers();
			this.resolver = wake;
			const poll = setTimeout(() => wake.resolve(null), STALL_TIMEOUT_MS / 4);
			await wake.promise;
			clearTimeout(poll);
		}
	}

	/**
	 * Pushes out the frames the decoder is holding back to put them in order. It takes
	 * nothing but a keyframe afterwards, so whatever it was decoding forward ends here.
	 */
	public async flush() {
		const decoder = this.decoder;
		if (decoder?.state !== 'configured') return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const finished = await Promise.race([
			// A reset while flushing rejects it; that one was ours.
			decoder.flush().then(() => true, () => true),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), STALL_TIMEOUT_MS);
			}),
		]);
		clearTimeout(timer);

		if (this.decoder !== decoder) return;
		if (!finished) {
			console.warn('[video] the decoder did not finish flushing; restarting it');
			this.reseed();
		}
		this.lastSubmitted = null;
	}

	public dispose() {
		try {
			this.decoder?.close();
		} catch { /* ignore */ }
		this.resolver?.resolve(null);
		this.decoder = null;
		this.lastSubmitted = null;
		this.resolver = null;
		this.inFlight.clear();
	}
}

/**
 * Dedicated, full-resolution video decoder for export.
 */
export class VideoExporter {
	public errored = false;
	public asset: VideoAsset;
	public initialized: Promise<void>;

	private input: Input | null = null;
	private canvasSink: CanvasSink | null = null;
	private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
	private currentCanvas: WrappedCanvas | null = null;
	private firstTimestamp: number = 0;

	public constructor(asset: VideoAsset) {
		this.asset = asset;
		this.initialized = this.initialize();
	}

	private async initialize() {
		try {
			this.input = new Input({ formats: ALL_FORMATS, source: await getAssetSource(this.asset) });
			const track = await this.input.getPrimaryVideoTrack();
			assert(track, 'Video track not found');
			// See VideoBuffer.initialize: clamp so an edit-list head trim (negative first
			// timestamp) doesn't offset every exported frame relative to the audio.
			this.firstTimestamp = Math.max(0, await track.getFirstTimestamp() ?? 0);
			this.canvasSink = new CanvasSink(track, { poolSize: 2 });
		} catch (e) {
			console.error('Error initializing video exporter', e);
			this.errored = true;
		}
	}

	public async seekTo(frame: number, frameRate: number): Promise<void> {
		await this.initialized;

		if (this.errored || !this.canvasSink) return;

		const targetFrame = Math.round((frame / frameRate) * this.asset.frameRate);
		const lastFrame = this.currentCanvas
			? this.secondsToFrames(this.currentCanvas.timestamp)
			: -1;

		if (targetFrame === lastFrame) return;

		if (!this.iterator || targetFrame < lastFrame) {
			this.iterator = this.canvasSink?.canvases(this.framesToSeconds(targetFrame)) ?? null;
		}
		if (!this.iterator) return;

		// Walk forward while the lookahead frame still starts at/before target.
		while (true) {
			const { value, done } = await this.iterator.next();
			if (done || !value) break;

			this.currentCanvas = value;

			if (this.secondsToFrames(value.timestamp) >= targetFrame) {
				break;
			}
		}
	}

	private framesToSeconds(frames: number) {
		return Math.max(this.firstTimestamp, (frames / this.asset.frameRate) + this.firstTimestamp);
	}

	private secondsToFrames(seconds: number) {
		return Math.max(0, Math.round((seconds - this.firstTimestamp) * this.asset.frameRate));
	}

	public toBitmap(): HTMLCanvasElement | OffscreenCanvas | null {
		if (!this.currentCanvas) {
			return null;
		}

		return this.currentCanvas.canvas;
	}

	public idle(): void { }

	public dispose(): void {
		this.iterator?.return();
		this.iterator = null;
		this.input?.dispose();
	}
}

/**
 * What a video paint decodes through. Three implementations of one interface
 * — `seekTo`, `toBitmap`, `idle`, `dispose` — picked by what the source turns
 * out to be and what the world is doing with it: a demuxed buffer for playing
 * a file, an exact-seeking reader for encoding one, and a frames directory
 * read off disk. Nothing downstream of `resolveVideoDecoder` asks which.
 */
export type VideoDecoderInstance = VideoBuffer | VideoExporter | SequenceDecoder;

const videoTrackCache = new Map<string, Promise<InputVideoTrack | null>>();

export function clearVideoTrackCache() {
	videoTrackCache.clear();
}

export function getVideoTrack(source: VideoAsset) {
	let promise = videoTrackCache.get(source.id);
	if (promise) {
		return promise;
	}

	promise = (async () => {
		try {
			const input = new Input({
				formats: ALL_FORMATS,
				source: await getAssetSource(source),
			});
			return await input.getPrimaryVideoTrack();
		} catch {
			videoTrackCache.delete(source.id);
			return null;
		}
	})();

	videoTrackCache.set(source.id, promise);
	return promise;
}

/**
 * The decoder `entity`'s video paint draws from, built on first use and kept
 * until the asset it was built for is no longer the one asked for.
 *
 * A sequence's rate is the element's to set, so it is pushed on every call
 * rather than fixed at construction — re-reading a folder to play it slower
 * would be a rebuild for nothing.
 */
export function resolveVideoDecoder(world: World, entity: Entity): VideoDecoderInstance | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	// Only a live preview keeps frames around it; an export reads each frame
	// once, in order, and a cache would be a window it never looks back into.
	const hasCache = world.get(Mode)?.value === 'realtime';

	// The id is the only thing that can go stale: a library edit assigns onto
	// the asset in place, so the object a live decoder holds is the library's.
	const existing = entity.get(VideoDecoderHandle);
	if (existing && existing.asset.id === assetId) {
		if (existing instanceof SequenceDecoder) {
			existing.hasCache = hasCache;
			existing.frameRate = getSequenceFrameRate(entity, existing.asset);
		}
		return existing;
	}

	// Asset changed — dispose old decoder and create a new one.
	existing?.dispose();

	const asset = getAsset(world, assetId);
	if (!asset) return null;

	let decoder: VideoDecoderInstance;
	if (asset.type === 'SEQUENCE') {
		decoder = new SequenceDecoder(asset, hasCache);
		decoder.frameRate = getSequenceFrameRate(entity, asset);
	} else if (asset.type === 'VIDEO') {
		decoder = hasCache ? new VideoBuffer(asset) : new VideoExporter(asset);
	} else {
		return null;
	}

	entity.add(VideoDecoderHandle);
	entity.set(VideoDecoderHandle, decoder);
	return decoder;
}

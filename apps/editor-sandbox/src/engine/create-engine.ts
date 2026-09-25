/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetSystem, renderSystem, transformSystem, playbackSystem, motionSystem, AudioEngine, createRuntimeWorld, Generating, Geometry, Mode, Paint, PaintType, Playback, RenderSurface, Time, ChildOf, store, syncInteractiveState } from '@posterract/video-runtime';
import { hudSystem } from './hud';
import { createSignal, type Accessor, type Setter } from 'solid-js';
import { AssetSelection, Hud, Keys, MODIFIER_KEYS, Pointer, PointerEvents, ProjectConfig, SnapLines } from './traits';
import { inputSystem } from './input/input-system';
import { clearClipFrames, clearClipPeaks, clearMedia, clearPeaks, timelineSystem, TimelineSurface } from './timeline';
import { shortcutSystem } from './input/shortcuts';
import { sourceErrorSystem } from './source-errors';
import { getDocumentEditor } from './editor';
import { ENGINE_WAKE_EVENT } from './wake';

import type { RuntimeWorld } from '@posterract/video-runtime';
import type { CanvasPointerEvent, PointerEventType } from '@posterract/video-runtime';

/**
 * How long the loop keeps drawing every frame after the last thing that could
 * have changed the picture: long enough for a seek's video frame to land and
 * the playhead's trail to settle.
 */
const LINGER_MS = 2_000;

/**
 * While nothing is happening, one frame this often, for whatever changes the
 * picture without a word to the loop: an image that finishes decoding, a file
 * that finishes loading.
 */
const HEARTBEAT_MS = 500;

/** Input anywhere in the window can change what the stage or the timeline shows. */
const WAKING_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'dragover', 'drop'];

export interface EngineOptions {
	/**
	 * Inject an existing AudioContext (e.g. shared across projects). When
	 * omitted, the engine creates and owns one; it is closed on dispose().
	 */
	audioContext?: AudioContext;
}

class Engine {
	readonly world: RuntimeWorld;

	private canvas: HTMLCanvasElement | null = null;
	private rafId: number | null = null;
	private lastTimestamp: number | null = null;
	private resizeObserver = new ResizeObserver(this.resize.bind(this));

	/**
	 * The loop draws only while something can be changing the picture, and
	 * sleeps otherwise (see `requestFrame`): an editor left open used to repaint
	 * the whole stage and timeline sixty times a second to show nothing new.
	 */
	private awakeUntil = 0;
	private heartbeat: ReturnType<typeof setTimeout> | null = null;
	private inFrame = false;
	private buttonsHeld = false;

	private readonly audioContext: AudioContext;
	private readonly ownsAudioContext: boolean;

	private unsubscribe: (() => void)[] = [];
	private interactiveDirty = true;

	public running: Accessor<boolean>;
	private setRunning: Setter<boolean>;

	/**
	 * Ticks once per frame, after the systems ran. The one signal derived
	 * state is sampled against (see `useDerived`); a plain Solid signal, so
	 * following the tick costs no koota subscription.
	 */
	public frame: Accessor<number>;
	private setFrame: Setter<number>;

	public constructor(projectId: string, options: EngineOptions = {}) {
		this.world = createRuntimeWorld(projectId);
		this.world.add(Pointer, Keys, SnapLines, Hud, PointerEvents, AssetSelection, ProjectConfig, TimelineSurface);

		[this.running, this.setRunning] = createSignal(false);
		[this.frame, this.setFrame] = createSignal(0);

		this.unsubscribe.push(
			// Elements arriving or leaving — a mount, an insert, a delete — whoever did it.
			this.world.onAdd(ChildOf('*'), () => {
				this.interactiveDirty = true;
				this.requestFrame();
			}),
			this.world.onRemove(ChildOf('*'), () => {
				this.interactiveDirty = true;
				this.requestFrame();
			}),
			// The timeline keeps a clip's waveform and thumbnails by entity id,
			// and koota hands ids back out: a clip that is gone has to take its
			// pictures with it, or the next clip to be given its id inherits them.
			this.world.onRemove(Geometry, (entity) => {
				clearClipPeaks(entity.id());
				clearClipFrames(entity.id());
			}),
			// Every edit, whoever makes it (the canvas, an agent, the voice bar,
			// the file changing underneath), and every change of view (selection,
			// the active scene, the camera) comes through the one funnel.
			getDocumentEditor(this.world).onEdit(this.wake),
		);

		this.ownsAudioContext = options.audioContext === undefined;
		this.audioContext = options.audioContext ?? new AudioContext({ latencyHint: 'playback' });
		this.world.set(AudioEngine, { context: this.audioContext });
	}

	private readonly onClick = (event: MouseEvent) => {
		this.addEvent('click', event);
	}

	private readonly onDoubleClick = (event: MouseEvent) => {
		this.addEvent('dblclick', event)
	}

	private readonly onPointerDown = (event: PointerEvent) => {
		this.addEvent('pointerdown', event)
	}

	private readonly onPointerMove = (event: PointerEvent) => {
		this.addEvent('pointermove', event)
	}

	private readonly onPointerUp = (event: PointerEvent) => {
		this.addEvent('pointerup', event)
	}

	/**
	 * Whether the pointer is on the stage, which a shortcut reads to tell a
	 * press that could start a canvas gesture from one that could not.
	 */
	private readonly onPointerEnter = () => {
		this.world.set(Pointer, { over: true });
	}

	private readonly onPointerLeave = () => {
		this.world.set(Pointer, { over: false });
	}

	private readonly onBlur = () => {
		// Key-up never arrives when focus leaves mid-hold (⌘-tab, devtools).
		this.world.get(Keys)!.held.clear();
		this.buttonsHeld = false;
		this.requestFrame();
	}

	private readonly wake = () => this.requestFrame();

	private readonly onWindowInput = (event: Event) => {
		if (event instanceof PointerEvent) this.buttonsHeld = event.buttons !== 0;
		this.requestFrame();
	}

	/**
	 * Only records: what a press does is decided once a frame by the shortcut
	 * system. Presses in text fields belong to the field. The one thing
	 * decided here is whether the browser gets the event, since that cannot
	 * wait for the frame — backspace would have navigated by then.
	 */
	private readonly onKeyDown = (event: KeyboardEvent) => {
		if (
			event.defaultPrevented
			// Floating controls own their keyboard input: Tab must move focus,
			// and closing a popup with Escape must not clear canvas selection.
			|| (event.target instanceof HTMLElement && event.target.closest(
				'[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-slot="select-content"]',
			))
			|| event.target instanceof HTMLInputElement
			|| event.target instanceof HTMLTextAreaElement
			|| (event.target instanceof HTMLElement && event.target.isContentEditable)
		) return;

		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.add(key);
		if (isMod) keys.held.add('mod');
		if (!event.repeat) {
			keys.pressed.add(key);
			if (isMod) keys.pressed.add('mod');
		}

		event.preventDefault();
	}

	private readonly onKeyUp = (event: KeyboardEvent) => {
		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.delete(key);
		keys.lifted.add(key);

		if (!isMod) return;

		keys.held.delete('mod');
		keys.lifted.add('mod');

		for (const stale of [...keys.held]) {
			// macOS never delivers the key-up of a key released while ⌘ is held
			if (!MODIFIER_KEYS.has(stale)) keys.held.delete(stale);
		}
	};

	private readonly loop = (timestamp: number): void => {
		this.rafId = null;
		this.inFrame = true;

		try {
			const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
			this.lastTimestamp = timestamp;
			this.world.set(Time, { now: timestamp, delta });

			if (this.interactiveDirty) {
				syncInteractiveState(this.world);
				this.interactiveDirty = false;
			}

			this.runSystems();
			this.setFrame((count) => count + 1);

			const keys = this.world.get(Keys);
			keys?.pressed.clear();
			keys?.lifted.clear();
		} finally {
			this.inFrame = false;
		}

		if (!this.running()) return;
		if (this.isAnimating()) {
			this.awakeUntil = Math.max(this.awakeUntil, performance.now() + LINGER_MS);
		}

		if (performance.now() < this.awakeUntil) {
			this.rafId = requestAnimationFrame(this.loop);
		} else {
			this.sleep();
		}
	}

	/**
	 * Keeps the loop drawing every frame for a while, waking it if it had gone
	 * idle. Input anywhere in the window, an edit, an element arriving or leaving
	 * and a CLI request (see `./wake`) all call it; so may anything else that
	 * changes the picture while nothing is moving.
	 */
	public requestFrame(): void {
		this.awakeUntil = Math.max(this.awakeUntil, performance.now() + LINGER_MS);
		// Mid-frame, the frame itself decides whether another follows.
		if (this.inFrame || this.rafId !== null || !this.running()) return;

		this.clearHeartbeat();
		this.rafId = requestAnimationFrame(this.loop);
	}

	/**
	 * Whether the picture keeps changing with nothing else happening, so the
	 * next frame has to be drawn regardless.
	 */
	private isAnimating(): boolean {
		for (const scene of this.world.query(Playback)) {
			if (scene.get(Playback)?.playing) return true;
		}

		// A held button drags, scrubs or scrolls at the edges without moving, and a
		// held key acts by being held (space turns into the hand after a delay).
		if (this.buttonsHeld || (this.world.get(Keys)?.held.size ?? 0) > 0) return true;

		// An element being generated pulses on the world's clock.
		if (this.world.queryFirst(Generating)) return true;

		// Web content and canvases a project draws itself change without a word.
		const paints = store(this.world, Paint).value;
		for (const fill of this.world.query(Paint)) {
			const paint = paints[fill.id()];
			if (paint === PaintType.HTML || paint === PaintType.SURFACE) return true;
		}

		return false;
	}

	/**
	 * Nothing is moving and nothing has changed: stop drawing until something
	 * does. The frame that wakes it starts from a standstill, so it must not move
	 * the playhead on by however long the loop slept.
	 */
	private sleep(): void {
		this.lastTimestamp = null;
		this.clearHeartbeat();
		this.heartbeat = setTimeout(() => {
			this.heartbeat = null;
			if (this.running() && this.rafId === null) this.rafId = requestAnimationFrame(this.loop);
		}, HEARTBEAT_MS);
	}

	private clearHeartbeat(): void {
		if (this.heartbeat === null) return;
		clearTimeout(this.heartbeat);
		this.heartbeat = null;
	}

	private resize(): void {
		const parent = this.canvas?.parentElement;
		if (!parent || !this.canvas) return;

		const { width, height } = parent.getBoundingClientRect();
		const dpr = window.devicePixelRatio;

		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);

		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth;
			this.canvas.height = pixelHeight;
		}
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;

		this.world.set(RenderSurface, { resolution: dpr });

		this.runSystems();
		this.requestFrame();
	}

	private addEvent(type: PointerEventType, event: PointerEvent | MouseEvent): void {
		if (!this.canvas) return;
		const rect = this.canvas.getBoundingClientRect();
		const resolution = this.world.get(RenderSurface)?.resolution ?? 1;

		this.world.get(PointerEvents)?.queue.push({
			type,
			clientX: (event.clientX - rect.left) * resolution,
			clientY: (event.clientY - rect.top) * resolution,
			button: event.button,
		} as CanvasPointerEvent);
	};

	private runSystems(): void {
		inputSystem(this.world);
		shortcutSystem(this.world);
		assetSystem(this.world);
		sourceErrorSystem(this.world);
		playbackSystem(this.world);
		motionSystem(this.world);
		transformSystem(this.world);
		renderSystem(this.world);
		hudSystem(this.world);
		timelineSystem(this.world);
	}

	public start(): void {
		if (this.running()) return;
		this.setRunning(true);
		this.lastTimestamp = null;
		this.requestFrame();
	}

	public stop(): void {
		this.setRunning(false);
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.clearHeartbeat();
	}

	public mount(canvas: HTMLCanvasElement): void {
		this.unsubscribeEventListeners();

		this.canvas = canvas;
		this.world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d') });

		canvas.addEventListener('click', this.onClick);
		canvas.addEventListener('dblclick', this.onDoubleClick);
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerenter', this.onPointerEnter);
		canvas.addEventListener('pointerleave', this.onPointerLeave);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointercancel', this.onPointerUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);

		// Captured on the window, so input to any panel wakes the loop before the
		// panel acts on it: a slider dragged in the inspector moves the stage live.
		for (const type of WAKING_EVENTS) {
			window.addEventListener(type, this.onWindowInput, { capture: true, passive: true });
		}
		window.addEventListener(ENGINE_WAKE_EVENT, this.wake);
		window.addEventListener('focus', this.wake);
		document.addEventListener('visibilitychange', this.wake);

		this.resizeObserver.observe(canvas.parentElement!);
		this.requestFrame();
	}

	public snapshot(): Promise<Blob | null> {
		const canvas = this.canvas;
		if (!canvas?.width || !canvas.height) return Promise.resolve(null);

		const mode = this.world.get(Mode)?.value ?? 'realtime';
		this.world.set(Mode, { value: 'offline-video' });
		renderSystem(this.world);

		const encoded = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

		this.world.set(Mode, { value: mode });
		renderSystem(this.world);
		hudSystem(this.world);

		return encoded;
	}

	public dispose(): void {
		this.stop();
		if (this.ownsAudioContext) {
			this.audioContext.close();
		}

		// The timeline's decoded pictures and peaks are of this project's
		// files, and are held outside the world: they go with the engine.
		clearPeaks();
		clearMedia();

		this.unsubscribeEventListeners();
		this.unsubscribe.forEach(unsubscribe => unsubscribe());
		this.unsubscribe.length = 0;
		this.world.get(PointerEvents)?.queue.splice(0);
		this.world.destroy();
	}

	private unsubscribeEventListeners(): void {
		this.canvas?.removeEventListener('click', this.onClick);
		this.canvas?.removeEventListener('dblclick', this.onDoubleClick);
		this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas?.removeEventListener('pointermove', this.onPointerMove);
		this.canvas?.removeEventListener('pointerenter', this.onPointerEnter);
		this.canvas?.removeEventListener('pointerleave', this.onPointerLeave);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointercancel', this.onPointerUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		for (const type of WAKING_EVENTS) {
			window.removeEventListener(type, this.onWindowInput, { capture: true });
		}
		window.removeEventListener(ENGINE_WAKE_EVENT, this.wake);
		window.removeEventListener('focus', this.wake);
		document.removeEventListener('visibilitychange', this.wake);
		this.resizeObserver.disconnect();
	}
}

export function createEngine(projectId: string, options: EngineOptions = {}): Engine {
	return new Engine(projectId, options);
}

export type { Engine };

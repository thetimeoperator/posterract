/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Lottie playback, through Skia's Skottie.
 *
 * Lottie brings bezier paths, trim-path draw-on, morphing, mattes and precomps
 * that Posterract would otherwise have to grow a vector engine to get. The
 * whole integration rests on one rule: the animation is **seeked**, never
 * played. Skottie has a `seek(t)` that takes normalized progress, so the frame
 * drawn is a pure function of composition time — which is what keeps preview
 * and export identical, and what makes scrubbing frame-accurate.
 *
 * CanvasKit is loaded once per process, lazily, from the app's own assets (the
 * renderer's CSP allows no network).
 */

/** Minimal shapes of the CanvasKit surface this file uses. */
type SkCanvas = { clear(color: number): void };
type SkImageInfo = {
  width: number;
  height: number;
  colorType: unknown;
  alphaType: unknown;
  colorSpace: unknown;
};
type SkImage = {
  readPixels(x: number, y: number, info: SkImageInfo): Uint8Array | null;
  delete(): void;
};
type SkSurface = {
  getCanvas(): SkCanvas;
  makeImageSnapshot(): SkImage | null;
  flush(): void;
  delete(): void;
};

type SkCanvasElement = HTMLCanvasElement;
/** What a Lottie file says it exposes for editing, by family. */
type SkSlotInfo = {
  colorSlotIDs: string[];
  scalarSlotIDs: string[];
  vec2SlotIDs: string[];
  textSlotIDs: string[];
  imageSlotIDs: string[];
};
type SkottieAnimation = {
  duration(): number;
  size(): { w: number; h: number };
  seek(progress: number): void;
  render(canvas: SkCanvas, rect: number[]): void;
  delete(): void;
  // Present only on managed animations; every one of these is guarded.
  getSlotInfo?(): SkSlotInfo;
  setColorSlot?(name: string, color: Float32Array): boolean;
  setScalarSlot?(name: string, value: number): boolean;
  getTextSlot?(name: string): Record<string, unknown> | null;
  setTextSlot?(name: string, value: Record<string, unknown>): boolean;
};
type CanvasKitModule = {
  MakeSurface(width: number, height: number): SkSurface | null;
  ColorType: { RGBA_8888: unknown };
  AlphaType: { Unpremul: unknown };
  ColorSpace: { SRGB: unknown };
  MakeManagedAnimation?(json: string, assets?: unknown, prop?: string): SkottieAnimation | null;
  Color4f(r: number, g: number, b: number, a: number): Float32Array;
  MakeAnimation(json: string): SkottieAnimation | null;
  XYWHRect(x: number, y: number, width: number, height: number): number[];
  TRANSPARENT: number;
};

type CanvasKitInit = (options: { locateFile: (file: string) => string }) => Promise<CanvasKitModule>;

/**
 * Where the copy script stages CanvasKit.
 *
 * Resolved against the document's own base rather than the site root: the
 * desktop app serves the editor from `posterract-app://app/editor-sandbox/`,
 * so an absolute `/canvaskit/` would miss it entirely.
 */
function canvasKitUrl(file: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`canvaskit/${file}`, base).toString();
}

let canvasKit: Promise<CanvasKitModule> | null = null;

/**
 * Load CanvasKit once, lazily.
 *
 * `canvaskit.js` is Emscripten's UMD glue, not an ES module, so it is injected
 * as a classic script and read off the global it defines — `import()` rejects
 * it. Loading it lazily keeps 7 MB of WebAssembly out of every project that
 * never touches Lottie.
 */
export function loadCanvasKit(): Promise<CanvasKitModule> {
  if (canvasKit) return canvasKit;
  canvasKit = new Promise<CanvasKitInit>((resolve, reject) => {
    const existing = (globalThis as { CanvasKitInit?: CanvasKitInit }).CanvasKitInit;
    if (existing) return resolve(existing);

    const script = document.createElement('script');
    script.src = canvasKitUrl('canvaskit.js');
    script.onload = () => {
      const init = (globalThis as { CanvasKitInit?: CanvasKitInit }).CanvasKitInit;
      if (init) resolve(init);
      else reject(new Error('CanvasKit loaded but defined no initializer'));
    };
    script.onerror = () => reject(new Error('CanvasKit could not be loaded from the app'));
    document.head.append(script);
  }).then((init) => init({ locateFile: canvasKitUrl }));
  return canvasKit;
}

/**
 * A slot as the composition holds it: a number that is either a scalar or a
 * packed colour, plus the string a text slot carries instead.
 */
export interface LottieSlotValue {
  readonly name: string;
  readonly value: number;
  readonly text: string;
  readonly isColor: boolean;
}

/**
 * One animation, drawn to an offscreen canvas the compositor can paint like
 * any other image source.
 */
export class LottiePlayer {
  // A real canvas element, not an OffscreenCanvas: CanvasKit's software
  // surface writes through a 2D context it takes from this element, and only
  // an element gives it one. It is never attached to the document — it exists
  // purely as the buffer the compositor then draws from.
  private readonly canvas: SkCanvasElement;
  private surface: SkSurface | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private animation: SkottieAnimation | null = null;
  private kit: CanvasKitModule | null = null;
  private disposed = false;

  /** Slot families the loaded file declares, empty until it loads. */
  private slots: SkSlotInfo | null = null;
  /** The last value written per slot, so a still frame does no work. */
  private readonly applied = new Map<string, string>();

  /** Resolves once the animation can be drawn; awaited through `hold()`. */
  public readonly ready: Promise<void>;

  public constructor(json: string, width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(width));
    this.canvas.height = Math.max(1, Math.round(height));
    this.ready = this.init(json);
  }

  private async init(json: string): Promise<void> {
    const kit = await loadCanvasKit();
    if (this.disposed) return;
    this.kit = kit;
    // The managed variant is what supports slots; fall back for older builds
    // rather than refusing to render the animation at all.
    this.animation = kit.MakeManagedAnimation?.(json) ?? kit.MakeAnimation(json);
    if (!this.animation) throw new Error('That file is not a Lottie animation Skottie can read');

    // A raster surface Skia owns outright, rather than one wrapped around a
    // DOM canvas: the wrapped kind depends on CanvasKit's own canvas plumbing
    // to make its pixels visible, and reading the buffer back ourselves is
    // both explicit and the same in every environment the renderer runs in —
    // including the offline world an export builds.
    this.surface = kit.MakeSurface(this.canvas.width, this.canvas.height);
    if (!this.surface) throw new Error('CanvasKit could not create a drawing surface');
    this.context = this.canvas.getContext('2d');
    if (!this.context) throw new Error('The Lottie buffer has no 2D context');
    this.slots = this.animation.getSlotInfo?.() ?? null;
  }

  /** The slot names this animation exposes, for the inspector and the agent. */
  public slotNames(): string[] {
    const info = this.slots;
    if (!info) return [];
    return [...info.colorSlotIDs, ...info.scalarSlotIDs, ...info.textSlotIDs];
  }

  /**
   * Push a slot's current value into the animation.
   *
   * Which setter applies is taken from the file's own slot table when Skottie
   * reports one, and from how the value was authored otherwise — a colour was
   * written as a colour. Repeat writes of an unchanged value are skipped so a
   * held frame costs nothing.
   */
  public applySlot(slot: LottieSlotValue): void {
    const { animation, kit } = this;
    if (!animation || !kit || !slot.name) return;

    const info = this.slots;
    const kind = info
      ? info.colorSlotIDs.includes(slot.name)
        ? 'color'
        : info.textSlotIDs.includes(slot.name)
          ? 'text'
          : info.scalarSlotIDs.includes(slot.name)
            ? 'scalar'
            : null
      : slot.text
        ? 'text'
        : slot.isColor
          ? 'color'
          : 'scalar';
    if (!kind) return;

    const signature = kind === 'text' ? `t:${slot.text}` : `${kind}:${slot.value}`;
    if (this.applied.get(slot.name) === signature) return;
    this.applied.set(slot.name, signature);

    if (kind === 'color') {
      // Colours are packed 24-bit RGB here — transparency is the element's
      // own `opacity`, never part of the colour — so the slot is always
      // written fully opaque and fades with the element around it.
      const packed = slot.value >>> 0;
      animation.setColorSlot?.(
        slot.name,
        kit.Color4f(((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255, 1),
      );
      return;
    }

    if (kind === 'scalar') {
      animation.setScalarSlot?.(slot.name, slot.value);
      return;
    }

    // Text slots carry a whole descriptor (font, size, alignment); only the
    // string is ours to change, so the rest is read back and passed through.
    const current = animation.getTextSlot?.(slot.name);
    if (!current) return;
    animation.setTextSlot?.(slot.name, { ...current, text: slot.text });
  }

  /** The animation's own length in seconds, or 0 before it loads. */
  public duration(): number {
    return this.animation?.duration() ?? 0;
  }

  public get width(): number {
    return this.canvas.width;
  }

  public get height(): number {
    return this.canvas.height;
  }

  /**
   * Draw the frame at `seconds` of the animation's own clock.
   *
   * Seeking by normalized progress is what makes this deterministic: the same
   * time always produces the same pixels, in preview and in export, however
   * long the frame took to arrive.
   */
  public drawAt(seconds: number, loop: boolean): SkCanvasElement | null {
    const { animation, surface, kit } = this;
    if (!animation || !surface || !kit) return null;

    const duration = animation.duration();
    if (duration <= 0) return null;
    const local = loop
      ? ((seconds % duration) + duration) % duration
      : Math.min(Math.max(seconds, 0), duration);

    animation.seek(local / duration);
    const canvas = surface.getCanvas();
    canvas.clear(kit.TRANSPARENT);
    animation.render(canvas, kit.XYWHRect(0, 0, this.canvas.width, this.canvas.height));
    surface.flush();

    // Copy Skia's buffer onto the element the compositor draws from. Unpremul
    // because that is what `ImageData` expects; premultiplied bytes would show
    // as dark fringing on every soft edge.
    const snapshot = surface.makeImageSnapshot();
    if (!snapshot) return null;
    const pixels = snapshot.readPixels(0, 0, {
      width: this.canvas.width,
      height: this.canvas.height,
      colorType: kit.ColorType.RGBA_8888,
      alphaType: kit.AlphaType.Unpremul,
      colorSpace: kit.ColorSpace.SRGB,
    });
    snapshot.delete();
    if (!pixels || !this.context) return null;

    // Copied rather than viewed: Skia's buffer may be backed by Wasm memory
    // that moves when it grows, and `ImageData` must own bytes that will not.
    const bytes = new Uint8ClampedArray(pixels.length);
    bytes.set(pixels);
    this.context.putImageData(new ImageData(bytes, this.canvas.width, this.canvas.height), 0, 0);
    return this.canvas;
  }

  public dispose(): void {
    this.disposed = true;
    this.animation?.delete();
    this.animation = null;
    this.surface?.delete();
    this.surface = null;
  }
}

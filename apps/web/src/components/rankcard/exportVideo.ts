/**
 * A card's animation as an MP4 a Reel can be posted from: drawn frame by
 * frame onto a canvas and encoded in the browser (H.264, plus AAC sound where
 * the browser can encode it). Faster than real time, and every frame lands.
 */

export type DrawFrame = (ctx: CanvasRenderingContext2D, seconds: number) => void;

export async function encodeCardVideo({
  width,
  height,
  fps = 30,
  duration,
  draw,
  sound,
  onProgress,
}: {
  width: number;
  height: number;
  fps?: number;
  duration: number;
  draw: DrawFrame;
  /** The soundtrack, rendered offline; left out where the browser can't encode audio. */
  sound?: () => Promise<AudioBuffer>;
  onProgress?: (fraction: number) => void;
}): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH, canEncodeVideo, canEncodeAudio } =
    await import("mediabunny");
  if (!(await canEncodeVideo("avc", { width, height }))) {
    throw new Error("This browser can't make the video. Chrome, Safari or Edge can.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No canvas to draw the card on.");

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(canvas, { codec: "avc", quality: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = sound && (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }))
    ? new AudioBufferSource({ codec: "aac", quality: QUALITY_HIGH })
    : undefined;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const frames = Math.round(duration * fps);
  for (let index = 0; index < frames; index += 1) {
    draw(ctx, index / fps);
    await video.add(index / fps, 1 / fps);
    onProgress?.((index + 1) / frames);
  }
  if (audio && sound) await audio.add(await sound());
  await output.finalize();
  if (!target.buffer) throw new Error("The video came out empty.");
  return new Blob([target.buffer], { type: "video/mp4" });
}

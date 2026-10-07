import { renderCardSound } from "./cardSound";
import { drawStageFrame, makeTextures, STAGE_H, STAGE_SOUND, STAGE_W, VIDEO_SECONDS, type CardAssets } from "./drawCard";
import { encodeCardVideo } from "./exportVideo";
import { tierOf, type CardModel } from "./cardModel";

/** The moment the card has landed and everything has counted up: the saved image. */
const SETTLED_AT = 2.3;

/** The card's Reel: 1080×1920, six seconds, the card turning over and landing. */
export function cardVideo(model: CardModel, assets: CardAssets, onProgress?: (fraction: number) => void) {
  const textures = makeTextures(model);
  return encodeCardVideo({
    width: STAGE_W,
    height: STAGE_H,
    fps: 30,
    duration: VIDEO_SECONDS,
    draw: (ctx, seconds) => drawStageFrame(ctx, model, assets, textures, seconds),
    sound: () => renderCardSound(VIDEO_SECONDS, STAGE_SOUND),
    onProgress,
  });
}

/** The card as a 9:16 picture, for a story. */
export function cardImage(model: CardModel, assets: CardAssets): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  drawStageFrame(canvas.getContext("2d")!, model, assets, makeTextures(model), SETTLED_AT);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture came out empty."))), "image/png"),
  );
}

/** posterract-silver-corporal.mp4, posterract-video-what-makes-ufos-glow.png… */
export function cardFileName(model: CardModel, extension: "mp4" | "png") {
  const words = model.kind === "rank" ? tierOf(model.level).rank.label : `video ${model.post?.title ?? ""}`.split(/\s+/).slice(0, 6).join(" ");
  const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `posterract-${slug || "rank-card"}.${extension}`;
}

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { RankEmblem } from "@/components/points/RankEmblem";

/**
 * A rank's emblem as an image a canvas can draw: the same RankEmblem the
 * Points page shows, rendered once off screen and turned into an SVG image,
 * so the card and the app never draw two different emblems.
 */
const cache = new Map<string, Promise<HTMLImageElement>>();

export function emblemImage(level: number, { glow = false }: { glow?: boolean } = {}): Promise<HTMLImageElement> {
  const key = `${level}:${glow}`;
  let image = cache.get(key);
  if (!image) {
    image = load(level, glow);
    cache.set(key, image);
    image.catch(() => cache.delete(key));
  }
  return image;
}

async function load(level: number, glow: boolean) {
  // Out of whatever React is rendering now: flushSync can't run inside an effect.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<RankEmblem level={level} size={1024} glow={glow} />));
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("The emblem didn't render.");
  svg.removeAttribute("class");
  const markup = new XMLSerializer().serializeToString(svg);
  root.unmount();
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  return image;
}

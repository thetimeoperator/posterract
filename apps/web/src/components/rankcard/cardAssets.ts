import { useEffect, useState } from "react";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import type { CardImagesDTO } from "@posterract/contract";
import { emblemImage } from "./emblemImage";
import { loadCardFonts, type CardAssets } from "./drawCard";
import type { CardModel } from "./cardModel";

/** Pictures by URL, decoded once: data URLs from the API and the app's own files. */
const images = new Map<string, Promise<HTMLImageElement | undefined>>();

export function loadImage(src: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!src) return Promise.resolve(undefined);
  let image = images.get(src);
  if (!image) {
    image = new Promise((resolve) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => resolve(undefined);
      element.src = src;
    });
    images.set(src, image);
  }
  return image;
}

let fonts: Promise<void> | undefined;

/** Everything one card draws with: the fonts, its emblem, the avatar, its post's cover and platform mark. */
export async function cardAssets(model: CardModel, pictures: CardImagesDTO | undefined): Promise<CardAssets> {
  fonts ??= loadCardFonts().catch(() => undefined);
  const provider = model.post?.provider;
  const [emblem, avatar, cover, platform] = await Promise.all([
    emblemImage(model.level),
    loadImage(pictures?.avatar),
    loadImage(model.post ? pictures?.covers[model.post.key] : undefined),
    loadImage(provider ? PLATFORM_MARK_SOURCES[provider] : undefined),
    fonts,
  ]);
  return { emblem, avatar, cover, platform };
}

/** A card's assets, once they're ready. */
export function useCardAssets(model: CardModel | undefined, pictures: CardImagesDTO | undefined) {
  const [assets, setAssets] = useState<{ id: string; assets: CardAssets }>();
  useEffect(() => {
    if (!model) return;
    let live = true;
    void cardAssets(model, pictures).then((loaded) => {
      if (live) setAssets({ id: model.id, assets: loaded });
    });
    return () => {
      live = false;
    };
  }, [model, pictures]);
  return model && assets?.id === model.id ? assets.assets : undefined;
}

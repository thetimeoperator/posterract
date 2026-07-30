import type { CSSProperties } from "react";
import { PLATFORM_CAPABILITIES, type PlatformId } from "@posterract/contract";
import { YOUTUBE_ICON_DATA_URI } from "@posterract/hyperkit";

const PLATFORM_MARKS: Record<PlatformId, string> = {
  instagram: "/brand/platforms/instagram.svg",
  tiktok: "/brand/platforms/tiktok.svg",
  youtube: YOUTUBE_ICON_DATA_URI,
  x: "/brand/platforms/x.svg",
  threads: "/brand/platforms/threads.svg",
  facebook: "/brand/platforms/facebook.svg",
};

export function PlatformBrandMark({
  platform,
  height = 24,
  className,
}: {
  platform: PlatformId;
  height?: number;
  className?: string;
}) {
  const style: CSSProperties = {
    display: "block",
    width: "auto",
    height,
    maxWidth: platform === "youtube" ? Math.round((height * 98) / 68) : height,
    objectFit: "contain",
  };

  return (
    <img
      src={PLATFORM_MARKS[platform]}
      alt={`${PLATFORM_CAPABILITIES[platform].label} logo`}
      draggable={false}
      className={className}
      style={style}
    />
  );
}

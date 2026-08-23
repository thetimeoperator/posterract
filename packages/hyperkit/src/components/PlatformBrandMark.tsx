import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import {
  PLATFORM_MARK_SOURCES,
  type PlatformBrandId,
} from "./PlatformRune";

export { PLATFORM_MARK_SOURCES } from "./PlatformRune";

export type PlatformBrandMarkProps = {
  platform: PlatformBrandId;
  height?: number;
  className?: string;
  decorative?: boolean;
};

/** Render unmodified official platform artwork at its intrinsic aspect ratio. */
export function PlatformBrandMark({
  platform,
  height = 24,
  className,
  decorative = false,
}: PlatformBrandMarkProps) {
  const renderedHeight = platform === "youtube" ? Math.max(20, height) : height;
  const renderedWidth =
    platform === "youtube" ? (renderedHeight * 98) / 68 : undefined;
  const label =
    platform === "linkedin"
      ? "LinkedIn"
      : platform === "reddit"
        ? "Reddit"
        : PLATFORM_CAPABILITIES[platform].label;

  return (
    <img
      src={PLATFORM_MARK_SOURCES[platform]}
      alt={decorative ? "" : `${label} logo`}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={className}
      width={renderedWidth}
      height={renderedHeight}
      style={{
        display: "block",
        width: renderedWidth ?? "auto",
        height: renderedHeight,
        objectFit: "contain",
      }}
    />
  );
}

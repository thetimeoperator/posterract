import type { SVGProps } from "react";
import type { PlatformId } from "@posterract/contract";

/**
 * Platform runes — minimal stroke glyphs for the six dimensions.
 * Drawn as thin "runic" strokes in currentColor so they inherit
 * platform accents from their container.
 */

type RuneProps = SVGProps<SVGSVGElement> & { size?: number };

function runeProps({ size = 16, ...rest }: RuneProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export function InstagramRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TikTokRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <path d="M13.5 4v10.8a3.6 3.6 0 1 1-3.6-3.6" />
      <path d="M13.5 6.2c.7 2.2 2.5 3.8 5 4" />
    </svg>
  );
}

export function FacebookRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <path d="M14.8 4.5h-2.3a3.4 3.4 0 0 0-3.4 3.4v2.6H6.8v3.4h2.3v6h3.5v-6h2.6l.6-3.4h-3.2V8.2c0-.5.4-.9.9-.9h2.3z" />
    </svg>
  );
}

export function ThreadsRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <path d="M12.2 11.2c2.6 0 4.6 1.2 4.6 3.4 0 2.4-2 4.4-5 4.4-3.8 0-6.3-2.7-6.3-7s2.5-7 6.3-7c2.9 0 4.9 1.5 5.7 3.8" />
      <path d="M9.4 14.8c0-1.3 1.2-2.2 2.8-2.2 1.7 0 2.9.6 2.9 2" />
    </svg>
  );
}

export function XRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <path d="M5 4.5l13.6 15M18.8 4.5L5.2 19.5" />
    </svg>
  );
}

export function YouTubeRune(props: RuneProps) {
  return (
    <svg {...runeProps(props)}>
      <rect x="3" y="6" width="18" height="12.5" rx="3.5" />
      <path d="M10.2 9.6l4.4 2.6-4.4 2.6z" />
    </svg>
  );
}

const RUNES: Record<PlatformId, (props: RuneProps) => ReturnType<typeof InstagramRune>> = {
  instagram: InstagramRune,
  tiktok: TikTokRune,
  facebook: FacebookRune,
  threads: ThreadsRune,
  x: XRune,
  youtube: YouTubeRune,
};

export function PlatformRune({
  platform,
  ...props
}: RuneProps & { platform: PlatformId }) {
  const Rune = RUNES[platform];
  return <Rune {...props} />;
}

import type { SVGProps } from "react";
import type { PlatformId } from "@posterract/contract";

/**
 * Platform symbols for the six publishing destinations.
 *
 * Most platforms use Posterract's compact runes. YouTube is deliberately
 * different: its mark must remain the official, unmodified red-and-white
 * artwork and must never render below 20px. Compact YouTube placements use
 * the plain word "YouTube" instead of an undersized or altered logo.
 */

type RuneProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Exact red-and-white YouTube icon artwork published by Google on the
 * YouTube API Services branding-guidelines page. The original 2x sprite is:
 * https://developers.google.com/static/youtube/images/youtube-icons-2x.png
 */
export const YOUTUBE_ICON_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGIAAABECAYAAAB6UOAlAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAYqADAAQAAAABAAAARAAAAABJTkZNAAAEdUlEQVR4Ae1c7VHjMBBVGP5fOsBUgDsgVHApIXQAFZBUAFSQdABXAaYC0kFMBZerIPdeYmlkx/GExB+SvDss+rQkv6fdVQzxQNUgG6WGGCa2hmKedVp+IWO363qmxb52Wxv5JSZZH5jos1CfokylrAdK8dpaBGMdJxbYI1xxAx1C4yxF0mshIWso029oUidJGE8pEDCCvkE3oj/C4C/wmkKHWyBP/cUBoELA+RuQhDycxAMujKErqFhBfRjMq8jYixEkARd8QM8zqapZ+9u2AOD3Zbd/UVJJ5oSEEmBqqJpgo5e6qRwR6DTFZLQIkeYQeALOUXF445rQSCtYQcUaiijVX95zUbZFjIWE+hE/MOI42/im2Sbit6mVTNMI0OuM7ElsInINdifJN4LArT3qlgiYSYxKiQ02Ms3nibkRbRGRqZFMWwiUEpGrbGslPZ+Hj5CMF9IWcdVzULq6fWMAmoioq5X0fN49ixAiutkRYhHd4H54Vu2aDvfoqmU6VWo+Rzgz1tvVSpqc91YPfoHIbcxDVzqTTiZ4+rXCo8ipM0tqaiG0CLe3HC3i6WlHyHjcFA6dj+uuaypCE0X4w+0b/mT1gYfIyIchxhv5Q4QGfjTaWcfzcwjxw3gjEoE781AeHnaEMA1A/LMIG3TGD1oGAzotxWPxmwgNPGMGYwdjiKfxIwwiNCE8VenjriefPzZZaAiLCE2IPu7yc4gnEiYRBJ8WwU/mX19exA8SceXJpjltmXG8ix8kxeH4QSKi0+7Qs6vopmgdfFziYPwI1zWV7RMSwPhBQhx7XNIvIjQ5dFE86jr0MPFSr61XaZoq9fio1Pu7M7fdLyLWa6VeX52yBL0TSAS2Rw9ksdhZAclwUBgjvh1cV31LShKl7u7wrYR7fMvNTRJ4s+G6JsaB2UwpWoIHEh4ROg68vDhtAdbe2JppWETwFMTTEK3BExlk39UOg4jlckcA44Gn4jcRdEO0AE/iQNUe4akpqergbBsD8fV1ECQQY/8sgu6HR1GP4kDFZt4Gar+IIPAkwOM4UEIIgttO6JoMK7rSqVTHAbqhsEjIwXw5wPFpk6tyqOD4Y4k6kQIPeNnE9qfOYWWsIxGYgYAp++q/R6QsiHSHgBDRHfacOResWZHyl0jrCJiDkraI79aXIBMSgT2LMBWCT2sI8OWMexYhRLSGv5koh/nWNYGZFM2GHdNVMk0i8GkPrmME6xK7QfKNI7BvEdmUfxqfWibQCDA+vOsCU9si2CDuyUanuXyOBE5jiMgiOP7pR6RhBLjZZ8U5gH9e8NwJ/xjq8Hev88v1sfQI0F+KCy8jIkInkjEsdpby2QgsAPh92SjGNelGdEyRv4MyFakPgYMkVE4BF8UXO8m7wc9/JTXfDT6pBPuYRgzCt+XPofKe8J9hsAJmR78tH57oeCEp6E29gkaWIttrSbK7/0SaQpcAdpnVHZX8iIiqEUFSjHYd4CPkqbbcoKDb7Xrm7WuLbU2Wlxh8fWACtv0rtCVWOQV4qVWWbAgI/AcoQPy0cM6KXwAAAABJRU5ErkJggg==";

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
  const { size = 20, ...rest } = props;
  const compliantHeight = Math.max(20, size);
  const compliantWidth = (compliantHeight * 98) / 68;
  return (
    <svg
      {...rest}
      width={compliantWidth}
      height={compliantHeight}
      viewBox="0 0 98 68"
      role="img"
      aria-label="YouTube"
    >
      <image href={YOUTUBE_ICON_DATA_URI} width="98" height="68" />
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
  if (platform === "youtube" && (props.size ?? 16) < 20) {
    return (
      <span
        aria-label="YouTube"
        className={props.className}
        style={{
          display: "inline-block",
          fontFamily: "inherit",
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: 0,
          ...props.style,
        }}
      >
        YouTube
      </span>
    );
  }
  const Rune = RUNES[platform];
  return <Rune {...props} />;
}

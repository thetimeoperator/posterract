import type { SVGProps } from "react";
import type { PlatformId } from "@posterract/contract";

/**
 * Backwards-compatible compact platform marks.
 *
 * Every mark is official platform artwork. YouTube must never render below
 * 20px, so compact YouTube placements use the plain word "YouTube" instead.
 */

type RuneProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Exact red-and-white YouTube icon artwork published by Google on the
 * YouTube API Services branding-guidelines page. The original 2x sprite is:
 * https://developers.google.com/static/youtube/images/youtube-icons-2x.png
 */
export const YOUTUBE_ICON_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGIAAABECAYAAAB6UOAlAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAYqADAAQAAAABAAAARAAAAABJTkZNAAAEdUlEQVR4Ae1c7VHjMBBVGP5fOsBUgDsgVHApIXQAFZBUAFSQdABXAaYC0kFMBZerIPdeYmlkx/GExB+SvDss+rQkv6fdVQzxQNUgG6WGGCa2hmKedVp+IWO363qmxb52Wxv5JSZZH5jos1CfokylrAdK8dpaBGMdJxbYI1xxAx1C4yxF0mshIWso029oUidJGE8pEDCCvkE3oj/C4C/wmkKHWyBP/cUBoELA+RuQhDycxAMujKErqFhBfRjMq8jYixEkARd8QM8zqapZ+9u2AOD3Zbd/UVJJ5oSEEmBqqJpgo5e6qRwR6DTFZLQIkeYQeALOUXF445rQSCtYQcUaiijVX95zUbZFjIWE+hE/MOI42/im2Sbit6mVTNMI0OuM7ElsInINdifJN4LArT3qlgiYSYxKiQ02Ms3nibkRbRGRqZFMWwiUEpGrbGslPZ+Hj5CMF9IWcdVzULq6fWMAmoioq5X0fN49ixAiutkRYhHd4H54Vu2aDvfoqmU6VWo+Rzgz1tvVSpqc91YPfoHIbcxDVzqTTiZ4+rXCo8ipM0tqaiG0CLe3HC3i6WlHyHjcFA6dj+uuaypCE0X4w+0b/mT1gYfIyIchxhv5Q4QGfjTaWcfzcwjxw3gjEoE781AeHnaEMA1A/LMIG3TGD1oGAzotxWPxmwgNPGMGYwdjiKfxIwwiNCE8VenjriefPzZZaAiLCE2IPu7yc4gnEiYRBJ8WwU/mX19exA8SceXJpjltmXG8ix8kxeH4QSKi0+7Qs6vopmgdfFziYPwI1zWV7RMSwPhBQhx7XNIvIjQ5dFE86jr0MPFSr61XaZoq9fio1Pu7M7fdLyLWa6VeX52yBL0TSAS2Rw9ksdhZAclwUBgjvh1cV31LShKl7u7wrYR7fMvNTRJ4s+G6JsaB2UwpWoIHEh4ROg68vDhtAdbe2JppWETwFMTTEK3BExlk39UOg4jlckcA44Gn4jcRdEO0AE/iQNUe4akpqergbBsD8fV1ECQQY/8sgu6HR1GP4kDFZt4Gar+IIPAkwOM4UEIIgttO6JoMK7rSqVTHAbqhsEjIwXw5wPFpk6tyqOD4Y4k6kQIPeNnE9qfOYWWsIxGYgYAp++q/R6QsiHSHgBDRHfacOResWZHyl0jrCJiDkraI79aXIBMSgT2LMBWCT2sI8OWMexYhRLSGv5koh/nWNYGZFM2GHdNVMk0i8GkPrmME6xK7QfKNI7BvEdmUfxqfWibQCDA+vOsCU9si2CDuyUanuXyOBE5jiMgiOP7pR6RhBLjZZ8U5gH9e8NwJ/xjq8Hev88v1sfQI0F+KCy8jIkInkjEsdpby2QgsAPh92SjGNelGdEyRv4MyFakPgYMkVE4BF8UXO8m7wc9/JTXfDT6pBPuYRgzCt+XPofKe8J9hsAJmR78tH57oeCEp6E29gkaWIttrSbK7/0SaQpcAdpnVHZX8iIiqEUFSjHYd4CPkqbbcoKDb7Xrm7WuLbU2Wlxh8fWACtv0rtCVWOQV4qVWWbAgI/AcoQPy0cM6KXwAAAABJRU5ErkJggg==";

export type PlatformBrandId = PlatformId | "linkedin";

export const PLATFORM_MARK_SOURCES: Record<PlatformBrandId, string> = {
  instagram: "/brand/platforms/instagram.png",
  tiktok: "/brand/platforms/tiktok.png",
  youtube: YOUTUBE_ICON_DATA_URI,
  x: "/brand/platforms/x.svg",
  threads: "/brand/platforms/threads.svg",
  facebook: "/brand/platforms/facebook.png",
  linkedin: "/brand/platforms/linkedin.png",
};

function OfficialRune({
  platform,
  size = platform === "youtube" ? 20 : 16,
  style,
  ...rest
}: RuneProps & { platform: PlatformId }) {
  const height = platform === "youtube" ? Math.max(20, size) : size;
  const width = platform === "youtube" ? (height * 98) / 68 : height;
  const viewBox = platform === "youtube" ? "0 0 98 68" : "0 0 24 24";
  const imageWidth = platform === "youtube" ? 98 : 24;
  const imageHeight = platform === "youtube" ? 68 : 24;

  return (
    <svg
      {...rest}
      width={width}
      height={height}
      viewBox={viewBox}
      aria-hidden={rest["aria-hidden"] ?? true}
      style={{ ...style, width, height }}
    >
      <image
        href={PLATFORM_MARK_SOURCES[platform]}
        width={imageWidth}
        height={imageHeight}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export function InstagramRune(props: RuneProps) {
  return <OfficialRune platform="instagram" {...props} />;
}

export function TikTokRune(props: RuneProps) {
  return <OfficialRune platform="tiktok" {...props} />;
}

export function FacebookRune(props: RuneProps) {
  return <OfficialRune platform="facebook" {...props} />;
}

export function ThreadsRune(props: RuneProps) {
  return <OfficialRune platform="threads" {...props} />;
}

export function XRune(props: RuneProps) {
  return <OfficialRune platform="x" {...props} />;
}

export function YouTubeRune(props: RuneProps) {
  return <OfficialRune platform="youtube" {...props} />;
}

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
  return <OfficialRune platform={platform} {...props} />;
}

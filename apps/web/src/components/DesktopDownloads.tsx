import { Apple, Download, Monitor, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One build per platform, each produced on its own machine: esbuild ships inside
 * the app as a native binary for the host, so there is no universal artifact.
 * A platform without a configured URL is offered as "coming soon" rather than
 * hidden, so the page never implies we only run on one operating system.
 */
export type DesktopPlatform = "mac" | "windows" | "linux";

type Build = {
  id: DesktopPlatform;
  label: string;
  requirement: string;
  icon: LucideIcon;
  url: string | undefined;
};

export const DESKTOP_BUILDS: Build[] = [
  {
    id: "mac",
    label: "macOS",
    requirement: "Apple silicon · macOS 11+",
    icon: Apple,
    url: import.meta.env.VITE_DESKTOP_MAC_DOWNLOAD_URL as string | undefined,
  },
  {
    id: "windows",
    label: "Windows",
    requirement: "64-bit · Windows 10+",
    icon: Monitor,
    url: import.meta.env.VITE_DESKTOP_WINDOWS_DOWNLOAD_URL as string | undefined,
  },
  {
    id: "linux",
    label: "Linux",
    requirement: "AppImage · x86-64",
    icon: Terminal,
    url: import.meta.env.VITE_DESKTOP_LINUX_DOWNLOAD_URL as string | undefined,
  },
];

export const anyDesktopBuild = DESKTOP_BUILDS.some((build) => build.url);

/**
 * The visitor's platform, or null when it cannot be told. Guessing wrong is
 * worse than not guessing: all three buttons are shown either way, and this
 * only decides which one is emphasised.
 */
export function detectPlatform(): DesktopPlatform | null {
  if (typeof navigator === "undefined") return null;
  // userAgentData is the modern signal; platform is deprecated but still the
  // only thing Safari and Firefox report.
  const hinted = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const source = `${hinted ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  // Android carries "linux" in its user agent, and neither it nor iOS runs a
  // desktop build, so they must not be read as a match.
  if (/android|iphone|ipad|ipod/.test(source)) return null;
  if (/mac/.test(source)) return "mac";
  if (/win/.test(source)) return "windows";
  if (/linux|x11|cros/.test(source)) return "linux";
  return null;
}

export function DesktopDownloads({ compact = false }: { compact?: boolean }) {
  const detected = detectPlatform();
  // The visitor's own platform leads; the others stay visible beside it.
  const builds = [...DESKTOP_BUILDS].sort(
    (a, b) => Number(b.id === detected) - Number(a.id === detected),
  );

  return (
    <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2.5"}>
      {builds.map(({ id, label, requirement, icon: Glyph, url }) => {
        const primary = id === detected;
        if (!url) {
          return (
            <span
              key={id}
              className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-white/[0.08] px-4 text-[11px] text-starlight-faint"
              title={`${label} build coming soon`}
            >
              <Download size={14} /> {label} soon
            </span>
          );
        }
        return (
          <a
            key={id}
            href={url}
            className={
              primary
                ? "inline-flex h-11 flex-col justify-center rounded-[12px] border border-neon/40 bg-neon/[0.12] px-4 text-neon transition-colors hover:bg-neon/[0.18]"
                : "inline-flex h-11 flex-col justify-center rounded-[12px] border border-white/[0.11] px-4 text-starlight-dim transition-colors hover:border-white/25 hover:text-starlight"
            }
          >
            <span className="flex items-center gap-2 font-display text-[12.5px] font-semibold leading-none">
              <Glyph size={15} /> {label}
            </span>
            {!compact && (
              <span className="mt-1 text-[9.5px] leading-none opacity-70">{requirement}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}

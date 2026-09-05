import { useState } from "react";
import { Apple, ChevronDown, Download, Monitor, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One build per platform, each produced on its own machine: esbuild ships inside
 * the app as a native binary for the host, so there is no universal artifact.
 *
 * macOS leads regardless of who is looking. It is the only signed and notarized
 * build, so it is the one we stand behind, and a visitor comparing platforms
 * should see that rather than have the page quietly reorder itself around them.
 */
export const MAC_URL = import.meta.env.VITE_DESKTOP_MAC_DOWNLOAD_URL as string | undefined;
export const WINDOWS_URL = import.meta.env.VITE_DESKTOP_WINDOWS_DOWNLOAD_URL as string | undefined;
export const LINUX_APPIMAGE_URL = import.meta.env.VITE_DESKTOP_LINUX_DOWNLOAD_URL as string | undefined;
export const LINUX_DEB_URL = import.meta.env.VITE_DESKTOP_LINUX_DEB_URL as string | undefined;

export const anyDesktopBuild = Boolean(MAC_URL || WINDOWS_URL || LINUX_APPIMAGE_URL);

/** Linux has no single package everyone can install, so the choice is the user's. */
const LINUX_FORMATS: { label: string; note: string; url: string | undefined }[] = [
  { label: "AppImage", note: "Any distribution — Arch, Fedora, Ubuntu", url: LINUX_APPIMAGE_URL },
  { label: ".deb", note: "Debian and Ubuntu — installs to your menu", url: LINUX_DEB_URL },
];

function Pending({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-white/[0.08] px-4 text-[11px] text-starlight-faint"
      title={`${label} build coming soon`}
    >
      <Download size={14} /> {label} soon
    </span>
  );
}

function Secondary({
  icon: Glyph,
  label,
  requirement,
  compact,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  requirement: string;
  compact: boolean;
} & React.ComponentPropsWithoutRef<"a"> &
  React.ComponentPropsWithoutRef<"button">) {
  const className =
    "inline-flex h-11 flex-col justify-center rounded-[12px] border border-white/[0.11] px-4 text-left text-starlight-dim transition-colors hover:border-white/25 hover:text-starlight";
  const inner = (
    <>
      <span className="flex items-center gap-2 font-display text-[12.5px] font-semibold leading-none">
        <Glyph size={15} /> {label}
        {"onClick" in rest && rest.onClick ? <ChevronDown size={13} className="opacity-70" /> : null}
      </span>
      {!compact && <span className="mt-1 text-[9.5px] leading-none opacity-70">{requirement}</span>}
    </>
  );
  return "href" in rest && rest.href ? (
    <a className={className} {...(rest as React.ComponentPropsWithoutRef<"a">)}>
      {inner}
    </a>
  ) : (
    <button type="button" className={className} {...(rest as React.ComponentPropsWithoutRef<"button">)}>
      {inner}
    </button>
  );
}

export function DesktopDownloads({ compact = false }: { compact?: boolean }) {
  const [linuxOpen, setLinuxOpen] = useState(false);
  const linuxAvailable = LINUX_FORMATS.some((format) => format.url);

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2.5">
        {MAC_URL ? (
          <a
            href={MAC_URL}
            className="inline-flex h-11 flex-col justify-center rounded-[12px] border border-neon/40 bg-neon/[0.12] px-5 text-neon transition-colors hover:bg-neon/[0.18]"
          >
            <span className="flex items-center gap-2 font-display text-[12.5px] font-semibold leading-none">
              <Apple size={15} /> macOS
            </span>
            {!compact && (
              <span className="mt-1 text-[9.5px] leading-none opacity-75">Apple silicon · macOS 11+</span>
            )}
          </a>
        ) : (
          <Pending label="macOS" />
        )}

        {WINDOWS_URL ? (
          <Secondary
            icon={Monitor}
            label="Windows"
            requirement="64-bit · Windows 10+"
            compact={compact}
            href={WINDOWS_URL}
          />
        ) : (
          <Pending label="Windows" />
        )}

        {linuxAvailable ? (
          <Secondary
            icon={Terminal}
            label="Linux"
            requirement={linuxOpen ? "Pick a format" : "AppImage or .deb"}
            compact={compact}
            onClick={() => setLinuxOpen((open) => !open)}
            aria-expanded={linuxOpen}
          />
        ) : (
          <Pending label="Linux" />
        )}
      </div>

      {linuxOpen && (
        <div className="mt-2.5 flex flex-wrap gap-2 rounded-[12px] border border-white/[0.08] bg-black/25 p-2.5">
          {LINUX_FORMATS.map(({ label, note, url }) =>
            url ? (
              <a
                key={label}
                href={url}
                className="inline-flex flex-col rounded-[10px] border border-white/[0.10] px-3.5 py-2 text-starlight-dim transition-colors hover:border-neon/35 hover:text-starlight"
              >
                <span className="font-display text-[12px] font-semibold leading-none">{label}</span>
                <span className="mt-1 text-[9.5px] leading-none opacity-70">{note}</span>
              </a>
            ) : (
              <span key={label} className="px-3.5 py-2 text-[10px] text-starlight-faint">
                {label} soon
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

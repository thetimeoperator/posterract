import { useState } from "react";
import { Apple, Check, Monitor, Terminal } from "lucide-react";
import { Modal } from "@posterract/hyperkit";
import {
  LINUX_APPIMAGE_URL,
  LINUX_DEB_URL,
  MAC_URL,
  WINDOWS_URL,
} from "@/components/DesktopDownloads";

/**
 * The first thing a new subscriber sees. Payment buys the editor, and the editor
 * is a desktop app — so the moment the subscription lands, the download is put in
 * front of them rather than left to be found later under a menu.
 *
 * macOS leads for everyone: it is the only signed and notarized build.
 */
export function DesktopHandoff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [linuxOpen, setLinuxOpen] = useState(false);

  const card =
    "group flex items-center gap-3.5 rounded-[14px] border px-4 py-3.5 text-left transition-all duration-200";
  const quiet =
    "border-white/[0.09] bg-white/[0.015] hover:border-white/25 hover:bg-white/[0.04]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="You're in"
      title="Install Posterract Desktop"
      width="max-w-md"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-starlight-faint transition-colors hover:text-starlight"
        >
          I'll download it later
        </button>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-starlight-dim">
        Your subscription is active. The canvas runs on your own machine — it compiles your project
        folder, renders to your disk, and connects to your coding agent locally.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {MAC_URL && (
          <a
            href={MAC_URL}
            className={`${card} border-neon/40 bg-gradient-to-r from-neon/[0.14] to-neon/[0.04] hover:border-neon hover:from-neon/[0.2]`}
          >
            <Apple size={19} className="shrink-0 text-neon" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[13.5px] font-semibold text-starlight">macOS</span>
              <span className="mt-0.5 block text-[10px] text-neon/80">
                Apple silicon · Signed &amp; notarized
              </span>
            </span>
            <span className="font-display text-[10.5px] font-bold tracking-wide text-neon opacity-80 transition-opacity group-hover:opacity-100">
              GET ↓
            </span>
          </a>
        )}

        {WINDOWS_URL && (
          <a href={WINDOWS_URL} className={`${card} ${quiet}`}>
            <Monitor size={19} className="shrink-0 text-starlight-dim" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[13.5px] font-semibold text-starlight">Windows</span>
              <span className="mt-0.5 block text-[10px] text-starlight-faint">64-bit · Windows 10+</span>
            </span>
            <span className="font-display text-[10.5px] font-bold tracking-wide text-starlight-faint transition-colors group-hover:text-starlight">
              GET ↓
            </span>
          </a>
        )}

        {(LINUX_APPIMAGE_URL || LINUX_DEB_URL) && (
          <>
            <button
              type="button"
              onClick={() => setLinuxOpen((value) => !value)}
              aria-expanded={linuxOpen}
              className={`${card} ${quiet} w-full`}
            >
              <Terminal size={19} className="shrink-0 text-starlight-dim" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[13.5px] font-semibold text-starlight">Linux</span>
                <span className="mt-0.5 block text-[10px] text-starlight-faint">AppImage or .deb</span>
              </span>
              <span className="font-display text-[10.5px] font-bold tracking-wide text-starlight-faint transition-colors group-hover:text-starlight">
                {linuxOpen ? "PICK ↑" : "PICK ↓"}
              </span>
            </button>

            {linuxOpen && (
              <div className="ml-[30px] flex flex-col gap-1.5 border-l border-white/[0.09] pl-3.5">
                {LINUX_APPIMAGE_URL && (
                  <a
                    href={LINUX_APPIMAGE_URL}
                    className="rounded-[11px] border border-white/[0.08] px-3.5 py-2.5 transition-colors hover:border-neon/35 hover:bg-neon/[0.04]"
                  >
                    <span className="block font-display text-[12px] font-semibold text-starlight">AppImage</span>
                    <span className="mt-0.5 block text-[9.5px] text-starlight-faint">
                      Any distribution — Arch, Fedora, Ubuntu
                    </span>
                  </a>
                )}
                {LINUX_DEB_URL && (
                  <a
                    href={LINUX_DEB_URL}
                    className="rounded-[11px] border border-white/[0.08] px-3.5 py-2.5 transition-colors hover:border-neon/35 hover:bg-neon/[0.04]"
                  >
                    <span className="block font-display text-[12px] font-semibold text-starlight">.deb</span>
                    <span className="mt-0.5 block text-[9.5px] text-starlight-faint">
                      Debian &amp; Ubuntu — installs to your menu
                    </span>
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-5 flex items-center gap-1.5 text-[10.5px] text-starlight-faint">
        <Check size={12} className="text-neon" /> Scheduling and analytics stay here on the web.
      </p>
    </Modal>
  );
}

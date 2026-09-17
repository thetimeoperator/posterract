import type { ReactNode } from "react";
import { PLATFORM_CAPABILITIES, type PlatformId, type PortalDTO } from "@posterract/contract";
import { PlatformBrandMark } from "@posterract/hyperkit";
import { WebComposeDialog } from "./WebComposeDialog";
import { WebAccountAvatar } from "./WebAccountStrip";

const formats = { instagram: "Instagram Reel", facebook: "Facebook Page Reel", threads: "Threads video post", tiktok: "TikTok video" };

export function WebPlatformSettings({ open, onClose, platforms, active, onActive, accounts, selected, issues, tiktokSettings }: {
  open: boolean; onClose: () => void; platforms: PlatformId[]; active?: PlatformId; onActive: (provider: PlatformId) => void;
  accounts: PortalDTO[]; selected: Partial<Record<PlatformId, string>>; issues: Partial<Record<PlatformId, boolean>>; tiktokSettings: ReactNode;
}) {
  const account = accounts.find((a) => a.provider === active && a.id === selected[active!]);
  const caps = active && PLATFORM_CAPABILITIES[active];
  return <WebComposeDialog open={open} onClose={onClose} title="Platform settings">
    {platforms.length === 0 ? <p className="web-compose-setting-note">Select an account to configure its settings.</p> : <>
      <div className="web-compose-tabs" role="tablist" aria-label="Platform settings" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = platforms.indexOf(active!);
        const next = event.key === "Home" ? 0 : event.key === "End" ? platforms.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + platforms.length) % platforms.length;
        onActive(platforms[next]);
        document.getElementById(`web-settings-tab-${platforms[next]}`)?.focus();
      }}>
        {platforms.map((provider) => <button type="button" role="tab" key={provider} id={`web-settings-tab-${provider}`} aria-controls="web-settings-panel" aria-label={PLATFORM_CAPABILITIES[provider].label}
          aria-selected={provider === active} tabIndex={provider === active ? 0 : -1} onClick={() => onActive(provider)}>
          <PlatformBrandMark platform={provider} height={15} decorative />{PLATFORM_CAPABILITIES[provider].label}
          {issues[provider] && <span className="web-compose-attention-dot" aria-label="Needs attention" />}
        </button>)}
      </div>
      {active && caps && <div role="tabpanel" id="web-settings-panel" aria-labelledby={`web-settings-tab-${active}`}>
        <div className="web-compose-setting-identity"><WebAccountAvatar provider={active} account={account} />
          <div><strong>{account?.displayName || account?.handle || caps.label}</strong>{account?.handle && <small>{account.handle}</small>}</div>
        </div>
        {active === "tiktok" ? tiktokSettings : <div className="web-compose-format-info">
          <span className="kicker">Format</span><p>{formats[active as keyof typeof formats] || caps.label}</p>
          <p className="web-compose-setting-note">No additional settings for this format.</p>
        </div>}
      </div>}
    </>}
  </WebComposeDialog>;
}

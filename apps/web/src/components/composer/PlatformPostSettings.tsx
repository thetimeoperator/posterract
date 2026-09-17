import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, RotateCcw, Settings2 } from "lucide-react";
import { PlatformBrandMark, Textarea } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS, type PlatformId, type PortalDTO } from "@posterract/contract";
import type { ReactNode } from "react";

export function WebAccountTargets({ accounts, platforms, selected, onToggle }: {
  accounts: PortalDTO[]; platforms: PlatformId[]; selected: Partial<Record<PlatformId, string>>;
  onToggle: (provider: PlatformId) => void;
}) {
  return <div className="web-compose-targets" role="group" aria-label="Target accounts">
    {PUBLISHING_PLATFORM_IDS.map((provider) => {
      const connected = accounts.filter((a) => a.provider === provider && a.status === "connected");
      const account = connected.find((a) => a.id === selected[provider]) ?? (connected.length === 1 ? connected[0] : undefined);
      const enabled = platforms.includes(provider);
      return <button type="button" key={provider} className="web-compose-target" aria-pressed={enabled}
        aria-label={PLATFORM_CAPABILITIES[provider].label} onClick={() => onToggle(provider)}>
        <span className="web-compose-platform-mark"><PlatformBrandMark platform={provider} height={22} decorative /></span>
        <span className="web-compose-target-copy"><strong>{PLATFORM_CAPABILITIES[provider].label}</strong>
          <span>{account?.displayName || account?.handle || (connected.length ? `${connected.length} accounts · choose one` : "Connect an account")}</span>
        </span>
        <span className="web-compose-selection" aria-hidden>{enabled && <Check size={12} strokeWidth={3} />}</span>
      </button>;
    })}
  </div>;
}

const formats: Partial<Record<PlatformId, { name: string; detail: string }>> = {
  instagram: { name: "Reel", detail: "Your video will publish as a Reel on this Instagram account." },
  facebook: { name: "Page Reel", detail: "Your video will publish as a Reel on this Facebook Page." },
  threads: { name: "Video post", detail: "Your video and caption will publish together on Threads." },
  tiktok: { name: "Video", detail: "Choose how to publish, who can watch, and how people can interact." },
};

export function PlatformPostSettings({ platforms, active, onActive, accounts, selected, onAccount,
  baseCaption, overrides, onCaption, onReset, fullCaptionFor, issues, tiktokSettings }: {
  platforms: PlatformId[]; active?: PlatformId; onActive: (provider: PlatformId) => void;
  accounts: PortalDTO[]; selected: Partial<Record<PlatformId, string>>;
  onAccount: (provider: PlatformId, id: string) => void;
  baseCaption: string; overrides: Partial<Record<PlatformId, string>>;
  onCaption: (provider: PlatformId, value: string) => void; onReset: (provider: PlatformId) => void;
  fullCaptionFor: (provider: PlatformId) => string; issues: Partial<Record<PlatformId, boolean>>;
  tiktokSettings: ReactNode;
}) {
  const caps = active ? PLATFORM_CAPABILITIES[active] : undefined;
  const account = accounts.find((a) => a.id === selected[active!] && a.provider === active);
  const available = accounts.filter((a) => a.provider === active && a.status === "connected");
  const format = active ? formats[active] : undefined;
  const custom = active !== undefined && overrides[active] !== undefined;
  return <section className="web-compose-card web-compose-platform-settings" id="web-platform-settings" aria-labelledby="platform-settings-title">
    <header className="web-compose-card-heading"><div><span className="web-compose-eyebrow">PER PLATFORM</span>
      <h2 id="platform-settings-title">Make it fit each channel</h2></div><Settings2 size={18} aria-hidden /></header>
    {platforms.length === 0 ? <p className="web-compose-empty">Select a platform above to choose its account and post settings.</p> : <>
      <div className="web-compose-tabs" role="tablist" aria-label="Platform settings" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = platforms.indexOf(active!);
        const next = event.key === "Home" ? 0 : event.key === "End" ? platforms.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + platforms.length) % platforms.length;
        onActive(platforms[next]);
        document.getElementById(`web-platform-tab-${platforms[next]}`)?.focus();
      }}>
        {platforms.map((provider) => <button key={provider} type="button" role="tab" id={`web-platform-tab-${provider}`}
          aria-selected={active === provider} aria-controls="web-platform-panel" tabIndex={active === provider ? 0 : -1}
          onClick={() => onActive(provider)}>
          <PlatformBrandMark platform={provider} height={16} decorative />{PLATFORM_CAPABILITIES[provider].label}
          {issues[provider] && <span className="web-compose-attention-dot" aria-label="Needs attention" />}
        </button>)}
      </div>
      {active && caps && <div role="tabpanel" id="web-platform-panel" aria-labelledby={`web-platform-tab-${active}`} className="web-compose-platform-body">
        <div className="web-compose-destination">
          <span className="web-compose-avatar" aria-hidden>{account?.avatarUrl ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <PlatformBrandMark platform={active} height={24} decorative />}</span>
          <div><h3>{caps.label} settings</h3><p>{format?.detail}</p></div>
          <span className="web-compose-format">{format?.name}</span>
        </div>
        <label className="web-compose-field"><span>Posting account</span>
          <select aria-label={`${caps.label} account`} value={selected[active] || ""}
            onChange={(event) => onAccount(active, event.target.value)} disabled={!available.length}>
            <option value="">{available.length ? "Choose an account…" : "No connected accounts"}</option>
            {account && account.status !== "connected" && <option value={account.id} disabled>{account.displayName || account.handle} (disconnected)</option>}
            {available.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.handle}{a.displayName && a.handle !== a.displayName ? ` · ${a.handle}` : ""}</option>)}
          </select>
        </label>
        {(!available.length || account?.status !== "connected") && <Link to="/portals" className="web-compose-connect">Connect {caps.label} account <ChevronRight size={14} /></Link>}
        <div className="web-compose-caption-state"><span>{custom ? "Custom caption for this platform" : "Using your shared caption"}</span>
          {custom && <button type="button" onClick={() => onReset(active)}><RotateCcw size={12} /> Use shared caption</button>}</div>
        <Textarea label={`${caps.label} caption`} value={overrides[active] ?? baseCaption}
          onChange={(event) => onCaption(active, event.target.value)} rows={3}
          placeholder="Write a caption for this platform…"
          hint={`${fullCaptionFor(active).length.toLocaleString()} / ${caps.captionMaxChars.toLocaleString()} characters, including hashtags`}
          error={fullCaptionFor(active).length > caps.captionMaxChars ? `${caps.label} allows ${caps.captionMaxChars.toLocaleString()} characters. Shorten this caption or remove hashtags.` : undefined} />
        {active === "tiktok" ? tiktokSettings : <div className="web-compose-platform-note">
          <span><strong>{format?.name}</strong><small>Publishing format</small></span>
          <span><strong>{caps.video.minDurationS}–{caps.video.maxDurationS} sec</strong><small>Video duration</small></span>
          <span><strong>{caps.captionMaxChars.toLocaleString()}</strong><small>Caption characters</small></span>
        </div>}
      </div>}
    </>}
  </section>;
}

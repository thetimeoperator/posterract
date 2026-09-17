import { Link } from "@tanstack/react-router";
import { PlatformBrandMark, PlatformChip } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS, type PlatformId, type PortalDTO } from "@posterract/contract";
import type { TikTokCreatorInfo } from "@posterract/contract/tiktok";

export function AccountTargets({ accounts, platforms, selected, onToggle, onSelect, creator }: {
  accounts: PortalDTO[]; platforms: PlatformId[]; selected: Partial<Record<PlatformId, string>>;
  onToggle: (provider: PlatformId) => void; onSelect: (provider: PlatformId, id: string) => void; creator?: TikTokCreatorInfo;
}) {
  return <div className="space-y-2" role="group" aria-label="Target accounts">
    {PUBLISHING_PLATFORM_IDS.map((provider) => {
      const available = accounts.filter((a) => a.provider === provider && a.status === "connected");
      const enabled = platforms.includes(provider);
      const account = accounts.find((a) => a.id === selected[provider]) || (!enabled && !selected[provider] && available.length === 1 ? available[0] : undefined);
      const name = provider === "tiktok" && enabled && creator ? creator.creator_nickname : account?.displayName || account?.handle;
      const handle = provider === "tiktok" ? creator?.creator_username : account?.handle;
      const avatar = provider === "tiktok" && enabled && creator ? creator.creator_avatar_url : account?.avatarUrl;
      return <div key={provider} className={`rounded-[10px] border p-2.5 ${enabled ? "border-neon/30 bg-neon/[0.035]" : "border-white/[0.08]"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><PlatformBrandMark platform={provider} height={15} /><PlatformChip platform={provider} selected={enabled} onClick={() => onToggle(provider)} /></div>
          <span className={`text-[10px] ${account?.status === "connected" ? "text-auroral" : "text-starlight-faint"}`}>
            {enabled ? account?.status === "connected" ? "Selected · Connected" : "Choose account" : available.length ? "Connected" : "Not connected"}
          </span>
        </div>
        {account && <div className="mt-2 flex items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-white/[0.06] text-[12px] text-neon">
            {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : name?.slice(0, 1).toUpperCase() || "?"}
          </span>
          <span className="min-w-0"><span className="block truncate text-[12px] text-starlight">{name}</span>
            {handle && <span className="block truncate text-[10px] text-starlight-dim">@{handle.replace(/^@/, "")}</span>}
            {account.status !== "connected" && <span className="text-[10px] text-solar">Reconnect this account to post</span>}
          </span>
        </div>}
        {enabled && (available.length > 1 || (available.length > 0 && account?.status !== "connected")) && <select aria-label={`${PLATFORM_CAPABILITIES[provider].label} account`} value={selected[provider] || ""}
          onChange={(e) => onSelect(provider, e.target.value)} className="mt-2 h-9 w-full rounded-[8px] border border-white/[0.09] bg-void-2 px-2 text-[12px] text-starlight">
          <option value="">Choose an account…</option>
          {account && account.status !== "connected" && <option value={account.id} disabled>{name} (disconnected)</option>}
          {available.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.handle}{a.displayName && a.handle !== a.displayName ? ` · ${a.handle}` : ""}</option>)}
        </select>}
        {(!available.length || (enabled && account && account.status !== "connected")) && <Link to="/portals" className="mt-2 inline-block text-[11px] text-neon underline">Connect {PLATFORM_CAPABILITIES[provider].label} account</Link>}
      </div>;
    })}
  </div>;
}

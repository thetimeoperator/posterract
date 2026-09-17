import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Plus, CircleAlert } from "lucide-react";
import { Button, PlatformBrandMark } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS, type PlatformId, type PortalDTO, type AccountSetDTO } from "@posterract/contract";
import type { TikTokCreatorInfo } from "@posterract/contract/tiktok";
import { WebComposeDialog } from "./WebComposeDialog";

export function WebAccountAvatar({ account, provider, avatarUrl }: { account?: PortalDTO; provider: PlatformId; avatarUrl?: string }) {
  const src = avatarUrl || account?.avatarUrl;
  const [failed, setFailed] = useState<string>();
  return <span className="web-compose-account-photo" aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <span>{(account?.displayName || account?.handle?.replace(/^@/, "") || PLATFORM_CAPABILITIES[provider].label).slice(0, 2).toUpperCase()}</span>}
  </span>;
}

export function WebAccountStrip({ accounts, platforms, selected, onToggle, onAccount, accountSets, accountSetId, onAccountSet,
  creator, pickerOpen, onPicker, issues }: {
  accounts: PortalDTO[]; platforms: PlatformId[]; selected: Partial<Record<PlatformId, string>>;
  onToggle: (provider: PlatformId) => void; onAccount: (provider: PlatformId, id: string) => void;
  accountSets: AccountSetDTO[]; accountSetId: string; onAccountSet: (id: string) => void;
  creator?: TikTokCreatorInfo; pickerOpen: boolean; onPicker: (open: boolean) => void;
  issues: Partial<Record<PlatformId, boolean>>;
}) {
  const accountSetInputId = useId();
  return <>
    <div className="web-compose-account-strip">
      <div className="web-compose-account-heading">
        <span className="kicker">Accounts</span>
        <div className="web-compose-account-set">
          <div className="web-compose-account-set-field">
            <label htmlFor={accountSetInputId}>Account set</label>
            <select id={accountSetInputId} value={accountSetId} disabled={!accountSets.length} onChange={(event) => onAccountSet(event.target.value)}>
              <option value="">{accountSets.length ? "Custom selection" : "No saved sets"}</option>
              {accountSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
            </select>
          </div>
          {!accountSets.length && <Link to="/portals" target="_blank" rel="noreferrer" aria-label="Create account set (opens in a new tab)">Create set</Link>}
        </div>
      </div>
      <div className="web-compose-account-row">
        <div className="web-compose-account-avatars" role="group" aria-label="Target accounts">
          {PUBLISHING_PLATFORM_IDS.map((provider) => {
            const available = accounts.filter((a) => a.provider === provider && a.status === "connected");
            const account = accounts.find((a) => a.provider === provider && a.id === selected[provider]) ?? (available.length === 1 ? available[0] : undefined);
            const enabled = platforms.includes(provider);
            const name = provider === "tiktok" && enabled && creator ? creator.creator_nickname : account?.displayName || account?.handle;
            const label = PLATFORM_CAPABILITIES[provider].label;
            const identity = `${label}${name ? ` · ${name}` : " · Choose account"}${account?.handle ? ` · ${account.handle}` : ""}`;
            return <button type="button" key={provider} aria-label={label} aria-pressed={enabled}
              title={identity} className="web-compose-account-button" data-issue={enabled && issues[provider] || undefined}
              onClick={() => { onToggle(provider); if (!enabled && (!account || account.status !== "connected")) onPicker(true); }}>
              <WebAccountAvatar account={account} provider={provider} avatarUrl={provider === "tiktok" && enabled ? creator?.creator_avatar_url : undefined} />
              <span className="web-compose-account-badge"><PlatformBrandMark platform={provider} height={15} decorative /></span>
              {enabled && <span className="web-compose-account-check" aria-hidden>{issues[provider] ? <CircleAlert size={12} /> : <Check size={10} strokeWidth={3} />}</span>}
              <span className="web-compose-account-tooltip" role="tooltip">{identity}</span>
            </button>;
          })}
        </div>
        <div className="web-compose-account-actions">
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => onPicker(true)}>Accounts</Button>
        </div>
      </div>
    </div>
    <WebComposeDialog open={pickerOpen} onClose={() => onPicker(false)} title="Accounts">
      <div className="web-compose-account-picker">{PUBLISHING_PLATFORM_IDS.map((provider) => {
        const available = accounts.filter((a) => a.provider === provider && a.status === "connected");
        const account = accounts.find((a) => a.provider === provider && a.id === selected[provider]);
        const label = PLATFORM_CAPABILITIES[provider].label;
        return <div key={provider} className="web-compose-account-choice">
          <label className="web-compose-account-choice-toggle"><input type="checkbox" checked={platforms.includes(provider)} onChange={() => onToggle(provider)} aria-label={`Select ${label}`} />
            <PlatformBrandMark platform={provider} height={18} decorative />{label}</label>
          <select aria-label={`${label} account`} value={selected[provider] || ""} disabled={!available.length}
            onChange={(event) => onAccount(provider, event.target.value)}>
            <option value="">{available.length ? "Choose an account…" : "No connected accounts"}</option>
            {account && account.status !== "connected" && <option value={account.id} disabled>{account.displayName || account.handle} (disconnected)</option>}
            {available.map((a) => <option value={a.id} key={a.id}>{a.displayName || a.handle}{a.displayName && a.handle !== a.displayName ? ` · ${a.handle}` : ""}</option>)}
          </select>
          {(!available.length || (account && account.status !== "connected")) && <Link to="/portals">Connect {label} account</Link>}
        </div>;
      })}</div>
      <Link to="/portals" target="_blank" rel="noreferrer" className="web-compose-manage-sets" aria-label="Manage account sets (opens in a new tab)">Manage account sets</Link>
    </WebComposeDialog>
  </>;
}

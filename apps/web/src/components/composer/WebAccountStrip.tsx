import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Plus, CircleAlert } from "lucide-react";
import { Button, PlatformBrandMark } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS, allowsSeveralAccounts, type BusinessDTO, type PlatformId, type PortalDTO } from "@posterract/contract";
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

const accountName = (account: PortalDTO) => account.displayName || account.handle;

export function WebAccountStrip({ accounts, platforms, selected, onToggle, onAccount, businesses, businessId, onBusiness,
  creator, pickerOpen, onPicker, issues }: {
  accounts: PortalDTO[]; platforms: PlatformId[]; selected: Partial<Record<PlatformId, string[]>>;
  onToggle: (provider: PlatformId) => void;
  /** Instagram, Facebook, Threads: toggles that account. Other platforms: picks it ("" clears). */
  onAccount: (provider: PlatformId, id: string) => void;
  businesses: BusinessDTO[]; businessId: string; onBusiness: (id: string) => void;
  creator?: TikTokCreatorInfo; pickerOpen: boolean; onPicker: (open: boolean) => void;
  issues: Partial<Record<PlatformId, boolean>>;
}) {
  const businessInputId = useId();
  const chosen = (provider: PlatformId) => accounts.filter((a) => a.provider === provider && (selected[provider] ?? []).includes(a.id));
  return <>
    <div className="web-compose-account-strip">
      <div className="web-compose-account-heading">
        <span className="kicker">Accounts</span>
        <div className="web-compose-account-set">
          <div className="web-compose-account-set-field">
            <label htmlFor={businessInputId}>Business</label>
            <select id={businessInputId} value={businessId} disabled={!businesses.length} onChange={(event) => onBusiness(event.target.value)}>
              <option value="">{businesses.length ? "Custom selection" : "No businesses"}</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </div>
          {!businesses.length && <Link to="/portals" target="_blank" rel="noreferrer" aria-label="Create business (opens in a new tab)">Create business</Link>}
        </div>
      </div>
      <div className="web-compose-account-row">
        <div className="web-compose-account-avatars" role="group" aria-label="Target accounts">
          {PUBLISHING_PLATFORM_IDS.map((provider) => {
            const available = accounts.filter((a) => a.provider === provider && a.status === "connected");
            const picked = chosen(provider);
            const account = picked[0] ?? (available.length === 1 ? available[0] : undefined);
            const enabled = platforms.includes(provider);
            const names = provider === "tiktok" && enabled && creator ? [creator.creator_nickname] : picked.map(accountName);
            const label = PLATFORM_CAPABILITIES[provider].label;
            const identity = `${label}${names.length ? ` · ${names.join(", ")}` : account ? ` · ${accountName(account)}` : " · Choose account"}`;
            return <button type="button" key={provider} aria-label={label} aria-pressed={enabled}
              title={identity} className="web-compose-account-button" data-issue={enabled && issues[provider] || undefined}
              onClick={() => { onToggle(provider); if (!enabled && (!account || account.status !== "connected")) onPicker(true); }}>
              <WebAccountAvatar account={account} provider={provider} avatarUrl={provider === "tiktok" && enabled ? creator?.creator_avatar_url : undefined} />
              <span className="web-compose-account-badge"><PlatformBrandMark platform={provider} height={15} decorative /></span>
              {enabled && <span className="web-compose-account-check" aria-hidden>{issues[provider] ? <CircleAlert size={12} /> : picked.length > 1 ? <span className="web-compose-account-count">{picked.length}</span> : <Check size={10} strokeWidth={3} />}</span>}
              <span className="web-compose-account-tooltip" role="tooltip">{identity}</span>
            </button>;
          })}
        </div>
        <div className="web-compose-account-actions">
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => onPicker(true)}>Accounts</Button>
        </div>
      </div>
      {platforms.length > 0 && <ul className="web-compose-account-names" aria-label="Selected posting accounts" aria-live="polite">
        {PUBLISHING_PLATFORM_IDS.filter((provider) => platforms.includes(provider)).map((provider) => {
          const picked = chosen(provider);
          const names = provider === "tiktok" && picked.length ? [creator?.creator_nickname || accountName(picked[0])] : picked.map(accountName);
          return <li key={provider}>
            <span>{PLATFORM_CAPABILITIES[provider].label}:</span>{" "}{names.join(", ") || "Choose account"}
            {picked.some((a) => a.status !== "connected") && " (disconnected)"}
          </li>;
        })}
      </ul>}
    </div>
    <WebComposeDialog open={pickerOpen} onClose={() => onPicker(false)} title="Accounts">
      <div className="web-compose-account-picker">{PUBLISHING_PLATFORM_IDS.map((provider) => {
        const available = accounts.filter((a) => a.provider === provider && a.status === "connected");
        const picked = chosen(provider);
        const stale = picked.filter((a) => a.status !== "connected");
        const label = PLATFORM_CAPABILITIES[provider].label;
        return <div key={provider} className="web-compose-account-choice">
          <label className="web-compose-account-choice-toggle"><input type="checkbox" checked={platforms.includes(provider)} onChange={() => onToggle(provider)} aria-label={`Select ${label}`} />
            <PlatformBrandMark platform={provider} height={18} decorative />{label}</label>
          {allowsSeveralAccounts(provider) && available.length > 0 ? (
            <div className="web-compose-account-options" role="group" aria-label={`${label} accounts`}>
              {[...stale, ...available].map((a) => <label key={a.id} className="web-compose-account-option">
                <input type="checkbox" checked={picked.some((item) => item.id === a.id)} disabled={a.status !== "connected"} onChange={() => onAccount(provider, a.id)} />
                <span>{accountName(a)}{a.displayName && a.handle !== a.displayName ? ` · ${a.handle}` : ""}{a.status !== "connected" ? " (disconnected)" : ""}</span>
              </label>)}
            </div>
          ) : (
            <select aria-label={`${label} account`} value={picked[0]?.id || ""} disabled={!available.length}
              onChange={(event) => onAccount(provider, event.target.value)}>
              <option value="">{available.length ? "Choose an account…" : "No connected accounts"}</option>
              {stale.map((a) => <option value={a.id} key={a.id} disabled>{accountName(a)} (disconnected)</option>)}
              {available.map((a) => <option value={a.id} key={a.id}>{accountName(a)}{a.displayName && a.handle !== a.displayName ? ` · ${a.handle}` : ""}</option>)}
            </select>
          )}
          {(!available.length || stale.length > 0) && <Link to="/portals">Connect {label} account</Link>}
        </div>;
      })}</div>
      <Link to="/portals" target="_blank" rel="noreferrer" className="web-compose-manage-sets" aria-label="Manage businesses (opens in a new tab)">Manage businesses</Link>
    </WebComposeDialog>
  </>;
}

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { PlatformBrandMark } from "@posterract/hyperkit";
import { Link } from "@tanstack/react-router";
import { ANALYTICS_PLATFORM_IDS, PLATFORM_CAPABILITIES, type BusinessDTO, type PlatformId, type PortalDTO } from "@posterract/contract";
import { BusinessLogo } from "@/components/BusinessLogo";
import type { AnalyticsScope } from "@/engine/store";

/**
 * Which accounts Analytics covers: every account, one business, or picked
 * accounts (e.g. both Instagram accounts together, or just one). The business
 * menu is always there (it's the same business as the header's); the accounts
 * menu shows once there are two accounts to choose between.
 */
export function ScopeFilters({ businesses, accounts, value, onChange }: {
  businesses: BusinessDTO[];
  accounts: PortalDTO[];
  value: AnalyticsScope;
  onChange: (scope: AnalyticsScope) => void;
}) {
  const businessInputId = useId();
  const [open, setOpen] = useState(false);
  // The menu opens in a layer of its own so the page header (which clips its content) can't cut it off.
  const [anchor, setAnchor] = useState<{ top: number; right: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const business = businesses.find((item) => item.id === value.businessId);
  const choices = accounts.filter((account) =>
    account.status === "connected" &&
    (ANALYTICS_PLATFORM_IDS as readonly PlatformId[]).includes(account.provider) &&
    (!business || business.accountIds.includes(account.id)));
  const picked = value.accountIds ?? choices.map((account) => account.id);
  const label = !value.accountIds
    ? business ? "All its accounts" : "All accounts"
    : picked.length === 1
      ? choices.find((account) => account.id === picked[0])?.handle ?? "1 account"
      : `${picked.length} accounts`;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = button.current?.getBoundingClientRect();
      if (box) setAnchor({ top: box.bottom + 6, right: Math.max(8, window.innerWidth - box.right) });
    };
    place();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id];
    if (next.length === 0) return;
    onChange({ ...value, accountIds: next.length === choices.length ? undefined : next });
  };

  return (
    <div className="flex items-center gap-2">
      <label className="flex h-11 items-center gap-2 rounded-[10px] bg-void-2/80 px-3" htmlFor={businessInputId}>
        {business ? <BusinessLogo name={business.name} logoUrl={business.logoUrl} size={18} /> : <span className="kicker !text-[9px]">Business</span>}
        <select
          id={businessInputId}
          aria-label="Business"
          value={value.businessId ?? ""}
          onChange={(event) => onChange({ businessId: event.target.value || undefined })}
          className="h-9 max-w-[180px] bg-transparent font-display text-[12px] text-starlight outline-none"
        >
          <option value="">All businesses</option>
          {businesses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {businesses.length === 0 && <Link to="/portals" className="whitespace-nowrap text-[11px] text-neon underline-offset-2 hover:underline">Create one</Link>}
      </label>
      {choices.length > 1 && (
        <div className="relative">
          <button
            ref={button}
            type="button"
            aria-haspopup="true"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex h-11 items-center gap-2 rounded-[10px] bg-void-2/80 px-3 font-display text-[12px] text-starlight"
          >
            <span className="kicker !text-[9px]">Accounts</span>
            <span className="max-w-[140px] truncate">{label}</span>
            <ChevronDown size={13} className="text-starlight-faint" />
          </button>
          {open && anchor && createPortal(
            <div ref={panel} role="group" aria-label="Accounts to show" style={{ top: anchor.top, right: anchor.right }} className="fixed z-[var(--z-modal)] max-h-[60vh] w-72 overflow-y-auto rounded-[14px] border border-white/[0.1] bg-[rgba(5,12,10,.97)] p-2 shadow-[0_18px_60px_rgba(0,0,0,.6)] backdrop-blur">
              <button type="button" onClick={() => onChange({ ...value, accountIds: undefined })} className="mb-1 w-full rounded-[8px] px-2 py-1.5 text-left text-[12px] text-neon hover:bg-white/[0.04]">
                {business ? `All of ${business.name}` : "All accounts"}
              </button>
              {(ANALYTICS_PLATFORM_IDS as readonly PlatformId[]).filter((provider) => choices.some((account) => account.provider === provider)).map((provider) => (
                <div key={provider} className="mt-1">
                  <p className="flex items-center gap-1.5 px-2 py-1"><PlatformBrandMark platform={provider} height={12} /><span className="kicker !text-[8.5px]">{PLATFORM_CAPABILITIES[provider].label}</span></p>
                  {choices.filter((account) => account.provider === provider).map((account) => (
                    <div key={account.id} className="group flex items-center gap-2 rounded-[8px] px-2 py-1 hover:bg-white/[0.04]">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12px] text-starlight">
                        <input type="checkbox" checked={picked.includes(account.id)} onChange={() => toggle(account.id)} className="accent-[#65ff9a]" />
                        <span className="truncate">{account.displayName || account.handle}{account.displayName && account.handle !== account.displayName ? <span className="text-starlight-faint"> · {account.handle}</span> : null}</span>
                      </label>
                      <button type="button" onClick={() => onChange({ ...value, accountIds: [account.id] })} className="text-[10px] text-starlight-faint opacity-0 transition-opacity hover:text-neon group-hover:opacity-100 focus:opacity-100">Only</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )}
        </div>
      )}
    </div>
  );
}

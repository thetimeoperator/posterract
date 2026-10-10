import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Pencil, Plus, Trash2, Unplug, Users } from "lucide-react";
import clsx from "clsx";
import { Button, Input, Modal, Panel, PlatformBrandMark, pushSignal } from "@posterract/hyperkit";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_IDS,
  type AccountLimitDTO,
  type BusinessDTO,
  type PlatformId,
  type PortalDTO,
  type SavagesPlanId,
} from "@posterract/contract";
import {
  fetchSavagesPlans,
  startSavagesCheckout,
  useAccountLimit,
  useBusinessActions,
  useBusinesses,
  useEngineActions,
  useEngineRefresh,
  useOAuth,
  usePortals,
} from "@/engine/useEngine";
import { money, toPlans, type SavagesPlans } from "@/lib/savages";
import { BusinessLogo, logoDataUrl } from "@/components/BusinessLogo";
import { openExternalUrl } from "@/lib/desktop";

export const Route = createFileRoute("/_app/portals")({ component: Portals });

const PLATFORM_ORDER = PLATFORM_IDS as readonly PlatformId[];

function AccountAvatar({ account, size = "md" }: { account: PortalDTO; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const initial = (account.displayName || account.handle || account.provider).replace(/^@/, "").slice(0, 1).toUpperCase();
  return (
    <span aria-hidden="true" className={clsx("relative flex flex-none items-center justify-center overflow-hidden rounded-full border border-white/[0.12] bg-void-2 font-display font-semibold text-neon shadow-[0_0_18px_rgba(101,255,154,0.08)]", dimension)}>
      {account.avatarUrl && !failed ? (
        <img src={account.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={size === "sm" ? "text-[10px]" : "text-[12px]"}>{initial}</span>
      )}
    </span>
  );
}

function AccountStack({ accounts }: { accounts: PortalDTO[] }) {
  return <div className="flex -space-x-2">{accounts.slice(0, 6).map((account) => <AccountAvatar key={account.id} account={account} size="sm" />)}</div>;
}

type BusinessDraft = { id?: string; name: string; accountIds: string[]; logoUrl?: string; logo?: string | null };

function draftFor(business?: BusinessDTO): BusinessDraft {
  return { id: business?.id, name: business?.name ?? "", accountIds: business?.accountIds ?? [], logoUrl: business?.logoUrl };
}

function BusinessEditor({ draft, accounts, busy, onChange, onClose, onSave }: {
  draft?: BusinessDraft;
  accounts: PortalDTO[];
  busy: boolean;
  onChange: (draft: BusinessDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  if (!draft) return null;
  // Connected accounts, plus any account already in the business that has since disconnected.
  const choices = accounts.filter((account) => account.status === "connected" || draft.accountIds.includes(account.id));
  const providers = PLATFORM_ORDER.filter((provider) => choices.some((account) => account.provider === provider));
  const toggle = (id: string) => onChange({
    ...draft,
    accountIds: draft.accountIds.includes(id) ? draft.accountIds.filter((item) => item !== id) : [...draft.accountIds, id],
  });
  const shownLogo = draft.logo === null ? undefined : draft.logo ?? draft.logoUrl;
  const pickLogo = async (file?: File) => {
    if (!file) return;
    try {
      onChange({ ...draft, logo: await logoDataUrl(file) });
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not use that picture", detail: error instanceof Error ? error.message : undefined });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      kicker={draft.id ? "Edit business" : "New business"}
      title="A group of your accounts"
      width="max-w-2xl"
      footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft.name.trim()} onClick={onSave}>{draft.id ? "Save changes" : "Create business"}</Button></>}
    >
      <div className="space-y-5">
        <div className="flex items-end gap-4">
          <div className="flex flex-col items-center gap-2">
            <BusinessLogo name={draft.name || "?"} logoUrl={shownLogo} size={56} />
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Business logo" onChange={(event) => { void pickLogo(event.target.files?.[0]); event.target.value = ""; }} />
            <div className="flex gap-1">
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-[8px] px-2 py-1 text-[10px] text-neon hover:bg-neon/[0.06]">{shownLogo ? "Change logo" : "Add logo"}</button>
              {shownLogo && <button type="button" onClick={() => onChange({ ...draft, logo: null })} className="rounded-[8px] px-2 py-1 text-[10px] text-starlight-faint hover:bg-white/[0.05] hover:text-starlight">Remove</button>}
            </div>
          </div>
          <div className="flex-1"><Input label="Business name" placeholder="Pissed Off Sofia, Client A, Personal…" maxLength={80} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></div>
        </div>
        {providers.length === 0 ? (
          <p className="rounded-[13px] border border-dashed border-white/[0.08] px-4 py-5 text-center text-[11px] text-starlight-faint">Connect accounts below, then add them to this business.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.map((provider) => (
              <fieldset key={provider} className="rounded-[14px] border border-white/[0.08] bg-white/[0.018] p-3">
                <legend className="sr-only">{PLATFORM_CAPABILITIES[provider].label} accounts</legend>
                <span className="mb-2 flex items-center gap-2"><PlatformBrandMark platform={provider} height={15} /><span className="kicker !text-[9px]">{PLATFORM_CAPABILITIES[provider].label}</span></span>
                <div className="space-y-1">
                  {choices.filter((account) => account.provider === provider).map((account) => (
                    <label key={account.id} className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
                      <input type="checkbox" checked={draft.accountIds.includes(account.id)} onChange={() => toggle(account.id)} className="accent-[#65ff9a]" />
                      <AccountAvatar account={account} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-starlight">{account.displayName || account.handle}{account.displayName && account.handle !== account.displayName ? <span className="text-starlight-faint"> · {account.handle}</span> : null}{account.status !== "connected" && <span className="text-solar"> (disconnected)</span>}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-starlight-faint">Posting to a business posts to every account in it. An account can be in more than one business.</p>
      </div>
    </Modal>
  );
}

const UPGRADE_PLANS: Array<{ id: SavagesPlanId; name: string; suffix: string }> = [
  { id: "monthly", name: "Monthly", suffix: "/mo" },
  { id: "yearly", name: "Yearly", suffix: "/yr" },
  { id: "lifetime", name: "Lifetime", suffix: " once" },
];

/** At the limit. Pro is offered AI FOR SAVAGES (100 accounts): one button per plan, straight to Stripe. */
function AccountLimitNotice({ limit }: { limit: AccountLimitDTO }) {
  const [plans, setPlans] = useState<SavagesPlans>();
  const [busy, setBusy] = useState<SavagesPlanId>();
  const member = limit.plan === "aiforsavages";

  useEffect(() => {
    if (member) return;
    let live = true;
    void fetchSavagesPlans()
      .then((result) => {
        if (live) setPlans(toPlans(result.plans));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [member]);

  if (member) {
    return (
      <p className="mb-3 rounded-[13px] border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[11px] text-starlight-dim">
        All {limit.max} of your account slots are in use. Disconnect an account to add another.
      </p>
    );
  }

  const join = async (plan: SavagesPlanId) => {
    if (busy) return;
    setBusy(plan);
    try {
      const { url } = await startSavagesCheckout(plan);
      await openExternalUrl(url);
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Couldn’t open checkout",
        detail: error instanceof Error ? error.message.replaceAll("_", " ") : undefined,
      });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#64d2ff]/25 bg-[#64d2ff]/[0.05] px-4 py-3">
      <p className="min-w-0 flex-1 text-[12px] text-starlight">
        All {limit.max} of your Pro account slots are in use.{" "}
        <span className="text-starlight-faint">Disconnect one to add another, or join AI FOR SAVAGES to connect up to 100.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {UPGRADE_PLANS.map((item) => {
          const amount = plans?.[item.id];
          return (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === "monthly" ? "primary" : "secondary"}
              disabled={Boolean(busy)}
              onClick={() => void join(item.id)}
            >
              {busy === item.id ? "Opening…" : amount ? `${money(amount)}${item.suffix}` : item.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function Portals() {
  const portals = usePortals();
  const businesses = useBusinesses();
  const businessActions = useBusinessActions();
  const { setPortalStatus } = useEngineActions();
  const oauth = useOAuth();
  const navigate = useNavigate();
  const accountLimit = useAccountLimit();
  const refreshEngine = useEngineRefresh();
  const atLimit = accountLimit ? accountLimit.used >= accountLimit.max : false;

  // Back from Stripe after joining AI FOR SAVAGES. The membership is usually
  // in before Stripe redirects (it waits for the webhook); read the new limit
  // now and twice more in case it was a moment late.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("savages") !== "joined") return;
    void navigate({ to: "/portals", replace: true });
    pushSignal({ tone: "success", title: "Welcome to AI FOR SAVAGES", detail: "Your workspace can now connect up to 100 accounts." });
    void refreshEngine();
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refreshEngine();
      if (tries >= 2) window.clearInterval(timer);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [navigate, refreshEngine]);
  const [draft, setDraft] = useState<BusinessDraft>();
  const [deleting, setDeleting] = useState<BusinessDTO>();
  // Modal focus initialization depends on onClose; keep it stable while typing.
  const closeEditor = useCallback(() => setDraft(undefined), []);
  const closeDelete = useCallback(() => setDeleting(undefined), []);
  const [busy, setBusy] = useState(false);
  const actualAccounts = useMemo(() => portals.filter((account) => Boolean(account.providerAccountId)), [portals]);
  const connectedAccounts = actualAccounts.filter((account) => account.status === "connected");
  const accountIdentityKey = actualAccounts.map((account) => account.id).sort().join(":");

  useEffect(() => {
    if (!accountIdentityKey) return;
    void oauth.refreshProfiles().catch((error) => {
      console.error("Social account profile refresh failed", error);
    });
  }, [accountIdentityKey]);

  const connect = async (provider: PlatformId) => {
    if (oauth.supported.has(provider)) {
      const { url } = await oauth.start(provider);
      if (url) await openExternalUrl(url);
      return;
    }
    setPortalStatus(provider, "connected");
    pushSignal({ tone: "success", title: `${PLATFORM_CAPABILITIES[provider].label} connected in demo` });
  };

  const saveBusiness = async () => {
    if (!draft) return;
    setBusy(true);
    const input = { name: draft.name.trim(), accountIds: draft.accountIds, ...(draft.logo !== undefined ? { logo: draft.logo } : {}) };
    try {
      if (draft.id) await businessActions.update(draft.id, input);
      else await businessActions.create(input);
      pushSignal({ tone: "success", title: draft.id ? "Business updated" : "Business created", detail: input.name });
      setDraft(undefined);
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not save business", detail: error instanceof Error ? error.message.replaceAll("_", " ") : undefined });
    } finally {
      setBusy(false);
    }
  };

  const deleteBusiness = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await businessActions.remove(deleting.id);
      pushSignal({ tone: "info", title: "Business deleted", detail: deleting.name });
      setDeleting(undefined);
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not delete business", detail: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        kicker="Your groups of accounts"
        title="Businesses"
        brackets
        shimmer
        actions={<Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setDraft(draftFor())}>New business</Button>}
        className="overflow-hidden border-neon/20 bg-[radial-gradient(circle_at_10%_0%,rgba(101,255,154,0.075),transparent_34%),var(--glass-bg)]"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/[0.07] bg-black/10 px-4 py-3">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-neon/20 bg-neon/[0.055] text-neon"><Building2 size={16} /></span><div><p className="text-[12px] text-starlight">Group your accounts by brand or client.</p><p className="mt-0.5 text-[10px] text-starlight-faint">Posting to a business posts to every account in it · analytics can show one business</p></div></div>
          <span className="telemetry text-[10px] text-starlight-faint">{businesses.length} BUSINESS{businesses.length === 1 ? "" : "ES"}</span>
        </div>
        {businesses.length === 0 ? (
          <button type="button" onClick={() => setDraft(draftFor())} className="flex w-full items-center justify-center gap-3 rounded-[16px] border border-dashed border-white/[0.11] px-4 py-7 text-left transition-colors hover:border-neon/25 hover:bg-neon/[0.025]"><Users size={18} className="text-neon" /><span><span className="block text-[12px] font-medium text-starlight">Create your first business</span><span className="mt-0.5 block text-[10px] text-starlight-faint">Give it a name and a logo, and add the accounts that belong to it.</span></span></button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {businesses.map((business) => (
              <article key={business.id} className="group rounded-[16px] border border-white/[0.09] bg-white/[0.018] p-4 transition-all hover:-translate-y-0.5 hover:border-neon/25 hover:shadow-glow-neon-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3"><BusinessLogo name={business.name} logoUrl={business.logoUrl} size={36} /><div className="min-w-0"><p className="truncate font-display text-[14px] font-semibold text-starlight">{business.name}</p><p className="telemetry mt-1 text-[9px] text-starlight-faint">{business.accounts.length} ACCOUNT{business.accounts.length === 1 ? "" : "S"}</p></div></div>
                  <div className="flex gap-1 opacity-70 transition-opacity group-hover:opacity-100"><button type="button" aria-label={`Edit ${business.name}`} onClick={() => setDraft(draftFor(business))} className="rounded-[8px] p-1.5 text-starlight-faint hover:bg-white/[0.05] hover:text-starlight"><Pencil size={12} /></button><button type="button" aria-label={`Delete ${business.name}`} onClick={() => setDeleting(business)} className="rounded-[8px] p-1.5 text-starlight-faint hover:bg-redshift/[0.08] hover:text-redshift"><Trash2 size={12} /></button></div>
                </div>
                <div className="mt-5 flex items-end justify-between gap-3">{business.accounts.length ? <AccountStack accounts={business.accounts} /> : <span className="text-[10px] text-starlight-faint">No accounts yet</span>}{business.accounts.some((account) => account.status !== "connected") && <span className="telemetry text-[9px] text-solar">◐ RECONNECT</span>}</div>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <div>
        <div className="mb-3 flex items-end justify-between gap-3 px-1"><div><p className="kicker">Connected identities</p><h2 className="mt-1 font-display text-[17px] font-semibold text-starlight">{accountLimit ? `${accountLimit.used} of ${accountLimit.max} accounts` : "Your accounts"}</h2></div><span className="telemetry text-[10px] text-starlight-faint">{connectedAccounts.length} CONNECTED</span></div>
        {atLimit && accountLimit && <AccountLimitNotice limit={accountLimit} />}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {PLATFORM_ORDER.map((provider) => {
            const caps = PLATFORM_CAPABILITIES[provider];
            const accounts = actualAccounts.filter((account) => account.provider === provider);
            const connected = accounts.filter((account) => account.status === "connected");
            const supported = oauth.supported.has(provider);
            const limitReached = atLimit;
            return (
              <Panel key={provider} brackets className={clsx("relative overflow-hidden", connected.length > 0 && "border-neon/20")} actions={<span className="telemetry text-[9px] text-starlight-faint">{connected.length}</span>}>
                <div className="mb-3 flex items-center gap-3"><span className="flex h-9 w-10 items-center justify-center rounded-[11px] border border-white/[0.08] bg-white/[0.02]"><PlatformBrandMark platform={provider} height={20} /></span><div className="min-w-0 flex-1"><p className="font-display text-[14px] font-semibold text-starlight">{caps.label}</p><p className="text-[10px] text-starlight-faint">{connected.length ? `${connected.length} publishing ${connected.length === 1 ? "identity" : "identities"}` : supported ? "No account connected yet" : "Connection not available yet"}</p></div>{supported && <Button size="sm" variant={connected.length ? "secondary" : "primary"} icon={<Plus size={12} />} disabled={limitReached} onClick={() => void connect(provider)}>{limitReached ? "Limit reached" : connected.length ? "Add account" : "Connect"}</Button>}</div>
                {accounts.length === 0 ? (
                  <div className="rounded-[13px] border border-dashed border-white/[0.08] px-4 py-5 text-center text-[10px] text-starlight-faint">{supported ? `Connect ${caps.label} to add it to a business.` : `${caps.label} support is reserved for a future release.`}</div>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <div key={account.id} className="flex items-center gap-3 rounded-[14px] border border-white/[0.075] bg-black/10 px-3 py-2.5"><AccountAvatar account={account} /><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-starlight">{account.displayName || account.handle}</p><p className="telemetry mt-0.5 truncate text-[9px] text-starlight-faint">{account.handle} · {account.providerAccountId.slice(0, 12)}</p></div><span className={clsx("telemetry text-[8.5px]", account.status === "connected" ? "text-auroral" : account.status === "needs_reauth" ? "text-solar" : "text-starlight-faint")}>{account.status === "connected" ? "● CONNECTED" : account.status.replaceAll("_", " ").toUpperCase()}</span>{account.status === "connected" ? <button type="button" aria-label={`Disconnect ${account.handle}`} onClick={() => void oauth.disconnect(account.id).then(() => pushSignal({ tone: "info", title: `${caps.label} account disconnected`, detail: account.handle })).catch((error) => pushSignal({ tone: "danger", title: "Could not disconnect account", detail: error instanceof Error ? error.message : undefined }))} className="rounded-[9px] p-2 text-starlight-faint transition-colors hover:bg-redshift/[0.07] hover:text-redshift"><Unplug size={13} /></button> : supported ? <Button size="sm" variant="secondary" onClick={() => void connect(provider)}>Reconnect</Button> : null}</div>
                    ))}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      </div>

      <BusinessEditor draft={draft} accounts={actualAccounts} busy={busy} onChange={setDraft} onClose={closeEditor} onSave={() => void saveBusiness()} />
      <Modal
        open={Boolean(deleting)}
        onClose={closeDelete}
        kicker="Delete business"
        title={deleting ? `Delete ${deleting.name}?` : ""}
        footer={<><Button variant="tertiary" onClick={closeDelete}>Keep it</Button><Button variant="destructive" loading={busy} onClick={() => void deleteBusiness()}>Delete</Button></>}
      >
        <p className="text-[13px] text-starlight-dim">Its accounts stay connected and its posts stay on the calendar. Only the group goes away.</p>
      </Modal>
    </div>
  );
}

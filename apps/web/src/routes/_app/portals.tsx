import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Layers3, Pencil, Plus, Trash2, Unplug, Users } from "lucide-react";
import clsx from "clsx";
import { Button, Input, Modal, Panel, PlatformBrandMark, pushSignal } from "@posterract/hyperkit";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_IDS,
  type AccountSetDTO,
  type PlatformId,
  type PortalDTO,
} from "@posterract/contract";
import {
  useAccountSetActions,
  useAccountSets,
  useEngineActions,
  useOAuth,
  usePortals,
} from "@/engine/useEngine";
import { openExternalUrl } from "@/lib/desktop";

export const Route = createFileRoute("/_app/portals")({ component: Portals });

const MAX_ACCOUNTS_PER_PLATFORM = 10;
const PLATFORM_ORDER = PLATFORM_IDS as readonly PlatformId[];

function AccountAvatar({ account, size = "md" }: { account: PortalDTO; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const initial = (account.displayName || account.handle || account.provider).replace(/^@/, "").slice(0, 1).toUpperCase();
  return (
    <span className={clsx("relative flex flex-none items-center justify-center overflow-hidden rounded-full border border-white/[0.12] bg-void-2 font-display font-semibold text-neon shadow-[0_0_18px_rgba(101,255,154,0.08)]", dimension)}>
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

type SetDraft = { id?: string; name: string; selected: Partial<Record<PlatformId, string>> };

function draftFor(set?: AccountSetDTO): SetDraft {
  return {
    id: set?.id,
    name: set?.name ?? "",
    selected: Object.fromEntries((set?.accounts ?? []).map((account) => [account.provider, account.id])),
  };
}

function AccountSetEditor({ draft, accounts, busy, onChange, onClose, onSave }: {
  draft?: SetDraft;
  accounts: PortalDTO[];
  busy: boolean;
  onChange: (draft: SetDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!draft) return null;
  const availableProviders = PLATFORM_ORDER.filter((provider) => accounts.some((account) => account.provider === provider && account.status === "connected"));
  const selectedAccounts = Object.values(draft.selected).filter(Boolean);
  return (
    <Modal
      open
      onClose={onClose}
      kicker={draft.id ? "Edit account set" : "New account set"}
      title="Build one reusable publishing target"
      width="max-w-2xl"
      footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft.name.trim() || selectedAccounts.length === 0} onClick={onSave}>{draft.id ? "Save changes" : "Create account set"}</Button></>}
    >
      <div className="space-y-5">
        <Input label="Set name" placeholder="Main brand, Client A, Personal…" maxLength={80} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        <div className="grid gap-2 sm:grid-cols-2">
          {availableProviders.map((provider) => {
            const providerAccounts = accounts.filter((account) => account.provider === provider && account.status === "connected");
            return (
              <label key={provider} className="rounded-[14px] border border-white/[0.08] bg-white/[0.018] p-3 transition-colors focus-within:border-neon/30">
                <span className="mb-2 flex items-center gap-2"><PlatformBrandMark platform={provider} height={15} /><span className="kicker !text-[9px]">{PLATFORM_CAPABILITIES[provider].label}</span></span>
                <select
                  value={draft.selected[provider] ?? ""}
                  onChange={(event) => onChange({ ...draft, selected: { ...draft.selected, [provider]: event.target.value || undefined } })}
                  className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-void-2 px-3 text-[12px] text-starlight outline-none focus:border-neon/30"
                >
                  <option value="">Do not include</option>
                  {providerAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.handle} · {account.handle}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <p className="text-[11px] leading-relaxed text-starlight-faint">A set holds at most one account from each network. Agents can send its ID as <code className="text-neon">accountSetId</code> and still choose a subset of its platforms per post.</p>
      </div>
    </Modal>
  );
}

function Portals() {
  const portals = usePortals();
  const accountSets = useAccountSets();
  const setActions = useAccountSetActions();
  const { setPortalStatus } = useEngineActions();
  const oauth = useOAuth();
  const [draft, setDraft] = useState<SetDraft>();
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

  const saveSet = async () => {
    if (!draft) return;
    setBusy(true);
    const input = { name: draft.name.trim(), accountIds: Object.values(draft.selected).filter((id): id is string => Boolean(id)) };
    try {
      if (draft.id) await setActions.update(draft.id, input);
      else await setActions.create(input);
      pushSignal({ tone: "success", title: draft.id ? "Account set updated" : "Account set created", detail: input.name });
      setDraft(undefined);
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not save account set", detail: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        kicker="Publishing identity layer"
        title="Account sets"
        brackets
        shimmer
        actions={<Button size="sm" variant="primary" icon={<Plus size={13} />} disabled={connectedAccounts.length === 0} onClick={() => setDraft(draftFor())}>New set</Button>}
        className="overflow-hidden border-neon/20 bg-[radial-gradient(circle_at_10%_0%,rgba(101,255,154,0.075),transparent_34%),var(--glass-bg)]"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/[0.07] bg-black/10 px-4 py-3">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-neon/20 bg-neon/[0.055] text-neon"><Layers3 size={16} /></span><div><p className="text-[12px] text-starlight">Name once. Target precisely from the app or agent API.</p><p className="mt-0.5 text-[10px] text-starlight-faint">One account per network inside each set · reusable across every post</p></div></div>
          <span className="telemetry text-[10px] text-starlight-faint">{accountSets.length} SET{accountSets.length === 1 ? "" : "S"}</span>
        </div>
        {accountSets.length === 0 ? (
          <button type="button" disabled={connectedAccounts.length === 0} onClick={() => setDraft(draftFor())} className="flex w-full items-center justify-center gap-3 rounded-[16px] border border-dashed border-white/[0.11] px-4 py-7 text-left transition-colors hover:border-neon/25 hover:bg-neon/[0.025] disabled:cursor-not-allowed disabled:opacity-50"><Users size={18} className="text-neon" /><span><span className="block text-[12px] font-medium text-starlight">Create your first account set</span><span className="mt-0.5 block text-[10px] text-starlight-faint">Connect at least one account, then group the identities an agent should use.</span></span></button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accountSets.map((set) => (
              <article key={set.id} className="group rounded-[16px] border border-white/[0.09] bg-white/[0.018] p-4 transition-all hover:-translate-y-0.5 hover:border-neon/25 hover:shadow-glow-neon-sm">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-display text-[14px] font-semibold text-starlight">{set.name}</p><p className="telemetry mt-1 text-[9px] text-starlight-faint">{set.accounts.length} NETWORK{set.accounts.length === 1 ? "" : "S"} · {set.id.slice(0, 8)}</p></div><div className="flex gap-1 opacity-70 transition-opacity group-hover:opacity-100"><button type="button" aria-label={`Edit ${set.name}`} onClick={() => setDraft(draftFor(set))} className="rounded-[8px] p-1.5 text-starlight-faint hover:bg-white/[0.05] hover:text-starlight"><Pencil size={12} /></button><button type="button" aria-label={`Delete ${set.name}`} onClick={() => void setActions.remove(set.id).then(() => pushSignal({ tone: "info", title: "Account set deleted", detail: set.name })).catch((error) => pushSignal({ tone: "danger", title: "Could not delete set", detail: error instanceof Error ? error.message : undefined }))} className="rounded-[8px] p-1.5 text-starlight-faint hover:bg-redshift/[0.08] hover:text-redshift"><Trash2 size={12} /></button></div></div>
                <div className="mt-5 flex items-end justify-between gap-3"><AccountStack accounts={set.accounts} /><span className={clsx("telemetry text-[9px]", set.accounts.every((account) => account.status === "connected") ? "text-auroral" : "text-solar")}>{set.accounts.every((account) => account.status === "connected") ? "● READY" : "◐ ATTENTION"}</span></div>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <div>
        <div className="mb-3 flex items-end justify-between gap-3 px-1"><div><p className="kicker">Connected identities</p><h2 className="mt-1 font-display text-[17px] font-semibold text-starlight">Up to 10 accounts per network</h2></div><span className="telemetry text-[10px] text-starlight-faint">{connectedAccounts.length} CONNECTED</span></div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {PLATFORM_ORDER.map((provider) => {
            const caps = PLATFORM_CAPABILITIES[provider];
            const accounts = actualAccounts.filter((account) => account.provider === provider);
            const connected = accounts.filter((account) => account.status === "connected");
            const supported = oauth.supported.has(provider);
            const limitReached = connected.length >= MAX_ACCOUNTS_PER_PLATFORM;
            return (
              <Panel key={provider} brackets className={clsx("relative overflow-hidden", connected.length > 0 && "border-neon/20")} actions={<span className="telemetry text-[9px] text-starlight-faint">{connected.length}/{MAX_ACCOUNTS_PER_PLATFORM}</span>}>
                <div className="mb-3 flex items-center gap-3"><span className="flex h-9 w-10 items-center justify-center rounded-[11px] border border-white/[0.08] bg-white/[0.02]"><PlatformBrandMark platform={provider} height={20} /></span><div className="min-w-0 flex-1"><p className="font-display text-[14px] font-semibold text-starlight">{caps.label}</p><p className="text-[10px] text-starlight-faint">{connected.length ? `${connected.length} publishing ${connected.length === 1 ? "identity" : "identities"}` : supported ? "No account connected yet" : "Connection not available yet"}</p></div>{supported && <Button size="sm" variant={connected.length ? "secondary" : "primary"} icon={<Plus size={12} />} disabled={limitReached} onClick={() => void connect(provider)}>{limitReached ? "Limit reached" : connected.length ? "Add account" : "Connect"}</Button>}</div>
                {accounts.length === 0 ? (
                  <div className="rounded-[13px] border border-dashed border-white/[0.08] px-4 py-5 text-center text-[10px] text-starlight-faint">{supported ? `Connect ${caps.label} to add it to an account set.` : `${caps.label} support is reserved for a future release.`}</div>
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

      <AccountSetEditor draft={draft} accounts={actualAccounts} busy={busy} onChange={setDraft} onClose={() => setDraft(undefined)} onSave={() => void saveSet()} />
    </div>
  );
}

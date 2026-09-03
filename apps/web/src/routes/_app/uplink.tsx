import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Bot, Check, Copy, KeyRound, Plus, Send, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { Button, Panel, pushSignal } from "@posterract/hyperkit";
import { LiquidSurface } from "@/components/LiquidSurface";
import { LocalAgentConnection } from "@/components/LocalAgentConnection";
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  REMOTE_HARNESS,
  revokeWorkspaceApiKey,
  type WorkspaceApiKey,
} from "@/harness/client";

export const Route = createFileRoute("/_app/uplink")({ component: ApiKeysPage });

const SCOPES = [
  ["accounts:read", "Read connected accounts"],
  ["media:write", "Upload media to R2"],
  ["posts:read", "Read history and status"],
  ["posts:write", "Create and schedule posts"],
  ["analytics:read", "Read approved analytics"],
] as const;

const CURL_EXAMPLE = `curl -X POST https://api.posterract.app/v1/posts \\
  -H "Authorization: Bearer pr_••••••••••••" \\
  -H "Idempotency-Key: post-2026-08-21-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "artifactId": "MEDIA_UUID",
    "title": "Launch post",
    "caption": "The launch is live.",
    "accountSetId": "ACCOUNT_SET_UUID",
    "platforms": ["instagram", "tiktok"],
    "scheduledFor": "2026-08-21T18:00:00Z"
  }'`;

const EMPTY_STATS: WorkspaceApiKey["stats"] = {
  apiActions: 0,
  postsCreated: 0,
  postsScheduled: 0,
  postsPublished: 0,
};

function ApiKeysPage() {
  const [keys, setKeys] = useState<WorkspaceApiKey[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  useEffect(() => {
    if (!REMOTE_HARNESS) return;
    void listWorkspaceApiKeys()
      .then(setKeys)
      .catch(() => pushSignal({ tone: "danger", title: "Could not load API keys" }));
  }, []);

  const totals = useMemo(
    () =>
      keys.reduce(
        (sum, key) => {
          const stats = key.stats ?? EMPTY_STATS;
          return {
            published: sum.published + stats.postsPublished,
            created: sum.created + stats.postsCreated,
            actions: sum.actions + stats.apiActions,
          };
        },
        { published: 0, created: 0, actions: 0 },
      ),
    [keys],
  );

  const revoke = async (id: string) => {
    try {
      if (REMOTE_HARNESS) await revokeWorkspaceApiKey(id);
      setKeys((current) => current.filter((key) => key.id !== id));
      pushSignal({ tone: "info", title: "API key revoked" });
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Could not revoke key",
        detail: error instanceof Error ? error.message : "Try again.",
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-neon/25 bg-neon/[0.06] text-neon">
              <Bot size={16} />
            </span>
            <p className="kicker !text-neon">Agent connection</p>
          </div>
          <h1 className="mt-3 font-display text-[clamp(24px,3vw,38px)] font-semibold tracking-[-0.03em] text-starlight">
            Agents & API keys
          </h1>
          <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-starlight-dim">
            Connect a local coding agent to the desktop editor, or create cloud API keys for posting,
            scheduling, and analytics. These are separate, secure connections.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="calendar-new-post-cta api-key-create-cta"
            aria-label="Create API key"
          >
            <span className="calendar-new-post-cta__icon" aria-hidden>
              <KeyRound size={19} strokeWidth={2} />
            </span>
            <span className="calendar-new-post-cta__copy">
              <span className="calendar-new-post-cta__label">Create API key</span>
              <span className="calendar-new-post-cta__meta" aria-hidden>Cloud publishing access</span>
            </span>
            <span className="calendar-new-post-cta__arrow" aria-hidden>
              <ArrowRight size={17} strokeWidth={1.8} />
            </span>
          </button>
        </div>
      </div>

      <LocalAgentConnection />

      <div className="rounded-[14px] border border-white/[0.08] bg-black/10 px-4 py-3 text-[10px] leading-relaxed text-starlight-dim">
        <strong className="text-starlight">Workspace API Keys</strong> control cloud posting, scheduling, and analytics. They do not control local project files or the editor canvas.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active keys" value={keys.length} />
        <Stat label="Published" value={totals.published} detail="platform posts" />
        <Stat label="Posts created" value={totals.created} />
        <Stat label="API actions" value={totals.actions} />
      </div>

      <Panel kicker="Workspace API keys" title="Manage cloud API keys" brackets className="min-w-0">
        {keys.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-[15px] border border-neon/20 bg-neon/[0.05] text-neon">
              <KeyRound size={18} />
            </span>
            <p className="mt-3 font-display text-[13px] font-semibold text-starlight">No API keys yet</p>
            <p className="mt-1 max-w-sm text-[10.5px] text-starlight-faint">
              Create a scoped key, copy it once, and give it to the agent or automation that will publish through Posterract.
            </p>
            <Button className="mt-4" size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => setCreateOpen(true)}>
              Create API key
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {keys.map((key) => {
              const stats = key.stats ?? EMPTY_STATS;
              return (
                <div key={key.id} data-testid="api-key-card" className="rounded-[16px] border border-[var(--glass-border)] bg-black/10 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[12px] bg-neon/[0.06] text-neon">
                      <Bot size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[11.5px] font-semibold text-starlight">{key.name}</p>
                      <p className="mt-0.5 font-mono text-[9.5px] text-starlight-faint">{key.prefix}••••••••••</p>
                    </div>
                    <button
                      onClick={() => void revoke(key.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-[10px] text-starlight-faint hover:bg-redshift/10 hover:text-redshift"
                      aria-label={`Revoke ${key.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.07] py-3">
                    <KeyStat label="Published" value={stats.postsPublished} />
                    <KeyStat label="Created" value={stats.postsCreated} />
                    <KeyStat label="Actions" value={stats.apiActions} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <span key={scope} className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-[8px] text-starlight-faint">
                        {scope}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[8.5px] text-starlight-faint">
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    <span>{key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "Never used"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel kicker="Posting API" title="Schedule from any agent" brackets className="min-w-0">
        <p className="text-[10.5px] leading-relaxed text-starlight-dim">
          Upload media, choose connected platforms, and create or schedule a post with the same API key. Fetch <code className="text-neon">GET /v1/account-sets</code>, then send its ID as <code className="text-neon">accountSetId</code> so the agent uses the exact saved accounts. App-created and API-created posts appear together in the Calendar and Analytics.
        </p>
        <pre className="telemetry mt-4 max-w-full overflow-x-auto rounded-[12px] border border-[var(--glass-border)] bg-void-1 p-4 text-[10px] leading-relaxed text-starlight-dim">
          {CURL_EXAMPLE}
        </pre>
        <div className="mt-3 flex items-center gap-2 text-[9.5px] text-starlight-faint">
          <Send size={13} className="text-neon" /> Use a unique idempotency key for every new post so retries cannot publish duplicates.
        </div>
      </Panel>

      <CreateKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(key, secret) => {
          setKeys((current) => [key, ...current]);
          setCreateOpen(false);
          setRevealedSecret(secret);
        }}
      />
      <SecretDialog secret={revealedSecret} onClose={() => setRevealedSecret(null)} />
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="harness-panel p-4">
      <p className="kicker !text-[8px]">{label}</p>
      <p className="mt-2 font-display text-[24px] font-semibold text-starlight">{value.toLocaleString()}</p>
      {detail && <p className="mt-0.5 text-[8.5px] text-starlight-faint">{detail}</p>}
    </div>
  );
}

function KeyStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-display text-[16px] font-semibold text-starlight">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[8px] uppercase tracking-[0.08em] text-starlight-faint">{label}</p>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: WorkspaceApiKey, secret: string) => void;
}) {
  const [name, setName] = useState("My publishing agent");
  const [scopes, setScopes] = useState<string[]>([
    "accounts:read",
    "media:write",
    "posts:read",
    "posts:write",
    "analytics:read",
  ]);
  const toggle = (scope: string) =>
    setScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    try {
      const result = REMOTE_HARNESS
        ? await createWorkspaceApiKey({ name: name.trim(), scopes })
        : {
            id: crypto.randomUUID(),
            name: name.trim(),
            prefix: "pr_demo_",
            scopes,
            createdAt: Date.now(),
            secret: `pr_demo_${crypto.randomUUID().replaceAll("-", "")}`,
            stats: EMPTY_STATS,
          };
      const { secret, ...key } = result;
      onCreated(key, secret);
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Could not create API key",
        detail: error instanceof Error ? error.message : "Try again.",
      });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <motion.button
            aria-label="Close API key dialog"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="relative w-full max-w-xl"
          >
            <LiquidSurface preset="modal" className="rounded-[24px]">
              <div className="p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.07] text-neon">
                    <Bot size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="kicker !text-neon">Agent access</p>
                    <h2 className="mt-1 font-display text-[18px] font-semibold text-starlight">Create a Posterract API key</h2>
                  </div>
                  <button onClick={onClose} className="text-starlight-faint hover:text-starlight" aria-label="Close">
                    <X size={16} />
                  </button>
                </div>
                <label className="mt-5 block">
                  <span className="kicker !text-[8px]">Key name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/[0.09] bg-black/20 px-3 text-[12px] text-starlight focus:border-white/[0.2] focus:outline-none"
                  />
                </label>
                <p className="kicker mb-2 mt-4 !text-[8px]">Permissions</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPES.map(([scope, label]) => {
                    const active = scopes.includes(scope);
                    return (
                      <button
                        key={scope}
                        onClick={() => toggle(scope)}
                        className={clsx(
                          "flex items-center gap-2 rounded-[11px] border px-3 py-2 text-left",
                          active ? "border-neon/30 bg-neon/[0.05]" : "border-[var(--glass-border)]",
                        )}
                      >
                        <span className={clsx("flex h-4 w-4 items-center justify-center rounded border", active ? "border-neon/50 text-neon" : "border-[var(--glass-border)]")}>
                          {active && <Check size={10} />}
                        </span>
                        <span>
                          <span className="block font-mono text-[9px] text-starlight">{scope}</span>
                          <span className="block text-[8.5px] text-starlight-faint">{label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-end">
                  <Button variant="primary" onClick={() => void create()}>Create key</Button>
                </div>
              </div>
            </LiquidSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <AnimatePresence>
      {secret && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <motion.div className="absolute inset-0 bg-black/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="relative w-full max-w-lg">
            <LiquidSurface preset="modal" className="rounded-[24px]">
              <div className="p-6">
                <p className="kicker !text-neon">Copy it now</p>
                <h2 className="mt-1 font-display text-[18px] font-semibold text-starlight">This key is shown once.</h2>
                <p className="mt-2 text-[10.5px] text-starlight-faint">Posterract stores only its hash. If it is lost, revoke it and create another.</p>
                <div className="mt-4 flex items-center gap-2 rounded-[13px] border border-neon/20 bg-black/25 p-3">
                  <code className="min-w-0 flex-1 overflow-x-auto text-[10px] text-neon">{secret}</code>
                  <button
                    onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-[var(--glass-border)] text-starlight-dim hover:text-neon"
                    aria-label="Copy API key"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="mt-5 flex justify-end"><Button variant="primary" onClick={onClose}>I saved the key</Button></div>
              </div>
            </LiquidSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

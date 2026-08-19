import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Check, Copy, KeyRound, Plus, ShieldCheck, TerminalSquare, Trash2, Webhook, X } from "lucide-react";
import clsx from "clsx";
import { Button, Panel, pushSignal } from "@posterract/hyperkit";
import { LiquidSurface } from "@/components/LiquidSurface";
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  REMOTE_HARNESS,
  revokeWorkspaceApiKey,
  type WorkspaceApiKey,
} from "@/harness/client";

export const Route = createFileRoute("/_app/uplink")({ component: Uplink });

const SCOPES = [
  ["skills:read", "Read skill metadata"],
  ["runs:read", "Read agent runs"],
  ["runs:write", "Run private skills"],
  ["posts:read", "Read history and status"],
  ["posts:write", "Create and schedule posts"],
  ["analytics:read", "Read approved analytics"],
  ["points:read", "Read Resonance Points"],
] as const;

const CURL_EXAMPLE = `curl -X POST https://api.posterract.com/v1/agent-runs \\
  -H "Authorization: Bearer pr_••••••••••••" \\
  -H "Idempotency-Key: run-2026-08-19-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "skillIds": ["hook-architect", "shortform-script"],
    "message": "Create a 30-second launch script for our new product"
  }'`;

function Uplink() {
  const [keys, setKeys] = useState<WorkspaceApiKey[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  useEffect(() => {
    if (!REMOTE_HARNESS) return;
    void listWorkspaceApiKeys().then(setKeys).catch(() => pushSignal({ tone: "danger", title: "Could not load API keys" }));
  }, []);

  const revoke = async (id: string) => {
    try {
      if (REMOTE_HARNESS) await revokeWorkspaceApiKey(id);
      setKeys((current) => current.filter((key) => key.id !== id));
      pushSignal({ tone: "info", title: "API key revoked" });
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not revoke key", detail: error instanceof Error ? error.message : "Try again." });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-neon/25 bg-neon/[0.06] text-neon"><TerminalSquare size={15} /></span><p className="kicker !text-neon">Uplink</p></div>
          <h1 className="mt-3 font-display text-[clamp(24px,3vw,38px)] font-semibold tracking-[-0.03em] text-starlight">Your agents use the same harness.</h1>
          <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-starlight-dim">Issue a scoped Posterract key to Claude, Codex, automations, or your own software. Runs, posts, analytics, and points remain attached to this workspace.</p>
        </div>
        <Button variant="primary" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>Create API key</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel kicker="Workspace access" title="API keys" brackets className="min-w-0">
          {keys.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-[15px] border border-neon/20 bg-neon/[0.05] text-neon"><KeyRound size={18} /></span>
              <p className="mt-3 font-display text-[13px] font-semibold text-starlight">No external agents connected</p>
              <p className="mt-1 max-w-sm text-[10.5px] text-starlight-faint">Create a scoped key, copy it once, and add it to the agent that should operate Posterract.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="rounded-[14px] border border-[var(--glass-border)] bg-black/10 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[11px] bg-neon/[0.06] text-neon"><KeyRound size={14} /></span>
                    <div className="min-w-0 flex-1"><p className="font-display text-[11.5px] font-semibold text-starlight">{key.name}</p><p className="mt-0.5 font-mono text-[9.5px] text-starlight-faint">{key.prefix}••••••••••</p></div>
                    <button onClick={() => void revoke(key.id)} className="flex h-8 w-8 items-center justify-center rounded-[10px] text-starlight-faint hover:bg-redshift/10 hover:text-redshift" aria-label={`Revoke ${key.name}`}><Trash2 size={13} /></button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">{key.scopes.map((scope) => <span key={scope} className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-[8px] text-starlight-faint">{scope}</span>)}</div>
                  <p className="mt-2 text-[8.5px] text-starlight-faint">Created {new Date(key.createdAt).toLocaleDateString()} · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "never used"}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel kicker="Agent quickstart" title="Run a private skill" brackets className="min-w-0">
          <p className="text-[10.5px] leading-relaxed text-starlight-dim">The agent sends skill IDs and inputs. Posterract resolves the private skill version, executes it, and returns only the result and provenance.</p>
          <pre className="telemetry mt-4 max-w-full overflow-x-auto rounded-[12px] border border-[var(--glass-border)] bg-void-1 p-4 text-[10px] leading-relaxed text-starlight-dim">{CURL_EXAMPLE}</pre>
          <div className="mt-3 flex items-center gap-2 text-[9.5px] text-starlight-faint"><ShieldCheck size={13} className="text-neon" /> Raw skill instructions and provider credentials never appear in the API response.</div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Feature icon={<Bot size={15} />} title="Private skill runs" copy="Trigger the same versioned skills available in the Forge." />
        <Feature icon={<Webhook size={15} />} title="Shared events" copy="App and API activity feed one history, schedule, and points ledger." />
        <Feature icon={<TerminalSquare size={15} />} title="Scoped access" copy="Grant only the capabilities each external agent actually needs." />
      </div>

      <CreateKeyDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(key, secret) => { setKeys((current) => [key, ...current]); setCreateOpen(false); setRevealedSecret(secret); }} />
      <SecretDialog secret={revealedSecret} onClose={() => setRevealedSecret(null)} />
    </div>
  );
}

function Feature({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="harness-panel p-4"><span className="text-neon">{icon}</span><p className="mt-2 font-display text-[11.5px] font-semibold text-starlight">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-starlight-faint">{copy}</p></div>;
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: WorkspaceApiKey, secret: string) => void }) {
  const [name, setName] = useState("My external agent");
  const [scopes, setScopes] = useState<string[]>(["skills:read", "runs:read", "runs:write", "posts:read", "posts:write"]);
  const toggle = (scope: string) => setScopes((current) => current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]);
  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    try {
      const result = REMOTE_HARNESS
        ? await createWorkspaceApiKey({ name: name.trim(), scopes })
        : { id: crypto.randomUUID(), name: name.trim(), prefix: "pr_demo_", scopes, createdAt: Date.now(), secret: `pr_demo_${crypto.randomUUID().replaceAll("-", "")}` };
      const { secret, ...key } = result;
      onCreated(key, secret);
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not create API key", detail: error instanceof Error ? error.message : "Try again." });
    }
  };
  return <AnimatePresence>{open && <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"><motion.button aria-label="Close API key dialog" className="absolute inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} /><motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="relative w-full max-w-xl"><LiquidSurface preset="modal" className="rounded-[24px]"><div className="p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.07] text-neon"><KeyRound size={17} /></span><div className="min-w-0 flex-1"><p className="kicker !text-neon">External agent access</p><h2 className="mt-1 font-display text-[18px] font-semibold text-starlight">Create a Posterract API key</h2></div><button onClick={onClose} className="text-starlight-faint hover:text-starlight"><X size={16} /></button></div><label className="mt-5 block"><span className="kicker !text-[8px]">Key name</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-10 w-full rounded-[12px] border border-[var(--glass-border)] bg-black/20 px-3 text-[12px] text-starlight focus:border-neon/40 focus:outline-none" /></label><p className="kicker mb-2 mt-4 !text-[8px]">Scopes</p><div className="grid gap-2 sm:grid-cols-2">{SCOPES.map(([scope, label]) => { const active = scopes.includes(scope); return <button key={scope} onClick={() => toggle(scope)} className={clsx("flex items-center gap-2 rounded-[11px] border px-3 py-2 text-left", active ? "border-neon/30 bg-neon/[0.05]" : "border-[var(--glass-border)]")}><span className={clsx("flex h-4 w-4 items-center justify-center rounded border", active ? "border-neon/50 text-neon" : "border-[var(--glass-border)]")}>{active && <Check size={10} />}</span><span><span className="block font-mono text-[9px] text-starlight">{scope}</span><span className="block text-[8.5px] text-starlight-faint">{label}</span></span></button>; })}</div><div className="mt-5 flex justify-end"><Button variant="primary" onClick={() => void create()}>Create key</Button></div></div></LiquidSurface></motion.div></div>}</AnimatePresence>;
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return <AnimatePresence>{secret && <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"><motion.div className="absolute inset-0 bg-black/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /><motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="relative w-full max-w-lg"><LiquidSurface preset="modal" className="rounded-[24px]"><div className="p-6"><p className="kicker !text-neon">Copy it now</p><h2 className="mt-1 font-display text-[18px] font-semibold text-starlight">This key is shown once.</h2><p className="mt-2 text-[10.5px] text-starlight-faint">Posterract stores only its hash. If it is lost, revoke it and create another.</p><div className="mt-4 flex items-center gap-2 rounded-[13px] border border-neon/20 bg-black/25 p-3"><code className="min-w-0 flex-1 overflow-x-auto text-[10px] text-neon">{secret}</code><button onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))} className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-[var(--glass-border)] text-starlight-dim hover:text-neon" aria-label="Copy API key">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div><div className="mt-5 flex justify-end"><Button variant="primary" onClick={onClose}>I saved the key</Button></div></div></LiquidSurface></motion.div></div>}</AnimatePresence>;
}

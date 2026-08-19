import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  KeyRound,
  Layers3,
  Paperclip,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Button, PlatformBrandMark, pushSignal } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS, type PlatformId } from "@posterract/contract";
import { LiquidSurface } from "@/components/LiquidSurface";
import { AGENT_PROVIDERS, skillById, type AgentProviderId } from "@/harness/catalog";
import { createAgentCredential, deleteAgentCredential, listAgentCredentials, REMOTE_HARNESS, runAgent } from "@/harness/client";
import { usePublicSkills } from "@/harness/usePublicSkills";
import { useHarness } from "@/state/harness";

export const Route = createFileRoute("/_app/forge")({ component: Forge });

function Forge() {
  const skillCatalog = usePublicSkills();
  const credentials = useHarness((state) => state.credentials);
  const activeCredentialId = useHarness((state) => state.activeCredentialId);
  const activeSkillIds = useHarness((state) => state.activeSkillIds);
  const activePlatforms = useHarness((state) => state.activePlatforms);
  const messages = useHarness((state) => state.messages);
  const setActiveCredential = useHarness((state) => state.setActiveCredential);
  const toggleSkill = useHarness((state) => state.toggleSkill);
  const togglePlatform = useHarness((state) => state.togglePlatform);
  const addMessage = useHarness((state) => state.addMessage);
  const clearMessages = useHarness((state) => state.clearMessages);
  const replaceCredentials = useHarness((state) => state.replaceCredentials);
  const removeCredential = useHarness((state) => state.removeCredential);
  const [prompt, setPrompt] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeCredential = credentials.find((credential) => credential.id === activeCredentialId);
  const selectedSkills = activeSkillIds.map((id) => skillCatalog.find((skill) => skill.id === id)).filter(Boolean);
  const latestAgentOutput = [...messages].reverse().find((message) => message.role === "agent" && message.skillIds?.length)?.body;

  const revokeCredential = async (id: string) => {
    try {
      if (REMOTE_HARNESS) await deleteAgentCredential(id);
      removeCredential(id);
      pushSignal({ tone: "info", title: "Agent connection revoked" });
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not revoke agent connection", detail: error instanceof Error ? error.message : "Try again." });
    }
  };

  useEffect(() => {
    if (!REMOTE_HARNESS) return;
    void listAgentCredentials()
      .then(replaceCredentials)
      .catch(() => pushSignal({ tone: "danger", title: "Could not load agent connections" }));
  }, [replaceCredentials]);

  const submit = async () => {
    const value = prompt.trim();
    if (!value) return;
    if (!activeCredential) {
      setConnectOpen(true);
      return;
    }
    addMessage({ role: "user", body: value, skillIds: activeSkillIds });
    setPrompt("");
    setRunning(true);
    try {
      const contextMessage = [
        ...messages.slice(-8).map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}: ${message.body}`),
        `USER: ${value}`,
      ].join("\n\n");
      const body = REMOTE_HARNESS
        ? (await runAgent({ credentialId: activeCredential.id, skillIds: activeSkillIds, message: contextMessage })).output.text
        : await new Promise<string>((resolve) => window.setTimeout(() => resolve(
            `I built a platform-ready content direction for “${value}”. The private skill chain produced a hook, narrative structure, and ${activePlatforms.length || 1} channel adaptation${activePlatforms.length === 1 ? "" : "s"}. Review the structured draft below, then prepare or schedule the post.`,
          ), 850));
      addMessage({ role: "agent", skillIds: activeSkillIds, body });
    } catch (error) {
      pushSignal({ tone: "danger", title: "Agent run failed", detail: error instanceof Error ? error.message : "Try again." });
      addMessage({ role: "agent", body: "The selected agent could not complete this run. Your prompt and private skill source were not exposed. Check the connection and try again." });
    } finally {
      setRunning(false);
      window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    }
  };

  return (
    <div className="forge-grid">
      <aside className="forge-sessions harness-panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-[var(--glass-border)] p-3">
          <button onClick={() => { clearMessages(); setPrompt(""); }} className="flex h-10 w-full items-center justify-center gap-2 rounded-[13px] border border-[rgba(101,255,154,0.28)] bg-neon/[0.07] font-display text-[11px] font-semibold text-neon transition-colors hover:bg-neon/[0.11]">
            <Plus size={14} /> New session
          </button>
        </div>
        <div className="harness-scroll min-h-0 flex-1 overflow-y-auto p-2">
          <p className="kicker px-2 pb-2 pt-1">Recent spaces</p>
          <button className="mb-1 w-full rounded-[13px] bg-white/[0.045] px-3 py-2.5 text-left">
            <span className="block truncate font-display text-[11.5px] font-semibold text-starlight">Current Forge session</span>
            <span className="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-starlight-faint">
              <span className="truncate">{selectedSkills.map((skill) => skill?.name).filter(Boolean).join(" + ") || "No skills loaded"}</span><span>{Math.max(0, messages.length - 1)} turns</span>
            </span>
          </button>
        </div>
        <div className="border-t border-[var(--glass-border)] p-3">
          <div className="flex items-center gap-2 text-[10px] text-starlight-faint">
            <ShieldCheck size={13} className="text-neon" />
            <span>Skill source stays server-side</span>
          </div>
        </div>
      </aside>

      <section className="harness-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="relative z-20 flex flex-wrap items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2.5 sm:px-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setSkillMenuOpen(false);
                if (credentials.length === 0) setConnectOpen(true);
                else setAgentMenuOpen((value) => !value);
              }}
              className="flex h-9 items-center gap-2 rounded-[12px] border border-[var(--glass-border)] bg-white/[0.025] px-3 text-left transition-colors hover:border-[var(--glass-border-bright)]"
            >
              <span className="provider-orb !h-6 !min-w-6 text-[8px] text-neon">{activeCredential ? AGENT_PROVIDERS.find((p) => p.id === activeCredential.provider)?.short : <KeyRound size={12} />}</span>
              <span>
                <span className="block font-display text-[10.5px] font-semibold text-starlight">{activeCredential?.label ?? "Connect agent"}</span>
                <span className="block text-[8.5px] text-starlight-faint">{activeCredential?.model ?? "Use your own key"}</span>
              </span>
              <ChevronDown size={12} className="ml-1 text-starlight-faint" />
            </button>
            <AnimatePresence>
              {agentMenuOpen && (
                <Popover className="left-0 w-[280px]">
                  <p className="kicker px-2 pb-2">Agent connections</p>
                  {credentials.length === 0 ? (
                    <p className="px-2 pb-2 text-[11px] leading-relaxed text-starlight-faint">Connect your own model-provider key to use an agent inside Posterract.</p>
                  ) : credentials.map((credential) => (
                    <div key={credential.id} className="group flex items-center rounded-[11px] hover:bg-white/[0.04]">
                      <button
                        onClick={() => { setActiveCredential(credential.id); setAgentMenuOpen(false); }}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                      >
                        <span className="provider-orb !h-7 !min-w-7 text-[8px] text-neon">{AGENT_PROVIDERS.find((provider) => provider.id === credential.provider)?.short}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] text-starlight">{credential.label}</span>
                          <span className="block truncate text-[9px] text-starlight-faint">{credential.model} · ••••{credential.lastFour}</span>
                        </span>
                        {credential.id === activeCredentialId && <Check size={13} className="text-neon" />}
                      </button>
                      <button type="button" aria-label={`Revoke ${credential.label}`} onClick={() => void revokeCredential(credential.id)} className="mr-1 flex h-7 w-7 items-center justify-center rounded-[9px] text-starlight-faint opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-redshift/10 hover:text-redshift"><Trash2 size={11} /></button>
                    </div>
                  ))}
                  <button onClick={() => { setAgentMenuOpen(false); setConnectOpen(true); }} className="mt-1 flex w-full items-center gap-2 border-t border-[var(--glass-border)] px-2.5 pt-2.5 text-[10.5px] text-neon"><Plus size={12} /> Connect another agent</button>
                </Popover>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => { setSkillMenuOpen((value) => !value); setAgentMenuOpen(false); }}
              className="flex h-9 items-center gap-2 rounded-[12px] border border-[var(--glass-border)] bg-white/[0.025] px-3 text-starlight-dim hover:border-[var(--glass-border-bright)]"
            >
              <Layers3 size={13} className="text-neon" />
              <span className="font-display text-[10.5px] font-semibold">{activeSkillIds.length} skill{activeSkillIds.length === 1 ? "" : "s"}</span>
              <ChevronDown size={12} className="text-starlight-faint" />
            </button>
            <AnimatePresence>
              {skillMenuOpen && (
                <Popover className="left-0 w-[320px]">
                  <div className="flex items-center justify-between px-2 pb-2">
                    <p className="kicker">Private skill stack</p>
                    <Link to="/skills" className="text-[9px] text-neon hover:underline" onClick={() => setSkillMenuOpen(false)}>Browse all</Link>
                  </div>
                  {skillCatalog.slice(0, 5).map((skill) => {
                    const active = activeSkillIds.includes(skill.id);
                    return (
                      <button key={skill.id} onClick={() => toggleSkill(skill.id)} className="flex w-full items-center gap-2 rounded-[11px] px-2.5 py-2 text-left hover:bg-white/[0.04]">
                        <span className="h-2 w-2 rounded-full" style={{ background: skill.accent, boxShadow: `0 0 10px ${skill.accent}` }} />
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-starlight-dim">{skill.name}</span>
                        <span className={clsx("flex h-4 w-4 items-center justify-center rounded border", active ? "border-neon/50 bg-neon/10 text-neon" : "border-[var(--glass-border)]")}>{active && <Check size={10} />}</span>
                      </button>
                    );
                  })}
                </Popover>
              )}
            </AnimatePresence>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {PUBLISHING_PLATFORM_IDS.map((platform) => {
              const active = activePlatforms.includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(platform)}
                  aria-label={`${active ? "Remove" : "Add"} ${PLATFORM_CAPABILITIES[platform].label}`}
                  aria-pressed={active}
                  className={clsx("flex h-8 w-8 items-center justify-center rounded-[10px] border transition-all", active ? "border-neon/40 bg-neon/[0.08] shadow-glow-neon-sm" : "border-[var(--glass-border)] opacity-45 hover:opacity-80")}
                >
                  <PlatformBrandMark platform={platform} height={13} />
                </button>
              );
            })}
          </div>
        </header>

        <div ref={scrollRef} className="harness-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((message) => (
              <MessageBubble key={message.id} role={message.role} body={message.body} skillIds={message.skillIds} />
            ))}
            {running && (
              <div className="flex items-center gap-3 text-[11px] text-starlight-faint">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-neon/30 bg-neon/[0.06] text-neon"><Sparkles size={13} className="animate-pulse" /></span>
                <span className="telemetry">Private skill chain running…</span>
              </div>
            )}
            {latestAgentOutput && !running && (
              <StructuredDraft
                platforms={activePlatforms}
                content={latestAgentOutput}
                onRevise={() => {
                  setPrompt("Revise the last result. Keep what works, then improve: ");
                  window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-forge-prompt]")?.focus());
                }}
              />
            )}
          </div>
        </div>

        <div className="border-t border-[var(--glass-border)] p-3 sm:p-4">
          <LiquidSurface preset="control" enabled={!connectOpen} className="mx-auto max-w-3xl rounded-[20px]">
            <div className="p-2">
              <textarea
                value={prompt}
                data-forge-prompt
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
                }}
                rows={3}
                placeholder={activeCredential ? "Describe the content you want to create…" : "Connect your agent, then start creating…"}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-starlight placeholder:text-starlight-faint focus:outline-none"
              />
              <div className="flex items-center gap-2 px-1">
                <Link to="/vault" className="flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-[10px] text-starlight-faint hover:bg-white/[0.04] hover:text-starlight"><Paperclip size={13} /> Add asset</Link>
                <span className="ml-auto hidden text-[9px] text-starlight-faint sm:block">Enter to send · Shift+Enter for line break</span>
                <button
                  type="button"
                  disabled={!prompt.trim() || running}
                  onClick={() => void submit()}
                  className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-neon text-void-0 shadow-glow-neon-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Run selected skills"
                ><ArrowUp size={15} strokeWidth={2.4} /></button>
              </div>
            </div>
          </LiquidSurface>
        </div>
      </section>

      <aside className="forge-inspector harness-panel harness-scroll min-h-0 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <p className="kicker">Run context</p>
          <span className="rounded-full border border-neon/25 bg-neon/[0.06] px-2 py-0.5 text-[8px] text-neon">PRIVATE</span>
        </div>
        <section className="mt-5">
          <p className="text-[10px] font-medium text-starlight-dim">Active skill chain</p>
          <div className="mt-2 space-y-2">
            {selectedSkills.map((skill, index) => skill && (
              <div key={skill.id} className="relative rounded-[13px] border border-[var(--glass-border)] bg-white/[0.02] p-3">
                <span className="absolute left-0 top-3 h-6 w-px" style={{ background: skill.accent }} />
                <div className="flex items-center gap-2">
                  <span className="telemetry text-[8px] text-starlight-faint">0{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-starlight">{skill.name}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[9.5px] leading-relaxed text-starlight-faint">{skill.result}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-5 border-t border-[var(--glass-border)] pt-4">
          <p className="text-[10px] font-medium text-starlight-dim">Publication readiness</p>
          <div className="mt-3 space-y-2">
            <ReadyRow label="Agent connection" ready={Boolean(activeCredential)} />
            <ReadyRow label="Private skills" ready={activeSkillIds.length > 0} />
            <ReadyRow label="Platform targets" ready={activePlatforms.length > 0} />
            <ReadyRow label="Media asset" ready={false} optional />
          </div>
        </section>
        <div className="mt-5 rounded-[14px] border border-ice/15 bg-ice/[0.035] p-3">
          <div className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 flex-none text-ice" /><p className="text-[9.5px] leading-relaxed text-starlight-faint">Your provider key is stored in the server vault. Skill source and internal tool instructions are never sent to this browser.</p></div>
        </div>
      </aside>

      <AgentConnectionDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}

function Popover({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      className={clsx("absolute top-[calc(100%+8px)] z-50 rounded-[16px] border border-[var(--glass-border)] bg-[rgba(5,11,14,0.96)] p-2 shadow-2xl backdrop-blur-2xl", className)}
    >{children}</motion.div>
  );
}

function MessageBubble({ role, body, skillIds }: { role: "user" | "agent"; body: string; skillIds?: string[] }) {
  if (role === "user") {
    return <div className="ml-auto max-w-[78%] rounded-[18px_18px_5px_18px] border border-neon/20 bg-neon/[0.07] px-4 py-3 text-[12.5px] leading-relaxed text-starlight">{body}</div>;
  }
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border border-neon/30 bg-neon/[0.06] text-neon shadow-glow-neon-sm"><Sparkles size={14} /></span>
      <div className="min-w-0 max-w-[86%]">
        <p className="text-[12.5px] leading-relaxed text-starlight-dim">{body}</p>
        {skillIds && skillIds.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{skillIds.map((id) => <span key={id} className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-[8.5px] text-starlight-faint">{skillById(id)?.name ?? id}</span>)}</div>}
      </div>
    </div>
  );
}

function StructuredDraft({ platforms, content, onRevise }: { platforms: PlatformId[]; content: string; onRevise: () => void }) {
  const prepare = () => window.sessionStorage.setItem("posterract.forgeDraft", content);
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-[18px] border border-neon/20 bg-[linear-gradient(145deg,rgba(8,22,18,0.78),rgba(4,10,13,0.72))]">
      <header className="flex items-center gap-3 border-b border-[var(--glass-border)] px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-neon/[0.08] text-neon"><Rocket size={14} /></span>
        <div className="min-w-0 flex-1"><p className="kicker !text-neon">Structured draft</p><p className="truncate text-[11.5px] font-medium text-starlight">Ready for creative approval</p></div>
        <span className="telemetry text-[9px] text-auroral">VALIDATED</span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_170px]">
        <div>
          <p className="text-[10px] text-starlight-faint">GENERATED CONTENT DIRECTION</p>
          <p className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed text-starlight-dim">{content}</p>
        </div>
        <div className="rounded-[13px] border border-[var(--glass-border)] bg-black/15 p-3">
          <p className="kicker !text-[8px]">Targets</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{platforms.map((platform) => <span key={platform} className="flex h-7 w-7 items-center justify-center rounded-[9px] border border-[var(--glass-border)]"><PlatformBrandMark platform={platform} height={12} /></span>)}</div>
          <div className="mt-3 flex items-center gap-1.5 text-[9px] text-starlight-faint"><Clock3 size={11} /> 30–45 sec</div>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] px-4 py-3">
        <Button size="sm" variant="secondary" onClick={onRevise}>Revise</Button>
        <Link to="/compose" search={{ at: Date.now() + 3_600_000 }} onClick={prepare} className="ml-auto"><Button size="sm" variant="secondary">Schedule</Button></Link>
        <Link to="/compose" onClick={prepare}><Button size="sm" variant="primary" icon={<Rocket size={12} />}>Prepare post</Button></Link>
      </footer>
    </motion.article>
  );
}

function ReadyRow({ label, ready, optional }: { label: string; ready: boolean; optional?: boolean }) {
  return <div className="flex items-center gap-2 text-[10px]"><span className={clsx("flex h-4 w-4 items-center justify-center rounded-full border", ready ? "border-neon/40 bg-neon/10 text-neon" : "border-[var(--glass-border)] text-starlight-faint")}>{ready && <Check size={9} />}</span><span className={ready ? "text-starlight-dim" : "text-starlight-faint"}>{label}</span>{optional && <span className="ml-auto text-[8px] text-starlight-faint">optional</span>}</div>;
}

function AgentConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addCredential = useHarness((state) => state.addCredential);
  const upsertCredential = useHarness((state) => state.upsertCredential);
  const [provider, setProvider] = useState<AgentProviderId>("openai");
  const selected = useMemo(() => AGENT_PROVIDERS.find((value) => value.id === provider)!, [provider]);
  const [label, setLabel] = useState("My content agent");
  const [model, setModel] = useState(selected.models[0]);
  const [secret, setSecret] = useState("");
  const [testing, setTesting] = useState(false);

  const chooseProvider = (id: AgentProviderId) => {
    const next = AGENT_PROVIDERS.find((value) => value.id === id)!;
    setProvider(id); setModel(next.models[0]); setSecret("");
  };
  const connect = async () => {
    if (secret.trim().length < 8) { pushSignal({ tone: "danger", title: "Enter a valid provider key" }); return; }
    if (!model.trim()) { pushSignal({ tone: "danger", title: "Enter a model ID" }); return; }
    setTesting(true);
    try {
      if (REMOTE_HARNESS) {
        const credential = await createAgentCredential({ provider, label, model, secret });
        upsertCredential(credential);
      } else {
        addCredential({ provider, label, model, secret });
      }
      setSecret(""); onClose();
      pushSignal({ tone: "success", title: `${selected.name} agent connected`, detail: "Only masked credential metadata is visible in the app." });
    } catch (error) {
      pushSignal({ tone: "danger", title: "Could not connect agent", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <motion.button aria-label="Close agent connection" className="absolute inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="relative w-full max-w-2xl">
            <LiquidSurface preset="modal" className="rounded-[24px]">
              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.07] text-neon"><KeyRound size={18} /></span>
                  <div className="min-w-0 flex-1"><p className="kicker !text-neon">Bring your agent</p><h2 className="mt-1 font-display text-[19px] font-semibold text-starlight">Connect a model provider</h2><p className="mt-1 text-[11px] text-starlight-faint">Your key is encrypted in Posterract’s server vault. It is never exposed to skills, other users, or the browser after submission.</p></div>
                  <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[10px] text-starlight-faint hover:bg-white/[0.04] hover:text-starlight"><X size={15} /></button>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AGENT_PROVIDERS.map((value) => <button key={value.id} onClick={() => chooseProvider(value.id)} className={clsx("rounded-[14px] border px-3 py-3 text-left transition-colors", provider === value.id ? "border-neon/40 bg-neon/[0.07]" : "border-[var(--glass-border)] hover:border-[var(--glass-border-bright)]")}><span className="provider-orb text-[9px] text-neon">{value.short}</span><span className="mt-2 block font-display text-[10.5px] font-semibold text-starlight">{value.name}</span></button>)}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="kicker !text-[8px]">Connection name</span><input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1.5 h-10 w-full rounded-[12px] border border-[var(--glass-border)] bg-black/20 px-3 text-[12px] text-starlight focus:border-neon/40 focus:outline-none" /></label>
                  <label className="block"><span className="kicker !text-[8px]">Default model ID</span><input list={`models-${provider}`} value={model} onChange={(event) => setModel(event.target.value)} className="mt-1.5 h-10 w-full rounded-[12px] border border-[var(--glass-border)] bg-[#071012] px-3 font-mono text-[11px] text-starlight focus:border-neon/40 focus:outline-none" /><datalist id={`models-${provider}`}>{selected.models.map((value) => <option key={value} value={value} />)}</datalist></label>
                </div>
                <label className="mt-3 block"><span className="kicker !text-[8px]">{selected.name} API key</span><input type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={`${selected.keyPrefix}••••••••••••••••`} className="mt-1.5 h-11 w-full rounded-[12px] border border-[var(--glass-border)] bg-black/20 px-3 font-mono text-[12px] text-starlight focus:border-neon/40 focus:outline-none" /></label>
                <div className="mt-5 flex items-center gap-3"><div className="flex min-w-0 flex-1 items-center gap-2 text-[9.5px] text-starlight-faint"><ShieldCheck size={13} className="flex-none text-neon" /><span>Posterract tests the key, encrypts it server-side, and returns only ••••{secret.slice(-4).padStart(4, "•")}</span></div><Button variant="primary" disabled={testing} onClick={() => void connect()}>{testing ? "Testing…" : "Test & connect"}</Button></div>
              </div>
            </LiquidSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

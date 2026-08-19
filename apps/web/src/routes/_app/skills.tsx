import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, Filter, Layers3, LockKeyhole, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { Button, PlatformBrandMark } from "@posterract/hyperkit";
import { LiquidSurface } from "@/components/LiquidSurface";
import { type PublicSkill, type SkillCategory } from "@/harness/catalog";
import { usePublicSkills } from "@/harness/usePublicSkills";
import { useHarness } from "@/state/harness";

export const Route = createFileRoute("/_app/skills")({ component: SkillsLibrary });

const CATEGORIES: Array<{ value: "all" | SkillCategory; label: string }> = [
  { value: "all", label: "All skills" },
  { value: "research", label: "Research" },
  { value: "strategy", label: "Strategy" },
  { value: "writing", label: "Writing" },
  { value: "production", label: "Production" },
  { value: "distribution", label: "Distribution" },
];

function SkillsLibrary() {
  const skills = usePublicSkills();
  const activeSkillIds = useHarness((state) => state.activeSkillIds);
  const toggleSkill = useHarness((state) => state.toggleSkill);
  const [category, setCategory] = useState<"all" | SkillCategory>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PublicSkill | null>(null);

  const filtered = useMemo(() => skills.filter((skill) => {
    const matchesCategory = category === "all" || skill.category === category;
    const haystack = `${skill.name} ${skill.description} ${skill.result}`.toLowerCase();
    return matchesCategory && haystack.includes(query.trim().toLowerCase());
  }), [category, query, skills]);

  return (
    <div className="mx-auto max-w-[1320px]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-neon/25 bg-neon/[0.06] text-neon"><LockKeyhole size={14} /></span><p className="kicker !text-neon">Private workflow library</p></div>
          <h1 className="mt-3 max-w-3xl font-display text-[clamp(25px,3vw,42px)] font-semibold leading-[1.06] tracking-[-0.035em] text-starlight">Your unfair content advantage,<br /><span className="text-starlight-faint">loaded into any agent.</span></h1>
          <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-starlight-dim">Choose the outcomes you need. Posterract runs the private recipe server-side; your agent receives the result, never the source.</p>
        </div>
        <LiquidSurface preset="control" enabled={!selected} className="w-full rounded-[17px] lg:w-[330px]">
          <label className="flex h-11 items-center gap-2 px-3"><Search size={14} className="text-starlight-faint" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills and outcomes…" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-starlight placeholder:text-starlight-faint focus:outline-none" /></label>
        </LiquidSurface>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-1.5">
        <Filter size={13} className="mr-1 text-starlight-faint" />
        {CATEGORIES.map((item) => <button key={item.value} onClick={() => setCategory(item.value)} className={clsx("rounded-full border px-3 py-1.5 font-display text-[10px] font-medium transition-colors", category === item.value ? "border-neon/40 bg-neon/[0.08] text-neon" : "border-[var(--glass-border)] text-starlight-faint hover:text-starlight")}>{item.label}</button>)}
        <span className="ml-auto telemetry text-[9px] text-starlight-faint">{filtered.length} available · {activeSkillIds.length} loaded</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((skill, index) => {
          const active = activeSkillIds.includes(skill.id);
          return (
            <motion.article key={skill.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.035, 0.16) }} className="skill-card flex min-h-[275px] flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[14px] border bg-black/10" style={{ borderColor: `${skill.accent}42`, color: skill.accent, boxShadow: `0 0 22px ${skill.accent}12` }}><Sparkles size={16} /></span>
                <div className="min-w-0 flex-1"><p className="kicker !text-[8px]" style={{ color: skill.accent }}>{skill.category}</p><h2 className="mt-1 font-display text-[15px] font-semibold text-starlight">{skill.name}</h2></div>
                <span className="telemetry text-[8px] text-starlight-faint">v{skill.version}</span>
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-starlight-dim">{skill.description}</p>
              <div className="mt-4 rounded-[12px] border border-[var(--glass-border)] bg-black/10 p-3"><p className="kicker !text-[7.5px]">Produces</p><p className="mt-1.5 text-[10px] leading-relaxed text-starlight-faint">{skill.result}</p></div>
              <div className="mt-auto flex items-center gap-2 pt-4">
                <div className="flex -space-x-1">{skill.platforms.map((platform) => <span key={platform} className="flex h-6 w-6 items-center justify-center rounded-full border border-[#12201d] bg-[#091210]"><PlatformBrandMark platform={platform} height={9} /></span>)}</div>
                <span className="text-[8.5px] text-starlight-faint">{skill.stages} stages</span>
                <button onClick={() => setSelected(skill)} className="ml-auto text-[9.5px] text-starlight-dim hover:text-starlight">Details</button>
                <button onClick={() => toggleSkill(skill.id)} className={clsx("flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 font-display text-[9.5px] font-semibold transition-colors", active ? "border-neon/35 bg-neon/[0.08] text-neon" : "border-[var(--glass-border)] text-starlight-dim hover:border-neon/30 hover:text-neon")}>{active ? <Check size={11} /> : <Layers3 size={11} />}{active ? "Loaded" : "Load"}</button>
              </div>
            </motion.article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-[18px] border border-neon/15 bg-neon/[0.025] p-4 sm:flex-row sm:items-center">
        <div className="flex gap-3"><ShieldCheck size={17} className="mt-0.5 flex-none text-neon" /><div><p className="font-display text-[11.5px] font-semibold text-starlight">Private by architecture</p><p className="mt-1 text-[10px] text-starlight-faint">Agent requests identify skill versions; responses contain outputs and provenance, never instruction text or internal tools.</p></div></div>
        <Link to="/forge"><Button size="sm" variant="primary" icon={<ArrowRight size={12} />}>Open Forge</Button></Link>
      </div>

      <SkillDialog skill={selected} active={selected ? activeSkillIds.includes(selected.id) : false} onToggle={() => selected && toggleSkill(selected.id)} onClose={() => setSelected(null)} />
    </div>
  );
}

function SkillDialog({ skill, active, onToggle, onClose }: { skill: PublicSkill | null; active: boolean; onToggle: () => void; onClose: () => void }) {
  return <AnimatePresence>{skill && <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"><motion.button aria-label="Close skill details" className="absolute inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} /><motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="relative w-full max-w-xl"><LiquidSurface preset="modal" className="rounded-[24px]"><div className="p-6"><div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-[15px] border" style={{ borderColor: `${skill.accent}45`, color: skill.accent }}><Sparkles size={18} /></span><div className="min-w-0 flex-1"><p className="kicker" style={{ color: skill.accent }}>{skill.category} · v{skill.version}</p><h2 className="mt-1 font-display text-[20px] font-semibold text-starlight">{skill.name}</h2></div><button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[10px] text-starlight-faint hover:bg-white/[0.04] hover:text-starlight"><X size={15} /></button></div><p className="mt-5 text-[12px] leading-relaxed text-starlight-dim">{skill.description}</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-[13px] border border-[var(--glass-border)] p-3"><p className="kicker !text-[8px]">Inputs</p><ul className="mt-2 space-y-1.5">{skill.inputs.map((input) => <li key={input} className="flex items-center gap-2 text-[10px] text-starlight-dim"><span className="h-1 w-1 rounded-full bg-neon" />{input}</li>)}</ul></div><div className="rounded-[13px] border border-[var(--glass-border)] p-3"><p className="kicker !text-[8px]">Output</p><p className="mt-2 text-[10px] leading-relaxed text-starlight-dim">{skill.result}</p></div></div><div className="mt-5 flex items-center gap-3 border-t border-[var(--glass-border)] pt-4"><div className="flex min-w-0 flex-1 items-center gap-2 text-[9.5px] text-starlight-faint"><LockKeyhole size={13} className="flex-none text-neon" />Instruction source is never exposed.</div><Button variant={active ? "secondary" : "primary"} onClick={onToggle}>{active ? "Remove from Forge" : "Load into Forge"}</Button></div></div></LiquidSurface></motion.div></div>}</AnimatePresence>;
}

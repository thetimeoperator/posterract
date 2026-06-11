import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Copy, Pencil, Plus, Send, Trash2, Zap } from "lucide-react";
import {
  Button,
  EmptyState,
  FieldShell,
  Input,
  Modal,
  Panel,
  PlatformChip,
  PlatformRuneRow,
  Tabs,
  Textarea,
  Toggle,
  pushSignal,
} from "@posterract/hyperkit";
import type { AutomationFlowDTO, PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES, PLATFORM_IDS } from "@posterract/contract";
import type { FlowInput } from "@/engine/store";
import { useEngineActions, useFlows } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/automations")({
  component: Automations,
});

/**
 * Automations — saved posting flows. Define platforms + a caption per
 * platform once; apply to any video from the composer in one click.
 */
function Automations() {
  const flows = useFlows();
  const { createFlow, updateFlow, deleteFlow } = useEngineActions();
  const [editing, setEditing] = useState<AutomationFlowDTO | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-[12.5px] text-starlight-dim">
          A flow is a reusable posting recipe: which platforms, and what caption each platform gets.
          Apply one in the composer and everything pre-fills — drop the video, done.
          <span className="text-starlight-faint"> Captions can use {"{title}"} — it becomes the post's title.</span>
        </p>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
          New automation
        </Button>
      </div>

      {flows.length === 0 ? (
        <Panel className="min-h-[40vh]">
          <EmptyState
            glyph={<Zap size={40} className="text-starlight-faint" />}
            title="No automations yet."
            detail="Create a flow once — Instagram caption, X caption, TikTok caption — and reuse it on every video."
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                New automation
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <Panel key={flow.id} brackets shimmer className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-[14px] font-semibold text-starlight">{flow.name}</p>
                  <PlatformRuneRow platforms={flow.platforms} className="mt-1.5" />
                </div>
                <Toggle
                  checked={flow.enabled}
                  onChange={(enabled) => updateFlow(flow.id, { enabled })}
                  aria-label={`Enable ${flow.name}`}
                />
              </div>

              <div className="mt-3 flex-1 space-y-1.5">
                {flow.platforms.slice(0, 3).map((p) => (
                  <div key={p} className="rounded-[8px] bg-void-2 px-2.5 py-1.5">
                    <p className="kicker !text-[8.5px]">{PLATFORM_CAPABILITIES[p].label}</p>
                    <p className="truncate text-[11.5px] text-starlight-dim">
                      {(flow.captionTemplates[p] ?? flow.baseCaption) || "—"}
                    </p>
                  </div>
                ))}
                {flow.platforms.length > 3 && (
                  <p className="px-1 text-[10.5px] text-starlight-faint">+{flow.platforms.length - 3} more platforms</p>
                )}
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                <Link to="/compose" search={{ flow: flow.id, artifact: undefined, at: undefined }} className="flex-1">
                  <Button size="sm" variant="primary" icon={<Send size={12} />} className="w-full" disabled={!flow.enabled}>
                    Use
                  </Button>
                </Link>
                <Button size="sm" variant="secondary" aria-label={`Edit ${flow.name}`} onClick={() => setEditing(flow)}>
                  <Pencil size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Duplicate ${flow.name}`}
                  onClick={() => {
                    createFlow({ ...flow, name: `${flow.name} (copy)` });
                    pushSignal({ tone: "info", title: "Flow duplicated" });
                  }}
                >
                  <Copy size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Delete ${flow.name}`}
                  onClick={() => {
                    deleteFlow(flow.id);
                    pushSignal({ tone: "info", title: "Flow deleted", detail: flow.name });
                  }}
                >
                  <Trash2 size={12} className="text-redshift" />
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {editing && (
        <FlowBuilder
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            if (editing === "new") {
              createFlow(input);
              pushSignal({ tone: "success", title: "Automation created", detail: input.name });
            } else {
              updateFlow(editing.id, input);
              pushSignal({ tone: "success", title: "Automation updated", detail: input.name });
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function FlowBuilder({
  initial,
  onClose,
  onSave,
}: {
  initial?: AutomationFlowDTO;
  onClose: () => void;
  onSave: (input: FlowInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [platforms, setPlatforms] = useState<PlatformId[]>(initial?.platforms ?? ["instagram", "x"]);
  const [templates, setTemplates] = useState<Partial<Record<PlatformId, string>>>(initial?.captionTemplates ?? {});
  const [baseCaption, setBaseCaption] = useState(initial?.baseCaption ?? "{title}");
  const [hashtags, setHashtags] = useState((initial?.hashtags ?? []).join(", "));
  const [timeOfDay, setTimeOfDay] = useState(initial?.defaultTimeOfDay ?? "");
  const [tab, setTab] = useState<"base" | PlatformId>("base");

  const toggle = (p: PlatformId) =>
    setPlatforms((cur) => {
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      if (tab !== "base" && !next.includes(tab)) setTab("base");
      return next;
    });

  const canSave = name.trim().length > 0 && platforms.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      kicker="Automation"
      title={initial ? "Edit flow" : "New flow"}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                name: name.trim(),
                platforms,
                captionTemplates: Object.fromEntries(
                  Object.entries(templates).filter(([p, v]) => platforms.includes(p as PlatformId) && v?.trim()),
                ),
                baseCaption,
                hashtags: hashtags
                  .split(/[,\s]+/)
                  .map((h) => h.replace(/^#/, "").trim())
                  .filter(Boolean),
                defaultTimeOfDay: timeOfDay || undefined,
                enabled: initial?.enabled ?? true,
              })
            }
          >
            Save flow
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Flow name"
          placeholder="e.g. Daily repurpose: IG → X"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div>
          <p className="kicker mb-2">Platforms</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Flow platforms">
            {PLATFORM_IDS.map((p) => (
              <PlatformChip key={p} platform={p} selected={platforms.includes(p)} onClick={() => toggle(p)} />
            ))}
          </div>
        </div>

        <div>
          <Tabs
            aria-label="Caption per platform"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "base" as const, label: "Base" },
              ...platforms.map((p) => ({
                value: p,
                label: PLATFORM_CAPABILITIES[p].label,
                alert: (templates[p]?.length ?? 0) > PLATFORM_CAPABILITIES[p].captionMaxChars,
              })),
            ]}
          />
          <div className="pt-3">
            {tab === "base" ? (
              <Textarea
                label="Base caption — platforms without their own caption use this"
                value={baseCaption}
                onChange={(e) => setBaseCaption(e.target.value)}
                rows={4}
                hint="{title} inserts the post's title when the flow is used."
              />
            ) : (
              <Textarea
                key={tab}
                label={`${PLATFORM_CAPABILITIES[tab].label} caption`}
                placeholder={baseCaption || "Platform-specific caption…"}
                value={templates[tab] ?? ""}
                onChange={(e) => setTemplates((t) => ({ ...t, [tab]: e.target.value }))}
                maxChars={PLATFORM_CAPABILITIES[tab].captionMaxChars}
                rows={4}
                hint="Blank = inherits the base caption. {title} works here too."
              />
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Hashtags"
            placeholder="repurpose, daily"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            hint="Comma-separated, appended to every caption."
          />
          <FieldShell label="Preferred posting time (optional)" hint="Pre-fills the schedule when the flow is used.">
            {(id) => (
              <input
                id={id}
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-[rgba(155,255,197,0.25)] bg-void-2 px-3.5 text-[13px] text-starlight [color-scheme:dark] focus:border-[rgba(101,255,154,0.6)] focus:shadow-glow-neon-sm focus:outline-none"
              />
            )}
          </FieldShell>
        </div>
      </div>
    </Modal>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleX, Replace, Send, X as XIcon } from "lucide-react";
import clsx from "clsx";
import {
  Button,
  FieldShell,
  Modal,
  Panel,
  PlatformChip,
  Segmented,
  Tabs,
  Textarea,
  pushSignal,
} from "@posterract/hyperkit";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS } from "@posterract/contract";
import { VideoDropzone } from "@/components/VideoDropzone";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import {
  artifactUrl,
  computePreflight,
  renderTemplate,
  useArtifacts,
  useAccountSets,
  useEngineActions,
  usePortals,
} from "@/engine/useEngine";
import { aspectLabel, formatBytes, formatDuration, toDatetimeLocal } from "@/lib/fmt";

type ComposeSearch = { artifact?: string; at?: number };

export const Route = createFileRoute("/_app/compose")({
  component: Composer,
  validateSearch: (search: Record<string, unknown>): ComposeSearch => ({
    artifact: typeof search.artifact === "string" ? search.artifact : undefined,
    at: typeof search.at === "number" ? search.at : undefined,
  }),
});

function Composer() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const artifacts = useArtifacts();
  const portals = usePortals();
  const accountSets = useAccountSets();
  const { createTransmission } = useEngineActions();

  const [artifactId, setArtifactId] = useState<string | undefined>(search.artifact);
  const [baseCaption, setBaseCaption] = useState(() => {
    const prepared = window.sessionStorage.getItem("posterract.forgeDraft") ?? "";
    window.sessionStorage.removeItem("posterract.forgeDraft");
    return prepared;
  });
  const [overrides, setOverrides] = useState<Partial<Record<PlatformId, string>>>({});
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [platforms, setPlatforms] = useState<PlatformId[]>(["instagram", "tiktok"]);
  const [accountSetId, setAccountSetId] = useState("");
  const [captionTab, setCaptionTab] = useState<"base" | PlatformId>("base");
  const [mode, setMode] = useState<"now" | "at">(search.at ? "at" : "now");
  const [whenLocal, setWhenLocal] = useState(() => toDatetimeLocal(search.at ?? Date.now() + 3600_000));
  const [vaultOpen, setVaultOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [safeZones, setSafeZones] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const artifact = artifacts.find((a) => a.id === artifactId);
  const previewUrl = artifactUrl(artifactId);

  // Titles stay internal until YouTube publishing is introduced. The backend
  // still needs one to identify the post, so derive it from the uploaded file.
  const resolvedTitle = artifact?.fileName.replace(/\.[a-z0-9]+$/i, "") || "Untitled";
  const captionFor = (p: PlatformId) => {
    const v = overrides[p];
    const raw = v === undefined || v === "" ? baseCaption : v;
    return renderTemplate(raw, { title: resolvedTitle });
  };
  const fullCaptionFor = (p: PlatformId) =>
    [captionFor(p), hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");

  const selectedAccountSet = accountSets.find((set) => set.id === accountSetId);
  const portalStatus = (p: PlatformId) =>
    selectedAccountSet
      ? selectedAccountSet.accounts.find((account) => account.provider === p)?.status
      : portals.some((account) => account.provider === p && account.status === "connected")
        ? "connected"
        : portals.find((account) => account.provider === p)?.status;

  const preflight = useMemo(() => {
      const checks = computePreflight({
        artifact,
        platforms,
        captionFor: fullCaptionFor,
        portalStatus,
      });
      return checks;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifact, platforms, baseCaption, overrides, hashtags, portals, resolvedTitle],
  );
  const failing = preflight.filter((c) => c.status === "fail");
  const canLaunch = failing.length === 0 && !!artifact && platforms.length > 0;

  const togglePlatform = (p: PlatformId) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const addTag = () => {
    const clean = tagDraft.replace(/^#/, "").trim().replace(/\s+/g, "");
    if (clean && !hashtags.includes(clean)) setHashtags((h) => [...h, clean]);
    setTagDraft("");
  };

  const launch = async () => {
    if (!artifact || submitting) return;
    const scheduledFor = mode === "now" ? Date.now() : new Date(whenLocal).getTime();
    if (mode === "at" && scheduledFor <= Date.now()) {
      pushSignal({ tone: "warning", title: "Time is in the past", detail: "Pick a future time, or switch to Now." });
      return;
    }
    setSubmitting(true);
    try {
      const t = await createTransmission({
        title: resolvedTitle,
        baseCaption,
        hashtags,
        artifactId: artifact.id,
        platforms,
        perPlatformCaptions: Object.fromEntries(
          platforms.map((p) => [p, fullCaptionFor(p)]),
        ) as Partial<Record<PlatformId, string>>,
        perPlatformOptions: undefined,
        accountSetId: accountSetId || undefined,
        scheduleMode: mode,
        scheduledFor,
      });
      pushSignal({
        tone: "success",
        title: mode === "now" ? "Transmission initiated" : "Transmission in trajectory",
        detail:
          mode === "now"
            ? `Publishing “${t.title}” to ${platforms.length} platform${platforms.length > 1 ? "s" : ""} now.`
            : `“${t.title}” will publish ${new Date(scheduledFor).toLocaleString()}.`,
      });
      void navigate({ to: "/transmissions" });
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Post was not submitted",
        detail: error instanceof Error ? error.message.replaceAll("_", " ") : "Posterract could not create the transmission.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const captionTabs = [
    { value: "base" as const, label: "Base" },
    ...PUBLISHING_PLATFORM_IDS.map((p) => ({
      value: p,
      label: PLATFORM_CAPABILITIES[p].label,
      alert: fullCaptionFor(p).length > PLATFORM_CAPABILITIES[p].captionMaxChars,
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1.2fr_0.95fr]">
      <div className="xl:col-span-3">
        <button
          type="button"
          onClick={() => void navigate({ to: "/continuum" })}
          className="compose-back-control"
          aria-label="Back to calendar"
        >
          <span className="compose-back-control__icon" aria-hidden><ArrowLeft size={15} /></span>
          <span>Back to calendar</span>
        </button>
      </div>

      {/* ── Left: the Containment Field ── */}
      <Panel kicker="Containment field" title="Artifact" brackets>
        {!artifact ? (
          <div className="space-y-3">
            <VideoDropzone onReady={(a) => setArtifactId(a.id)} />
            {artifacts.length > 0 && (
              <Button variant="secondary" className="w-full" onClick={() => setVaultOpen(true)}>
                Choose from the Vault ({artifacts.length})
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative mx-auto w-full max-w-[260px]">
              {previewUrl && (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="aspect-[9/16] w-full rounded-[12px] border border-[var(--glass-border-bright)] bg-black object-contain"
                />
              )}
              {safeZones && (
                <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[12px]">
                  <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-[rgba(255,204,102,0.55)] bg-[rgba(255,204,102,0.08)]" />
                  <div className="absolute inset-x-0 bottom-0 h-[18%] border-t border-dashed border-[rgba(255,204,102,0.55)] bg-[rgba(255,204,102,0.08)]" />
                  <p className="kicker absolute bottom-1 left-1/2 -translate-x-1/2 !text-[8px] !text-solar">UI zones</p>
                </div>
              )}
            </div>
            <div className="telemetry grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-starlight-dim">
              <span className="truncate" title={artifact.fileName}>
                {artifact.fileName}
              </span>
              <span className="text-right">{formatBytes(artifact.sizeBytes)}</span>
              <span>
                {formatDuration(artifact.durationMs)} · {aspectLabel(artifact.width, artifact.height)}
              </span>
              <span className="text-right">
                {artifact.width ?? "?"}×{artifact.height ?? "?"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Replace size={13} />} onClick={() => setArtifactId(undefined)}>
                Replace
              </Button>
              <Button size="sm" variant="tertiary" onClick={() => setSafeZones((v) => !v)}>
                {safeZones ? "Hide UI zones" : "Show UI zones"}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Center: the Message ── */}
      <Panel kicker="The message" title="Caption" brackets>
        <div className="space-y-4">
          <div>
            <Tabs
              aria-label="Caption variants"
              value={captionTab}
              onChange={setCaptionTab}
              tabs={captionTabs}
              className="overflow-x-auto"
            />
            <div className="pt-3">
              {captionTab === "base" ? (
                <Textarea
                  label="Base caption — all platforms inherit this"
                  placeholder="Write once, project everywhere…"
                  value={baseCaption}
                  onChange={(e) => setBaseCaption(e.target.value)}
                  rows={5}
                />
              ) : (
                <Textarea
                  key={captionTab}
                  label={`${PLATFORM_CAPABILITIES[captionTab].label} override — blank inherits base`}
                  placeholder={baseCaption || "Platform-specific caption…"}
                  value={overrides[captionTab] ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, [captionTab]: e.target.value }))}
                  maxChars={PLATFORM_CAPABILITIES[captionTab].captionMaxChars}
                  rows={5}
                  hint={`Sent as ${fullCaptionFor(captionTab).length} chars incl. hashtags · limit ${PLATFORM_CAPABILITIES[captionTab].captionMaxChars}`}
                />
              )}
            </div>
          </div>

          <FieldShell label={`Hashtags (${hashtags.length})`}>
            {(id) => (
              <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-[rgba(155,255,197,0.25)] bg-void-2 px-2.5 py-2">
                {hashtags.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-[rgba(101,255,154,0.3)] bg-[rgba(101,255,154,0.07)] px-1.5 py-0.5 text-[11px] text-neon"
                  >
                    #{h}
                    <button
                      aria-label={`Remove #${h}`}
                      onClick={() => setHashtags((cur) => cur.filter((x) => x !== h))}
                      className="text-starlight-faint hover:text-redshift"
                    >
                      <XIcon size={10} />
                    </button>
                  </span>
                ))}
                <input
                  id={id}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    } else if (e.key === "Backspace" && !tagDraft && hashtags.length) {
                      setHashtags((cur) => cur.slice(0, -1));
                    }
                  }}
                  onBlur={addTag}
                  placeholder={hashtags.length ? "" : "ai, shortform, launch…"}
                  className="h-6 min-w-24 flex-1 bg-transparent text-[12px] text-starlight placeholder:text-starlight-faint focus:outline-none"
                />
              </div>
            )}
          </FieldShell>
        </div>
      </Panel>

      {/* ── Right: targets + trajectory + pre-flight ── */}
      <div className="flex flex-col gap-4">
        <Panel kicker="Projection targets" title="Platforms" brackets>
          {accountSets.length > 0 && (
            <label className="mb-3 block">
              <span className="kicker mb-1.5 block !text-[8px]">Account set</span>
              <select
                value={accountSetId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setAccountSetId(nextId);
                  const next = accountSets.find((set) => set.id === nextId);
                  if (next) {
                    setPlatforms(next.accounts.map((account) => account.provider).filter((provider) => (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(provider)));
                  }
                }}
                className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-void-2 px-3 text-[12px] text-starlight outline-none focus:border-neon/30"
              >
                <option value="">Automatic account selection</option>
                {accountSets.map((set) => <option key={set.id} value={set.id}>{set.name} · {set.accounts.length} networks</option>)}
              </select>
              <span className="mt-1.5 block text-[9.5px] text-starlight-faint">
                {selectedAccountSet ? `Posting through the exact accounts saved in ${selectedAccountSet.name}.` : "Uses the most recently connected account on each selected platform."}
              </span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Target platforms">
            {PUBLISHING_PLATFORM_IDS.map((p) => (
              <PlatformChip
                key={p}
                platform={p}
                selected={platforms.includes(p)}
                onClick={() => togglePlatform(p)}
                className="w-full"
              />
            ))}
          </div>
          <p className="mt-2.5 text-[10px] text-starlight-faint">YouTube and X are coming soon.</p>
          {platforms.some((p) => portalStatus(p) !== "connected") && (
            <p className="mt-2.5 text-[11px] text-solar">
              ⚠ Some targeted portals aren’t connected — align them in Portals.
            </p>
          )}
        </Panel>

        <Panel kicker="Trajectory" title="When" brackets>
          <div className="space-y-3">
            <Segmented
              aria-label="Schedule mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "now", label: "Post now" },
                { value: "at", label: "Schedule" },
              ]}
            />
            {mode === "at" && (
              <FieldShell label="Launch time" hint={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                {(id) => (
                  <input
                    id={id}
                    type="datetime-local"
                    value={whenLocal}
                    step={300}
                    min={toDatetimeLocal(Date.now())}
                    onChange={(e) => setWhenLocal(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-void-2 px-3.5 text-[13px] text-starlight [color-scheme:dark] focus:border-white/[0.2] focus:outline-none"
                  />
                )}
              </FieldShell>
            )}
          </div>
        </Panel>

        <Panel
          kicker="Pre-flight"
          title={`Checks (${preflight.filter((c) => c.status === "pass").length}/${preflight.length})`}
          brackets
        >
          <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {preflight.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12px]">
                {c.status === "pass" && <CheckCircle2 size={13} className="mt-0.5 flex-none text-auroral" />}
                {c.status === "warn" && <CircleAlert size={13} className="mt-0.5 flex-none text-solar" />}
                {c.status === "fail" && <CircleX size={13} className="mt-0.5 flex-none text-redshift" />}
                <span className={clsx("min-w-0", c.status === "fail" ? "text-starlight" : "text-starlight-dim")}>
                  {c.label}
                  {c.detail && <span className="block text-[11px] text-starlight-faint">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Button
          variant="primary"
          size="lg"
          icon={<Send size={15} />}
          disabled={!canLaunch || submitting}
          onClick={() => (mode === "now" && platforms.length >= 3 ? setConfirmOpen(true) : void launch())}
          className="w-full"
        >
          {submitting ? "Submitting…" : mode === "now" ? "Initiate Transmission" : "Lock Trajectory"}
        </Button>
        {!canLaunch && failing.length > 0 && (
          <p className="text-center text-[11px] text-starlight-faint">
            Resolve {failing.length} pre-flight failure{failing.length > 1 ? "s" : ""} to launch
          </p>
        )}
      </div>

      {/* Vault picker */}
      <Modal open={vaultOpen} onClose={() => setVaultOpen(false)} kicker="The Vault" title="Choose an artifact" width="max-w-2xl">
        <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
          {artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setArtifactId(a.id);
                setVaultOpen(false);
              }}
              className="group text-left"
            >
              <ArtifactThumb artifactId={a.id} className="aspect-[9/16] w-full transition-transform group-hover:scale-[1.02]" />
              <p className="mt-1 truncate text-[11px] text-starlight-dim">{a.fileName}</p>
            </button>
          ))}
        </div>
      </Modal>

      {/* Multi-platform "now" confirmation */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        kicker="Confirm"
        title={`Publish to ${platforms.length} platforms now?`}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirmOpen(false)}>
              Abort
            </Button>
            <Button
              variant="primary"
              disabled={submitting}
              onClick={() => {
                setConfirmOpen(false);
                void launch();
              }}
            >
              Engage
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-starlight-dim">
          This publishes immediately to{" "}
          <strong className="text-starlight">{platforms.map((p) => PLATFORM_CAPABILITIES[p].label).join(", ")}</strong>. A
          live transmission can’t be recalled.
        </p>
      </Modal>
    </div>
  );
}

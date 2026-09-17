import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, CircleAlert, Replace, Send, Settings2 } from "lucide-react";
import {
  Button,
  Panel,
  FieldShell,
  Modal,
  Segmented,
  Textarea,
  pushSignal,
} from "@posterract/hyperkit";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_CAPABILITIES, PUBLISHING_PLATFORM_IDS } from "@posterract/contract";
import { VideoDropzone } from "@/components/VideoDropzone";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import { TikTokHoverHint, TIKTOK_DISCLOSURE_HINT } from "@/components/TikTokSettings";
import { emptyTikTokOptions, validateTikTokOptions, type TikTokCreatorInfo } from "@posterract/contract/tiktok";
import {
  artifactUrl,
  computePreflight,
  renderTemplate,
  useArtifacts,
  useAccountSets,
  useEngineActions,
  usePortals,
  useTransmissions,
  useProjections,
  getTikTokCreatorInfo,
} from "@/engine/useEngine";
import { aspectLabel, formatBytes, formatDuration, toDatetimeLocal } from "@/lib/fmt";
import type { CreateTransmissionInput } from "@/engine/store";

import { WebAccountStrip } from "./WebAccountStrip";
import { WebPlatformSettings } from "./WebPlatformSettings";
import { WebTikTokSettings } from "./WebTikTokSettings";
import "./web-composer.css";

export function WebComposer({ search }: { search: { artifact?: string; at?: number; copy?: string } }) {
  const navigate = useNavigate();
  const artifacts = useArtifacts();
  const portals = usePortals();
  const accountSets = useAccountSets();
  const transmissions = useTransmissions();
  const projections = useProjections();
  const { createTransmission } = useEngineActions();

  const [artifactId, setArtifactId] = useState<string | undefined>(search.artifact);
  const [baseCaption, setBaseCaption] = useState(() => {
    const prepared = window.sessionStorage.getItem("posterract.forgeDraft") ?? "";
    window.sessionStorage.removeItem("posterract.forgeDraft");
    return prepared;
  });
  const [overrides, setOverrides] = useState<Partial<Record<PlatformId, string>>>({});
  const [captionTab, setCaptionTab] = useState<"base" | PlatformId>("base");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [platforms, setPlatforms] = useState<PlatformId[]>(["instagram", "tiktok"]);
  const [accountSetId, setAccountSetId] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<Partial<Record<PlatformId, string>>>({});
  const [tiktok, setTikTok] = useState(emptyTikTokOptions);
  const [creatorState, setCreatorState] = useState<{ accountId?: string; info?: TikTokCreatorInfo; loading: boolean; error?: string }>({ loading: false });
  const [creatorRefresh, setCreatorRefresh] = useState(0);
  const copied = useRef(false);
  const lastSubmission = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const [settingsPlatform, setSettingsPlatform] = useState<PlatformId>("instagram");
  const [mode, setMode] = useState<"now" | "at">(search.at ? "at" : "now");
  const [whenLocal, setWhenLocal] = useState(() => toDatetimeLocal(search.at ?? Date.now() + 3600_000));
  const [vaultOpen, setVaultOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [safeZones, setSafeZones] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "at") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    setSelectedAccounts((current) => {
      const next = { ...current };
      let changed = false;
      for (const provider of platforms) {
        const available = portals.filter((a) => a.provider === provider && a.status === "connected");
        if (current[provider] === undefined && available.length === 1) { next[provider] = available[0].id; changed = true; }
      }
      return changed ? next : current;
    });
  }, [portals, platforms]);
  useEffect(() => {
    if (!search.copy || copied.current) return;
    const source = transmissions.find((t) => t.id === search.copy);
    const targets = projections.filter((p) => p.transmissionId === search.copy);
    if (!source || !targets.length) return;
    copied.current = true;
    setArtifactId(source.artifactId);
    setBaseCaption([source.baseCaption, source.hashtags.map((tag) => `#${tag}`).join(" ")].filter(Boolean).join("\n\n"));
    // Legacy target captions already contain their original hashtags; never append again.
    setOverrides(Object.fromEntries(targets.map((p) => [p.provider, p.caption])));
    setPlatforms(targets.map((p) => p.provider));
    setSelectedAccounts(Object.fromEntries(targets.map((p) => [p.provider, p.portalId || ""])));
    setTikTok(emptyTikTokOptions());
  }, [search.copy, transmissions, projections]);

  const tiktokAccountId = platforms.includes("tiktok") ? selectedAccounts.tiktok : undefined;
  useEffect(() => { setTikTok(emptyTikTokOptions()); }, [tiktokAccountId]);
  useEffect(() => {
    let active = true;
    setCreatorState({ accountId: tiktokAccountId, loading: !!tiktokAccountId });
    if (tiktokAccountId) void getTikTokCreatorInfo(tiktokAccountId).then(
      (info) => { if (active) setCreatorState({ accountId: tiktokAccountId, info, loading: false }); },
      (error) => { if (active) setCreatorState({ accountId: tiktokAccountId, loading: false, error: error instanceof Error ? error.message : "Could not load TikTok settings." }); },
    );
    return () => { active = false; };
  }, [tiktokAccountId, creatorRefresh]);
  const creator = creatorState.accountId === tiktokAccountId ? creatorState.info : undefined;
  useEffect(() => {
    // Default only after this account confirms public posting is available.
    // Keep any audience the user has already selected, including on refresh.
    if (creator?.privacy_level_options.includes("PUBLIC_TO_EVERYONE")) {
      setTikTok((current) => current.privacyLevel ? current : { ...current, privacyLevel: "PUBLIC_TO_EVERYONE" });
    }
  }, [creator, tiktok.privacyLevel]);

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
  const fullCaptionFor = captionFor;
  const portalStatus = (p: PlatformId) =>
    portals.find((account) => account.id === selectedAccounts[p] && account.provider === p)?.status;

  const preflight = useMemo(() => {
      const checks = computePreflight({
        artifact,
        platforms,
        captionFor: fullCaptionFor,
        portalStatus,
        durationLimits: { tiktok: creator?.max_video_post_duration_sec },
      });
      return checks;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifact, platforms, baseCaption, overrides, portals, resolvedTitle, selectedAccounts, creator],
  );
  const directTikTok = !!tiktokAccountId && tiktok.mode === "direct";
  const disclosureHint = directTikTok && tiktok.commercialContent && !tiktok.brandOrganic && !tiktok.brandContent
    ? TIKTOK_DISCLOSURE_HINT : undefined;
  const tiktokValidation = directTikTok ? validateTikTokOptions(tiktok, creator, artifact?.durationMs) : undefined;
  const publishingChecks: typeof preflight = preflight.map((check) => {
    if (check.id === "artifact") return { ...check, label: "Video added", detail: artifact ? undefined : "Add a video to continue." };
    if (check.id.startsWith("portal_")) return { ...check, status: "fail", label: check.label.replace(" portal", " account"), detail: "Choose a connected account." };
    return check;
  });
  if (directTikTok) publishingChecks.push({
    id: "settings_tiktok", label: "TikTok settings",
    status: creator && !creatorState.loading && !tiktokValidation ? "pass" : "fail",
    detail: creatorState.loading ? "Loading TikTok account settings…" : creatorState.error || tiktokValidation || (!creator ? "Refresh TikTok account settings to continue." : undefined),
  });
  if (mode === "at") {
    const time = new Date(whenLocal).getTime();
    const valid = Number.isFinite(time) && time > now;
    publishingChecks.push({ id: "schedule", label: "Scheduled time", status: valid ? "pass" : "fail", detail: valid ? undefined : "Choose a time in the future." });
  }
  const failing = publishingChecks.filter((check) => check.status === "fail");
  const canLaunch = failing.length === 0 && !!artifact && platforms.length > 0;
  const activePlatform = platforms.includes(settingsPlatform) ? settingsPlatform : platforms[0];
  const platformIssues = Object.fromEntries(platforms.map((p) => [p, failing.some((c) => c.id.endsWith(`_${p}`))]));
  const showSettings = (p: PlatformId) => {
    setSettingsPlatform(p);
    setSettingsOpen(true);
  };
  const destinations = platforms.map((p) => {
    const account = portals.find((a) => a.id === selectedAccounts[p]);
    return `${PLATFORM_CAPABILITIES[p].label}: ${p === "tiktok" && creator ? creator.creator_nickname : account?.displayName || account?.handle || "choose account"}`;
  }).join(" · ");

  const togglePlatform = (p: PlatformId) => {
    setAccountSetId("");
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };

  const launch = async () => {
    if (!artifact || submitting || !canLaunch) return;
    const scheduledFor = mode === "now" ? Date.now() : new Date(whenLocal).getTime();
    if (mode === "at" && (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now())) {
      pushSignal({ tone: "warning", title: "Time is in the past", detail: "Pick a future time, or switch to Now." });
      return;
    }
    setSubmitting(true);
    try {
      const input: CreateTransmissionInput = {
        title: resolvedTitle,
        baseCaption,
        hashtags: [],
        artifactId: artifact.id,
        platforms,
        perPlatformCaptions: Object.fromEntries(
          platforms.map((p) => [p, fullCaptionFor(p)]),
        ) as Partial<Record<PlatformId, string>>,
        perPlatformOptions: platforms.includes("tiktok") ? { tiktok: tiktok.mode === "direct" ? { ...tiktok, consentAccepted: true } : { mode: "inbox" } } : undefined,
        accountIds: platforms.map((p) => selectedAccounts[p]!),
        scheduleMode: mode,
        scheduledFor,
      };
      const fingerprint = JSON.stringify({ ...input, scheduledFor: mode === "now" ? 0 : scheduledFor });
      if (lastSubmission.current?.fingerprint !== fingerprint) lastSubmission.current = { fingerprint, key: crypto.randomUUID() };
      const t = await createTransmission({ ...input, idempotencyKey: lastSubmission.current.key });
      pushSignal({
        tone: "success",
        title: mode === "now" ? "Post submitted" : "Post scheduled",
        detail:
          mode === "now"
            ? `Publishing “${t.title}” to ${platforms.length} platform${platforms.length > 1 ? "s" : ""} now.`
            : `“${t.title}” will publish ${new Date(scheduledFor).toLocaleString()}.`,
      });
      void navigate({ to: "/transmissions" });
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Could not confirm submission",
        detail: error instanceof Error ? error.message.replaceAll("_", " ") : "Posterract could not create the transmission.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const activeCaption = captionTab === "base" || platforms.includes(captionTab) ? captionTab : "base";
  const captionPlatforms = ["base" as const, ...platforms];
  const captionLabel = activeCaption === "base" ? "Base caption" : `${PLATFORM_CAPABILITIES[activeCaption].label} caption`;
  const captionValue = activeCaption === "base" ? baseCaption : overrides[activeCaption] ?? "";
  const maxChars = activeCaption === "base"
    ? Math.min(...platforms.map((p) => PLATFORM_CAPABILITIES[p].captionMaxChars))
    : PLATFORM_CAPABILITIES[activeCaption].captionMaxChars;
  const captionError = activeCaption === "base"
    ? platforms.filter((p) => !overrides[p] && fullCaptionFor(p).length > PLATFORM_CAPABILITIES[p].captionMaxChars).map((p) => PLATFORM_CAPABILITIES[p].label)
    : fullCaptionFor(activeCaption).length > maxChars ? [PLATFORM_CAPABILITIES[activeCaption].label] : [];
  const fixCheck = (id: string) => {
    const provider = platforms.find((p) => id.endsWith(`_${p}`));
    if (id === "settings_tiktok") showSettings("tiktok");
    else if (id === "targets" || id.startsWith("portal_")) setPickerOpen(true);
    else if (id.startsWith("caption_") && provider) { setCaptionTab(provider); requestAnimationFrame(() => captionRef.current?.focus()); }
    else if (id === "schedule") document.querySelector<HTMLInputElement>("#web-compose-time input")?.focus();
    else document.getElementById("web-compose-media")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <div className="web-compose">
    <button type="button" className="compose-back-control" onClick={() => void navigate({ to: "/continuum" })} aria-label="Back to calendar">
      <span className="compose-back-control__icon" aria-hidden><ArrowLeft size={15} /></span><span>Back to calendar</span>
    </button>
    <div className="web-compose-layout">
      <Panel brackets className="web-compose-post" aria-label="Post">
        <WebAccountStrip accounts={portals} platforms={platforms} selected={selectedAccounts} onToggle={togglePlatform}
          onAccount={(provider, id) => { setAccountSetId(""); setSelectedAccounts((previous) => ({ ...previous, [provider]: id }));
            if (id) setPlatforms((previous) => previous.includes(provider) ? previous : [...previous, provider]); }}
          accountSets={accountSets} accountSetId={accountSetId} onAccountSet={(id) => {
            setAccountSetId(id);
            const next = accountSets.find((set) => set.id === id);
            if (next) {
              setPlatforms(next.accounts.map((a) => a.provider).filter((p) => (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(p)));
              setSelectedAccounts(Object.fromEntries(next.accounts.map((a) => [a.provider, a.id])));
            }
          }} creator={creator} pickerOpen={pickerOpen} onPicker={setPickerOpen} issues={platformIssues} />
        <div className="web-compose-content">
          <div className="web-compose-media" id="web-compose-media">
            <span className="kicker">Artifact</span>
            {!artifact ? <>
              <VideoDropzone compact className="web-compose-dropzone" onReady={(a) => setArtifactId(a.id)} />
              {artifacts.length > 0 && <Button size="sm" variant="secondary" onClick={() => setVaultOpen(true)}>Choose from Vault</Button>}
            </> : <>
              <div className="web-compose-video">
                {previewUrl && <video src={previewUrl} controls playsInline />}
                {safeZones && <div className="web-compose-safe-zones" aria-hidden><span /><span /></div>}
              </div>
              <div className="web-compose-file telemetry"><span title={artifact.fileName}>{artifact.fileName}</span>
                <span>{formatDuration(artifact.durationMs)} · {aspectLabel(artifact.width, artifact.height)} · {formatBytes(artifact.sizeBytes)}</span></div>
              <div className="web-compose-media-actions"><Button size="sm" variant="secondary" icon={<Replace size={12} />} onClick={() => setArtifactId(undefined)}>Replace</Button>
                <button type="button" aria-pressed={safeZones} onClick={() => setSafeZones((v) => !v)}>{safeZones ? "Hide UI zones" : "UI zones"}</button></div>
            </>}
          </div>
          <div className="web-compose-caption">
            <div className="web-compose-tabs" role="tablist" aria-label="Caption variants" onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = captionPlatforms.indexOf(activeCaption);
              const next = event.key === "Home" ? 0 : event.key === "End" ? captionPlatforms.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + captionPlatforms.length) % captionPlatforms.length;
              setCaptionTab(captionPlatforms[next]); document.getElementById(`web-caption-tab-${captionPlatforms[next]}`)?.focus();
            }}>
              {captionPlatforms.map((p) => <button key={p} type="button" role="tab" id={`web-caption-tab-${p}`} aria-controls="web-caption-panel"
                aria-selected={activeCaption === p} tabIndex={activeCaption === p ? 0 : -1} onClick={() => setCaptionTab(p)}>
                {p === "base" ? "Base" : PLATFORM_CAPABILITIES[p].label}
                {p !== "base" && fullCaptionFor(p).length > PLATFORM_CAPABILITIES[p].captionMaxChars && <span className="web-compose-attention-dot" aria-label="Over character limit" />}
              </button>)}
            </div>
            <div role="tabpanel" id="web-caption-panel" aria-labelledby={`web-caption-tab-${activeCaption}`}>
              <Textarea ref={captionRef} label={captionLabel} value={captionValue} rows={7}
                placeholder={activeCaption === "base" ? "Write once, project everywhere…" : baseCaption || "Use the base caption or write your own…"}
                onChange={(event) => activeCaption === "base" ? setBaseCaption(event.target.value) : setOverrides((current) => ({ ...current, [activeCaption]: event.target.value }))}
                error={captionError.length ? `Caption exceeds the limit for ${captionError.join(", ")}.` : undefined} />
              <div className="web-compose-caption-meta">
                <span>{(activeCaption === "base" ? baseCaption : fullCaptionFor(activeCaption)).length.toLocaleString()}{Number.isFinite(maxChars) ? ` / ${maxChars.toLocaleString()}` : ""}</span>
                {activeCaption !== "base" && (overrides[activeCaption] ? <button type="button" onClick={() => setOverrides((current) => { const next = { ...current }; delete next[activeCaption]; return next; })}>Use base caption</button> : <span>Using base caption</span>)}
              </div>
            </div>
            <Button variant="secondary" size="sm" className="web-compose-settings-button" aria-label="Settings" aria-haspopup="dialog"
              onClick={() => { if (activeCaption !== "base") setSettingsPlatform(activeCaption); setSettingsOpen(true); }} icon={<Settings2 size={14} />}>
              Settings{platforms.some((p) => platformIssues[p]) && <span className="web-compose-attention-dot" aria-label="Needs attention" />}
            </Button>
          </div>
        </div>
      </Panel>
      <aside className="web-compose-sidebar">
        <Panel kicker="Trajectory" title="When" brackets>
          <div className="space-y-3">
            <Segmented aria-label="Schedule mode" value={mode} onChange={(value) => { setNow(Date.now()); setMode(value); }} options={[{ value: "now", label: "Post now" }, { value: "at", label: "Schedule" }]} />
            {mode === "at" && <div id="web-compose-time"><FieldShell label="Launch time" hint={Intl.DateTimeFormat().resolvedOptions().timeZone}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} className="web-compose-datetime" type="datetime-local" value={whenLocal} step={300} min={toDatetimeLocal(now)} onChange={(event) => setWhenLocal(event.target.value)} />}</FieldShell></div>}
          </div>
        </Panel>
        <Panel kicker="Pre-flight" title={`Checks (${publishingChecks.filter((c) => c.status === "pass").length}/${publishingChecks.length})`} brackets>
          <ul className="web-compose-checks" aria-live="polite">{publishingChecks.map((check) => <li key={check.id} data-status={check.status}>
            {check.status === "pass" ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
            {check.status === "pass" ? <span>{check.label}</span> : <button type="button" onClick={() => fixCheck(check.id)}><span>{check.label}</span>{check.detail && <small>{check.detail}</small>}</button>}
          </li>)}</ul>
        </Panel>
        <div className="web-compose-publish">
          <TikTokHoverHint message={disclosureHint} label="Why posting is unavailable"><Button variant="primary" size="lg" icon={<Send size={15} />} className="w-full"
            disabled={!canLaunch || submitting} aria-busy={submitting} onClick={() => mode === "now" && platforms.length >= 3 ? setConfirmOpen(true) : void launch()}>
            {submitting ? "Submitting…" : mode === "at" ? "Schedule post" : platforms.length === 1 && tiktokAccountId && tiktok.mode === "inbox" ? "Send to TikTok inbox" : "Publish now"}
          </Button></TikTokHoverHint>
        </div>
      </aside>
    </div>
    <WebPlatformSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} platforms={platforms} active={activePlatform} onActive={setSettingsPlatform}
      accounts={portals} selected={selectedAccounts} issues={platformIssues}
      tiktokSettings={<WebTikTokSettings value={tiktok} onChange={setTikTok} creator={creator} loading={creatorState.loading || creatorState.accountId !== tiktokAccountId}
        error={creatorState.error || tiktokValidation} onRefresh={() => {
          setTikTok((current) => ({ ...emptyTikTokOptions(), privacyLevel: current.privacyLevel }));
          setCreatorRefresh((n) => n + 1);
        }} />} />
    <Modal open={vaultOpen} onClose={() => setVaultOpen(false)} kicker="Video library" title="Choose a video" width="max-w-2xl">
      <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">{artifacts.map((a) => <button key={a.id} className="text-left" onClick={() => { setArtifactId(a.id); setVaultOpen(false); }}>
        <ArtifactThumb artifactId={a.id} className="aspect-[9/16] w-full" /><p className="mt-1 truncate text-[11px] text-starlight-dim">{a.fileName}</p>
      </button>)}</div>
    </Modal>
    <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} kicker="Confirm" title={`Publish to ${platforms.length} platforms now?`}
      footer={<><Button variant="tertiary" onClick={() => setConfirmOpen(false)}>Cancel</Button><TikTokHoverHint message={disclosureHint} label="Why posting is unavailable" className="w-auto">
        <Button variant="primary" disabled={submitting || !canLaunch} onClick={() => { setConfirmOpen(false); void launch(); }}>Publish now</Button></TikTokHoverHint></>}>
      <p className="text-[13px] text-starlight-dim">This publishes immediately to <strong className="text-starlight">{destinations}</strong>. A live transmission can’t be recalled.</p>
    </Modal>
  </div>;
}

/**
 * Publish simulator — stands in for the real platform connectors until the
 * Convex backend lands. Steps due projections through the real lifecycle
 * (uploading → publishing → processing → live) with per-platform pacing,
 * seeded failures + retry, and human-readable events.
 */
import { pushSignal } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import type { ProjectionDTO } from "@posterract/contract";
import { useEngineStore } from "./store";

const running = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base * (0.7 + Math.random() * 0.6);

async function runProjection(projection: ProjectionDTO): Promise<void> {
  const store = useEngineStore.getState;
  const { _updateProjection, _emit, _refreshTransmissionStatus } = store();
  const label = PLATFORM_CAPABILITIES[projection.provider].label;
  const tx = () => store().transmissions.find((t) => t.id === projection.transmissionId);
  const artifact = store().artifacts.find((a) => a.id === tx()?.artifactId);
  const sizeMB = Math.max(8, Math.round((artifact?.sizeBytes ?? 40_000_000) / 1_000_000));

  const portal = store().portals.find((p) => p.id === projection.portalId);
  if (!portal || portal.status !== "connected") {
    _updateProjection(projection.id, {
      status: "needs_reauth",
      errorCategory: "auth",
      errorSummary: `${label} portal is not aligned — connect it in Portals`,
    });
    _emit({
      type: "projection.failed",
      transmissionId: projection.transmissionId,
      projectionId: projection.id,
      message: `${label} blocked — portal not connected`,
    });
    _refreshTransmissionStatus(projection.transmissionId);
    pushSignal({ tone: "warning", title: `${label} blocked`, detail: "Portal needs alignment. Open Portals to connect." });
    return;
  }

  // Uploading (chunky progress events)
  _updateProjection(projection.id, { status: "uploading", attemptCount: projection.attemptCount + 1 });
  _refreshTransmissionStatus(projection.transmissionId);
  const chunks = 3 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= chunks; i++) {
    await sleep(jitter(450));
    _emit({
      type: "projection.uploading",
      transmissionId: projection.transmissionId,
      projectionId: projection.id,
      message: `Uploading to ${label}… ${Math.round((i / chunks) * sizeMB)}/${sizeMB} MB`,
    });
  }

  // Seeded transient failure (~12% on first attempt) → retry once
  const currentAttempts = store().projections.find((p) => p.id === projection.id)?.attemptCount ?? 1;
  if (currentAttempts === 1 && Math.random() < 0.12) {
    _updateProjection(projection.id, {
      status: "retrying",
      errorCategory: "transient",
      errorSummary: `${label} media processing hiccup — retrying`,
      nextAttemptAt: Date.now() + 4000,
    });
    _emit({
      type: "projection.retrying",
      transmissionId: projection.transmissionId,
      projectionId: projection.id,
      message: `${label} processing error — automatic retry in 4s`,
    });
    _refreshTransmissionStatus(projection.transmissionId);
    await sleep(4000);
    const again = store().projections.find((p) => p.id === projection.id);
    if (again) await runProjection(again);
    return;
  }

  // Publishing
  _updateProjection(projection.id, { status: "publishing" });
  _emit({
    type: "projection.publishing",
    transmissionId: projection.transmissionId,
    projectionId: projection.id,
    message: `Publishing to ${label}…`,
  });
  await sleep(jitter(900));

  // Pull-from-URL platforms have platform-side processing
  if (PLATFORM_CAPABILITIES[projection.provider].mediaMode !== "upload") {
    _updateProjection(projection.id, { status: "processing" });
    _emit({
      type: "projection.processing",
      transmissionId: projection.transmissionId,
      projectionId: projection.id,
      message: `${label} is processing the media container…`,
    });
    await sleep(jitter(1300));
  }

  // Live
  const postId = Math.random().toString(36).slice(2, 10);
  const url = `https://${projection.provider === "youtube" ? "youtube.com/shorts" : `${projection.provider}.com/p`}/${postId}`;
  _updateProjection(projection.id, {
    status: "live",
    platformPostId: postId,
    platformPostUrl: url,
    errorCategory: undefined,
    errorSummary: undefined,
  });
  _emit({
    type: "projection.live",
    transmissionId: projection.transmissionId,
    projectionId: projection.id,
    message: `${label} projection LIVE → ${url.replace("https://", "")}`,
  });
  _refreshTransmissionStatus(projection.transmissionId);

  const t = tx();
  if (t?.status === "live") {
    pushSignal({ tone: "success", title: "Transmission live", detail: `“${t.title}” is live on all platforms.` });
    _emit({ type: "transmission.live", transmissionId: t.id, message: `“${t.title}” fully deployed` });
  }
}

/** States that mean "mid-flight" — only valid while a run is actually active. */
const TRANSIENT = new Set(["uploading", "publishing", "processing", "retrying"]);

function tick() {
  const { transmissions, projections, _updateProjection } = useEngineStore.getState();
  const now = Date.now();
  for (const t of transmissions) {
    if (t.status !== "scheduled" && t.status !== "transmitting") continue;
    if ((t.scheduledFor ?? Infinity) > now) continue;
    for (const projection of projections.filter((p) => p.transmissionId === t.id)) {
      if (running.has(projection.id)) continue;
      const isDue = projection.status === "scheduled" && (projection.nextAttemptAt ?? 0) <= now;
      // Sweeper: a transient status with no active run means a reload
      // orphaned it (same job the cloud sweeper does) — reclaim and rerun.
      const isOrphaned = TRANSIENT.has(projection.status) && now - projection.updatedAt > 4000;
      if (!isDue && !isOrphaned) continue;
      running.add(projection.id);
      const fresh = isOrphaned ? { ...projection, status: "scheduled" as const } : projection;
      if (isOrphaned) _updateProjection(projection.id, { status: "scheduled" });
      void runProjection(fresh).finally(() => running.delete(projection.id));
    }
  }
}

/** Start the simulator loop (idempotent). Call once from the app shell. */
export function startSimulator(): () => void {
  if (timer) return () => {};
  timer = setInterval(tick, 1000);
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

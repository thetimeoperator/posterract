import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CircleAlert } from "lucide-react";
import clsx from "clsx";
import {
  Button,
  Countdown,
  EmptyState,
  OrbitRing,
  Panel,
  PlatformRuneRow,
  ProgressBeam,
  StatusBadge,
  Telemetry,
} from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, nextRank, rankFor } from "@posterract/contract";
import type { PlatformId } from "@posterract/contract";
import type { CellVisualState } from "@/tesseract/Tesseract";
import { DeviceStage } from "@/core3d/DeviceStage";
import { useEvents, usePoints, usePortals, useProjections, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/")({
  component: Bridge,
});

/**
 * The Bridge — mission control around the device. Answers four questions in
 * priority order: make a post (the device), am I leveling up (Resonance),
 * what's going out next (queue), does anything need me (attention).
 */
function Bridge() {
  const transmissions = useTransmissions();
  const projections = useProjections();
  const events = useEvents();
  const portals = usePortals();
  const points = usePoints();

  const upcoming = transmissions
    .filter((t) => t.status === "scheduled" || t.status === "transmitting")
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
    .slice(0, 5);

  const transmitting = transmissions.find((t) => t.status === "transmitting");
  const scheduledCount = transmissions.filter((t) => t.status === "scheduled").length;
  const next = upcoming.find((t) => t.status === "scheduled");
  const platformsOf = (txId: string) => projections.filter((p) => p.transmissionId === txId).map((p) => p.provider);

  const mode = transmitting ? "publishing" : next ? "scheduled" : "idle";
  const cellStates: Partial<Record<PlatformId, CellVisualState>> = {};
  for (const portal of portals) {
    cellStates[portal.provider] = portal.status === "connected" ? "connected" : "dark";
  }
  if (transmitting) {
    for (const projection of projections.filter((x) => x.transmissionId === transmitting.id)) {
      cellStates[projection.provider] =
        projection.status === "live" ? "live" : projection.status === "failed" ? "failed" : "igniting";
    }
  }

  // Resonance — the charge toward the next rank.
  const lifetimeRP = points?.lifetimeRP ?? 0;
  const rank = rankFor(lifetimeRP);
  const nextUp = nextRank(lifetimeRP);
  const charge = nextUp ? (lifetimeRP - rank.minRP) / Math.max(1, nextUp.minRP - rank.minRP) : 1;

  // Attention — only what actually needs the operator.
  const failedProjections = projections.filter((p) => p.status === "failed");
  const reauthPortals = portals.filter((p) => p.status === "needs_reauth");
  const needsAttention = failedProjections.length > 0 || reauthPortals.length > 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_320px]">
      {/* ── Left: Resonance + portal health ── */}
      <div className="order-3 flex flex-col gap-4 xl:order-1">
        <Panel kicker="Resonance" title="Charge" brackets className="flex flex-col items-center pb-5">
          <OrbitRing value={charge} size={120} stroke={4} label="Charge" className="mt-1">
            <span className="flex flex-col items-center">
              <span className="telemetry text-[22px] font-semibold text-starlight">{lifetimeRP.toLocaleString()}</span>
              <span className="kicker !text-[8px]">RP</span>
            </span>
          </OrbitRing>
          <p className="mt-3 font-display text-[14px] font-semibold text-neon">{rank.label}</p>
          {nextUp ? (
            <p className="mt-0.5 text-[11px] text-starlight-faint">
              {(nextUp.minRP - lifetimeRP).toLocaleString()} RP to {nextUp.label}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-starlight-faint">The device is fully lit.</p>
          )}
          <div className="mt-3 w-full">
            <ProgressBeam value={charge} label="Progress to next rank" />
          </div>
          <div className="mt-3 w-full">
            <Telemetry
              rows={[
                { k: "streak", v: points?.streakDays ? `${points.streakDays} day${points.streakDays > 1 ? "s" : ""}` : "—", tone: (points?.streakDays ?? 0) >= 3 ? "good" : undefined },
                { k: "this week", v: `${(points?.weekRP ?? 0).toLocaleString()} RP` },
              ]}
            />
          </div>
          <Link
            to="/points"
            aria-label="Resonance points"
            className="mt-3 flex items-center gap-1 self-start text-[12px] text-neon hover:underline"
          >
            Open Resonance <ArrowRight size={12} />
          </Link>
        </Panel>

        <Panel kicker="Portal alignment">
          <ul className="space-y-1.5">
            {portals.map((p) => {
              const caps = PLATFORM_CAPABILITIES[p.provider];
              return (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] text-starlight-dim">{caps.label}</span>
                  <span
                    className={clsx(
                      "telemetry text-[10px]",
                      p.status === "connected" && "text-auroral",
                      p.status === "needs_reauth" && "text-solar",
                      p.status !== "connected" && p.status !== "needs_reauth" && "text-starlight-faint",
                    )}
                  >
                    {p.status === "connected" ? "● LINKED" : p.status === "needs_reauth" ? "◐ RE-ALIGN" : "○ CLOSED"}
                  </span>
                </li>
              );
            })}
          </ul>
          <Link to="/portals" className="mt-3 flex items-center gap-1 text-[12px] text-neon hover:underline">
            Manage portals <ArrowRight size={12} />
          </Link>
        </Panel>
      </div>

      {/* ── Center: THE POSTERRACT — the device itself is the create button ── */}
      <Panel brackets className="relative order-1 min-h-[480px] overflow-hidden !p-0 xl:order-2">
        <Link to="/compose" aria-label="Start a post" className="absolute inset-0 cursor-pointer">
          <DeviceStage mode={mode} cellStates={cellStates} className="h-full w-full" />
        </Link>
        {/* The readout — heritage of the original core title */}
        <div className="core-readout pointer-events-none absolute left-1/2 top-[8%] z-10 -translate-x-1/2">
          <p className="core-readout-title">
            POSTER<span style={{ color: "var(--neon)" }}>RACT</span>
          </p>
          <p className="core-readout-status">
            {transmitting
              ? `TRANSMITTING · ${transmitting.title.toUpperCase().slice(0, 28)}`
              : next?.scheduledFor
                ? `${scheduledCount} IN TRAJECTORY`
                : "AWAITING TRANSMISSION"}
          </p>
          {!transmitting && next?.scheduledFor && (
            <p className="core-readout-status !text-starlight-dim">
              NEXT <Countdown to={next.scheduledFor} prefix="T-" className="!text-neon" />
            </p>
          )}
        </div>
        <Link
          to="/compose"
          className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2"
          aria-label="New transmission"
        >
          <Button variant="primary" size="lg">
            Initiate Transmission
          </Button>
        </Link>
      </Panel>

      {/* ── Right: attention + upcoming + activity ── */}
      <div className="order-2 flex flex-col gap-4 xl:order-3">
        {needsAttention && (
          <Panel kicker="Needs attention" brackets>
            <ul className="space-y-1.5">
              {failedProjections.length > 0 && (
                <li>
                  <Link
                    to="/transmissions"
                    className="flex items-center gap-2 rounded-[8px] border border-[rgba(255,107,107,0.35)] bg-[rgba(255,107,107,0.07)] px-2.5 py-2 text-[12px] text-starlight transition-colors hover:border-[rgba(255,107,107,0.6)]"
                  >
                    <CircleAlert size={13} className="flex-none text-redshift" />
                    <span className="min-w-0 flex-1 truncate">
                      {failedProjections.length} projection{failedProjections.length > 1 ? "s" : ""} failed
                    </span>
                    <ArrowRight size={12} className="flex-none text-starlight-faint" />
                  </Link>
                </li>
              )}
              {reauthPortals.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/portals"
                    className="flex items-center gap-2 rounded-[8px] border border-[rgba(255,204,102,0.35)] bg-[rgba(255,204,102,0.07)] px-2.5 py-2 text-[12px] text-starlight transition-colors hover:border-[rgba(255,204,102,0.6)]"
                  >
                    <CircleAlert size={13} className="flex-none text-solar" />
                    <span className="min-w-0 flex-1 truncate">
                      {PLATFORM_CAPABILITIES[p.provider].label} needs re-alignment
                    </span>
                    <ArrowRight size={12} className="flex-none text-starlight-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel kicker="Task queue" title="Next transmissions" brackets>
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing in trajectory."
              detail="Compose a transmission and project it across six platforms."
              action={
                <Link to="/compose">
                  <Button variant="primary" size="sm">
                    Compose
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/transmissions"
                    className="hk-shimmer glass flex items-center gap-3 rounded-[var(--radius-card)] px-3 py-2.5 transition-colors hover:border-[var(--glass-border-bright)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-starlight">{t.title}</p>
                      <PlatformRuneRow platforms={platformsOf(t.id)} className="mt-1" />
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <StatusBadge status={t.status} size="sm" />
                      {t.scheduledFor && t.status === "scheduled" && (
                        <Countdown to={t.scheduledFor} className="text-[10px]" />
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel kicker="Neural activity" title="Signals">
          <ul className="space-y-1.5">
            {events.slice(0, 4).map((ev) => (
              <li key={ev.id} className="flex items-baseline gap-2.5 text-[12px]">
                <span className="telemetry flex-none text-[9px] text-starlight-faint">
                  {new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="min-w-0 flex-1 truncate text-starlight-dim">{ev.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import clsx from "clsx";
import {
  Button,
  Countdown,
  EmptyState,
  Panel,
  PlatformRuneRow,
  ProgressBeam,
  StatusBadge,
  Telemetry,
} from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import type { PlatformId } from "@posterract/contract";
import type { CellVisualState } from "@/tesseract/Tesseract";
import { DeviceStage } from "@/core3d/DeviceStage";
import { useEvents, usePortals, useProjections, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/")({
  component: Bridge,
});

/**
 * The Bridge — the item showcase. THE POSTERRACT center stage with HUD
 * telemetry orbiting it (reference-image layout): left = system status,
 * right = task queue + output, bottom = signals + portal health.
 */
function Bridge() {
  const transmissions = useTransmissions();
  const projections = useProjections();
  const events = useEvents();
  const portals = usePortals();

  const upcoming = transmissions
    .filter((t) => t.status === "scheduled" || t.status === "transmitting")
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
    .slice(0, 4);

  const transmitting = transmissions.find((t) => t.status === "transmitting");
  const scheduledCount = transmissions.filter((t) => t.status === "scheduled").length;
  const liveCount = transmissions.filter((t) => t.status === "live" || t.status === "partial").length;
  const healthyPortals = portals.filter((p) => p.status === "connected").length;
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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_300px]">
      {/* ── Left HUD column ── */}
      <div className="order-2 flex flex-col gap-4 xl:order-1">
        <Panel kicker="System status" brackets>
          <Telemetry
            rows={[
              { k: "core", v: mode === "publishing" ? "TRANSMITTING" : "OPERATIONAL", tone: mode === "publishing" ? "warn" : "good" },
              { k: "portals", v: `${healthyPortals}/6 aligned`, tone: healthyPortals >= 4 ? "good" : "warn" },
              { k: "in trajectory", v: String(scheduledCount) },
              { k: "deployed", v: String(liveCount), tone: "good" },
            ]}
          />
          <div className="mt-3">
            <p className="kicker mb-1.5 !text-[9px]">Reactor load</p>
            <ProgressBeam value={mode === "publishing" ? 0.86 : 0.32} label="Reactor load" />
          </div>
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

      {/* ── Center: THE POSTERRACT ── */}
      <Panel brackets className="relative order-1 min-h-[480px] overflow-hidden !p-0 xl:order-2">
        <div className="absolute inset-0">
          <DeviceStage mode={mode} cellStates={cellStates} className="h-full w-full" />
        </div>
        {/* The readout — heritage of the original core title */}
        <div className="core-readout absolute left-1/2 top-[8%] z-10 -translate-x-1/2">
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

      {/* ── Right HUD column ── */}
      <div className="order-3 flex flex-col gap-4">
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
            {events.slice(0, 5).map((ev) => (
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

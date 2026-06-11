import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import clsx from "clsx";
import {
  Button,
  Countdown,
  EmptyState,
  Panel,
  PlatformRuneRow,
  StatusBadge,
} from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import { mockEvents, mockPortals, mockTransmissions } from "@/mock/data";

export const Route = createFileRoute("/_app/")({
  component: Bridge,
});

/**
 * The Bridge — dashboard. The Tesseract (Phase 2) will occupy the hero
 * stage; data moons orbit it as glass chips.
 */
function Bridge() {
  const upcoming = mockTransmissions
    .filter((t) => t.status === "scheduled" || t.status === "transmitting")
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
    .slice(0, 5);

  const scheduledThisWeek = mockTransmissions.filter((t) => t.status === "scheduled").length;
  const postedThisMonth = mockTransmissions.filter((t) => t.status === "live" || t.status === "partial").length;
  const healthyPortals = mockPortals.filter((p) => p.status === "connected").length;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
      {/* Hero: Tesseract stage */}
      <Panel brackets className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden">
        {/* Tesseract placeholder — Phase 2 mounts the 4D core here */}
        <div className="flex flex-col items-center gap-6">
          <div
            aria-hidden
            className="flex h-48 w-48 items-center justify-center rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(139,92,246,0.12) 0%, rgba(94,242,255,0.05) 45%, transparent 70%)",
            }}
          >
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="hk-pulse-aura rounded-full">
              <g stroke="url(#bridge-irid)" strokeWidth="1.25" strokeLinejoin="round">
                <rect x="18" y="18" width="84" height="84" />
                <rect x="42" y="42" width="36" height="36" />
                <path d="M18 18l24 24M102 18L78 42M18 102l24-24M102 102L78 78" />
              </g>
              <defs>
                <linearGradient id="bridge-irid" x1="0" y1="0" x2="120" y2="120">
                  <stop offset="0" stopColor="#5EF2FF" />
                  <stop offset="0.5" stopColor="#8B5CF6" />
                  <stop offset="1" stopColor="#FF4ECD" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Data moons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <DataMoon label="Scheduled this week" value={scheduledThisWeek} />
            <DataMoon label="Posted this month" value={postedThisMonth} />
            <DataMoon label="Portals healthy" value={`${healthyPortals}/6`} />
          </div>
        </div>
      </Panel>

      {/* Next transmissions */}
      <Panel kicker="Next transmissions" title="In trajectory" className="min-h-[420px]">
        {upcoming.length === 0 ? (
          <EmptyState
            title="No transmissions in trajectory."
            detail="Compose your first and project it across six dimensions."
            action={
              <Link to="/compose">
                <Button variant="primary">Compose</Button>
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((t) => (
              <li key={t.id}>
                <Link
                  to="/transmissions"
                  className="hk-shimmer glass flex items-center gap-3 rounded-[var(--radius-card)] px-3.5 py-3 transition-colors hover:border-[var(--glass-border-bright)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-starlight">{t.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <PlatformRuneRow platforms={t.platforms} />
                    </div>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <StatusBadge status={t.status} size="sm" />
                    {t.scheduledFor && t.status === "scheduled" && (
                      <Countdown to={t.scheduledFor} className="text-[11px]" />
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Recent signals */}
      <Panel kicker="Recent signals" title="Activity">
        <ul className="space-y-1.5">
          {mockEvents.slice(0, 5).map((ev) => (
            <li key={ev.id} className="flex items-baseline gap-3 text-[12.5px]">
              <span className="telemetry flex-none text-[10px] text-starlight-faint">
                {new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 flex-1 truncate text-starlight-dim">{ev.message}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Portal health strip */}
      <Panel
        kicker="Portal health"
        title="Six dimensions"
        actions={
          <Link to="/portals" className="flex items-center gap-1 text-[12px] text-hyper-cyan hover:underline">
            Manage <ArrowRight size={12} />
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {mockPortals.map((p) => {
            const caps = PLATFORM_CAPABILITIES[p.provider];
            return (
              <div
                key={p.id}
                className="glass rounded-[var(--radius-card)] px-3 py-2.5"
                style={{
                  borderColor:
                    p.status === "connected"
                      ? "rgba(70,245,177,0.25)"
                      : p.status === "needs_reauth"
                        ? "rgba(255,200,87,0.3)"
                        : "var(--glass-border)",
                }}
              >
                <p className="truncate font-display text-[11px] font-semibold text-starlight">{caps.label}</p>
                <p
                  className={clsx(
                    "telemetry mt-1 text-[11px]",
                    p.status === "connected" && "text-auroral",
                    p.status === "needs_reauth" && "text-solar",
                    p.status !== "connected" && p.status !== "needs_reauth" && "text-starlight-faint",
                  )}
                >
                  {p.status === "connected" ? "● linked" : p.status === "needs_reauth" ? "◐ re-align" : "○ closed"}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function DataMoon({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass flex items-center gap-3 rounded-full px-4 py-2">
      <span className="telemetry text-[18px] font-medium text-starlight">{value}</span>
      <span className="kicker !text-[9px]">{label}</span>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import clsx from "clsx";
import { Button, EmptyState, Panel, PlatformRuneRow, Segmented, StatusBadge } from "@posterract/hyperkit";
import type { PlatformId } from "@posterract/contract";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import { useProjections, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/continuum")({
  component: Continuum,
});

const DAY = 86400_000;

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return d.getTime() - dow * DAY;
}

/**
 * The Continuum — the schedule, one week at a time. Time is the fourth
 * dimension: scheduled transmissions sit on their day; the now-line sweeps
 * today's column in real time. Click a day's + to compose into that slot.
 */
function Continuum() {
  const navigate = useNavigate();
  const transmissions = useTransmissions();
  const projections = useProjections();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const [view, setView] = useState<"week" | "month">("week");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStart + i * DAY), [weekStart]);
  const isThisWeek = startOfWeek(now) === weekStart;

  const byDay = useMemo(() => {
    const map = new Map<number, typeof transmissions>();
    for (const day of days) map.set(day, []);
    for (const t of transmissions) {
      if (!t.scheduledFor || t.status === "draft") continue;
      const day = startOfWeek(t.scheduledFor) === weekStart ? t.scheduledFor - ((t.scheduledFor - weekStart) % DAY) : null;
      const key = days.find((d) => t.scheduledFor! >= d && t.scheduledFor! < d + DAY);
      if (key !== undefined && day !== null) map.get(key)!.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    return map;
  }, [transmissions, days, weekStart]);

  const weekLabel = `${new Date(days[0]).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date(
    days[6],
  ).toLocaleDateString([], { month: "short", day: "numeric" })}`;

  const total = days.reduce((sum, d) => sum + (byDay.get(d)?.length ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        <Button size="sm" variant="secondary" aria-label="Previous" onClick={() => setWeekStart((w) => w - (view === "week" ? 7 : 28) * DAY)}>
          <ChevronLeft size={14} />
        </Button>
        <Button size="sm" variant="secondary" aria-label="Next" onClick={() => setWeekStart((w) => w + (view === "week" ? 7 : 28) * DAY)}>
          <ChevronRight size={14} />
        </Button>
        <p className="font-display text-[15px] font-semibold text-starlight">
          {view === "week" ? weekLabel : new Date(weekStart).toLocaleDateString([], { month: "long", year: "numeric" })}
        </p>
        {!isThisWeek && (
          <Button size="sm" variant="tertiary" onClick={() => setWeekStart(startOfWeek(Date.now()))}>
            Back to this week
          </Button>
        )}
        <p className="ml-auto telemetry text-[11px] text-starlight-faint">
          {total} transmission{total === 1 ? "" : "s"} this week
        </p>
      </div>

      {view === "month" ? (
        <MonthView
          anchor={weekStart}
          now={now}
          transmissions={transmissions}
          onPickDay={(day) => {
            setWeekStart(startOfWeek(day));
            setView("week");
          }}
        />
      ) : (
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const isToday = now >= day && now < day + DAY;
          const dayFrac = isToday ? (now - day) / DAY : 0;
          const items = byDay.get(day) ?? [];
          const past = day + DAY < now;

          return (
            <div
              key={day}
              className={clsx(
                "relative flex min-h-[420px] flex-col rounded-[var(--radius-card)] border bg-[var(--glass-bg)] p-2",
                isToday ? "border-[rgba(101,255,154,0.45)] shadow-glow-neon-sm" : "border-[var(--glass-border)]",
                past && "opacity-60",
              )}
            >
              <div className="mb-2 flex items-baseline justify-between px-1">
                <p className={clsx("kicker !text-[10px]", isToday && "!text-neon")}>
                  {new Date(day).toLocaleDateString([], { weekday: "short" })}
                </p>
                <p className={clsx("telemetry text-[12px]", isToday ? "text-neon" : "text-starlight-faint")}>
                  {new Date(day).getDate()}
                </p>
              </div>

              {/* now-line sweeping today's column */}
              {isToday && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1 z-10 h-px bg-neon shadow-glow-neon-md"
                  style={{ top: `${8 + dayFrac * 88}%` }}
                >
                  <span className="absolute -left-0.5 -top-[2.5px] h-1.5 w-1.5 rounded-full bg-neon" />
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {items.map((t) => {
                  const platforms = projections.filter((p) => p.transmissionId === t.id).map((p) => p.provider) as PlatformId[];
                  return (
                    <Link
                      key={t.id}
                      to="/transmissions"
                      className="hk-shimmer rounded-[10px] border border-[var(--glass-border)] bg-void-2 p-2 transition-colors hover:border-[var(--glass-border-bright)]"
                    >
                      <div className="flex items-center gap-2">
                        <ArtifactThumb artifactId={t.artifactId} className="h-10 w-7 flex-none" hoverPreview={false} />
                        <div className="min-w-0">
                          <p className="telemetry text-[10px] text-neon">
                            {new Date(t.scheduledFor!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                          <p className="truncate text-[11px] text-starlight">{t.title}</p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-1">
                        <PlatformRuneRow platforms={platforms} />
                        <StatusBadge status={t.status} size="sm" />
                      </div>
                    </Link>
                  );
                })}
              </div>

              {!past && (
                <button
                  onClick={() =>
                    void navigate({
                      to: "/compose",
                      search: { at: Math.max(day + 12 * 3600_000, now + 1800_000), artifact: undefined },
                    })
                  }
                  className="mt-1.5 flex h-8 flex-none items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--glass-border)] text-starlight-faint transition-colors hover:border-neon/50 hover:text-neon"
                  aria-label={`Schedule for ${new Date(day).toDateString()}`}
                >
                  <Plus size={12} />
                  <span className="text-[10px]">dock</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}

      {total === 0 && view === "week" && (
        <Panel>
          <EmptyState
            title="Nothing in this week's continuum."
            detail="Schedule a transmission into any docking bay above, or compose one from scratch."
            action={
              <Link to="/compose">
                <Button variant="primary">New Post</Button>
              </Link>
            }
          />
        </Panel>
      )}
    </div>
  );
}


function MonthView({
  anchor,
  now,
  transmissions,
  onPickDay,
}: {
  anchor: number;
  now: number;
  transmissions: ReturnType<typeof useTransmissions>;
  onPickDay: (day: number) => void;
}) {
  const anchorDate = new Date(anchor);
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1).getTime();
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => gridStart + i * DAY);
  const month = anchorDate.getMonth();

  const countFor = (day: number) =>
    transmissions.filter(
      (t) => t.scheduledFor && t.status !== "draft" && t.scheduledFor >= day && t.scheduledFor < day + DAY,
    );

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1.5 px-0.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <p key={d} className="kicker !text-[9px] text-center">{d}</p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((day) => {
          const inMonth = new Date(day).getMonth() === month;
          const isToday = now >= day && now < day + DAY;
          const items = countFor(day);
          return (
            <button
              key={day}
              onClick={() => onPickDay(day)}
              className={clsx(
                "flex min-h-[92px] flex-col rounded-[10px] border p-1.5 text-left transition-colors hover:border-[var(--glass-border-bright)]",
                isToday ? "border-[rgba(101,255,154,0.45)] shadow-glow-neon-sm" : "border-[var(--glass-border)]",
                inMonth ? "bg-[var(--glass-bg)]" : "bg-transparent opacity-40",
              )}
              aria-label={new Date(day).toDateString()}
            >
              <span className={clsx("telemetry text-[11px]", isToday ? "text-neon" : "text-starlight-faint")}>
                {new Date(day).getDate()}
              </span>
              <span className="mt-1 flex flex-col gap-0.5">
                {items.slice(0, 2).map((t) => (
                  <span key={t.id} className="truncate rounded-[5px] bg-[rgba(101,255,154,0.08)] px-1 py-0.5 text-[9.5px] text-starlight-dim">
                    <span className="telemetry text-neon">
                      {new Date(t.scheduledFor!).toLocaleTimeString([], { hour: "numeric" })}
                    </span>{" "}
                    {t.title.replace(/^Sample: /, "")}
                  </span>
                ))}
                {items.length > 2 && (
                  <span className="px-1 text-[9px] text-starlight-faint">+{items.length - 2} more</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

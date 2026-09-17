import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, CalendarPlus2, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import clsx from "clsx";
import { Button, EmptyState, Modal, Panel, PlatformBrandMark, Segmented, StatusBadge, pushSignal } from "@posterract/hyperkit";
import type { PlatformId, TransmissionStatus } from "@posterract/contract";
import { CalendarPostDialog } from "@/components/CalendarPostDialog";
import { addCalendarDays, startOfWeek, scheduleTimeForDay, sameCalendarDay, calendarDayKey } from "@/lib/calendar-date";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import { useEngineActions, useProjections, useTransmissions } from "@/engine/useEngine";
import "@/styles/calendar.css";

export const Route = createFileRoute("/_app/continuum")({
  component: Continuum,
});

function PostStatusDot({ status }: { status: TransmissionStatus }) {
  return <span role="img" aria-label={`Status: ${status}`} title={status} className={clsx("inline-block h-1.5 w-1.5 flex-none rounded-full", status === "live" ? "bg-neon" : status === "scheduled" ? "bg-ice" : status === "failed" || status === "partial" ? "bg-redshift" : status === "canceled" ? "bg-starlight-faint" : "bg-solar")} />;
}

function CalendarPlatformLogos({ platforms }: { platforms: readonly PlatformId[] }) {
  const unique = [...new Set(platforms)];
  return (
    <span data-calendar-platforms className="calendar-post-platforms">
      {unique.map((platform) => (
        <PlatformBrandMark key={platform} platform={platform} height={18} className="flex-none" />
      ))}
      {platforms.length === 0 && <span className="text-[9px] text-starlight-faint">No targets</span>}
    </span>
  );
}

function CalendarPostSummary({ title, scheduledFor, status, platforms }: {
  title: string; scheduledFor: number; status: TransmissionStatus; platforms: readonly PlatformId[];
}) {
  return <span className="calendar-post-summary">
    <span className="calendar-post-heading">
      <span data-calendar-post-title className="calendar-post-title" title={title}>{title}</span>
      <span className="calendar-post-meta"><PostStatusDot status={status} /><time data-calendar-post-time dateTime={new Date(scheduledFor).toISOString()}>
        {new Date(scheduledFor).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </time></span>
    </span>
    <CalendarPlatformLogos platforms={platforms} />
  </span>;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const sync = () => setMatches(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** Preserve the post's local time when it moves; today's fallback stays safely in the future. */
function moveTimeToDay(original: number, day: number, now: number): number {
  const source = new Date(original);
  const target = new Date(day);
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return Math.max(target.getTime(), now + 30 * 60_000);
}

/** Give native drag-and-drop a crisp, branded card instead of the browser's translucent snapshot. */
function attachPostDragPreview(event: DragEvent<HTMLElement>) {
  const source =
    event.currentTarget.querySelector<HTMLElement>("[data-calendar-post-surface]") ?? event.currentTarget;
  const bounds = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;

  preview.classList.add("calendar-post-drag-preview");
  preview.setAttribute("aria-hidden", "true");
  preview.style.width = `${bounds.width}px`;
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.min(28, Math.max(12, bounds.width * 0.18)),
    Math.min(24, Math.max(10, bounds.height * 0.35)),
  );
  window.setTimeout(() => preview.remove(), 0);
}

/**
 * The Continuum — the schedule, one week at a time. Time is the fourth
 * dimension: scheduled transmissions sit on their day; the now-line sweeps
 * today's column in real time. Click a day's + to compose into that slot.
 */
function Continuum() {
  const transmissions = useTransmissions();
  const projections = useProjections();
  const platformsByPost = useMemo(() => {
    const grouped = new Map<string, PlatformId[]>();
    for (const projection of projections) {
      const platforms = grouped.get(projection.transmissionId) ?? [];
      if (!platforms.includes(projection.provider)) platforms.push(projection.provider);
      grouped.set(projection.transmissionId, platforms);
    }
    return grouped;
  }, [projections]);
  const { rescheduleTransmission } = useEngineActions();
  const [periodAnchor, setPeriodAnchor] = useState(() => Date.now());
  const [view, setView] = useState<"week" | "month">("month");
  const [now, setNow] = useState(Date.now());
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const closePost = useCallback(() => setSelectedPost(null), []);
  const closeDay = useCallback(() => setSelectedDay(null), []);
  const openPost = (id: string) => { setSelectedDay(null); setSelectedPost(id); };
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const showDesktopWeek = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addCalendarDays(startOfWeek(periodAnchor), i)), [periodAnchor]);
  const isCurrentPeriod =
    view === "week"
      ? startOfWeek(now) === startOfWeek(periodAnchor)
      : new Date(now).getFullYear() === new Date(periodAnchor).getFullYear() &&
        new Date(now).getMonth() === new Date(periodAnchor).getMonth();

  const byDay = useMemo(() => {
    const map = new Map<number, typeof transmissions>();
    for (const day of days) map.set(day, []);
    for (const t of transmissions) {
      if (!t.scheduledFor || t.status === "draft") continue;
      const key = days.find((d) => t.scheduledFor! >= d && t.scheduledFor! < addCalendarDays(d, 1));
      if (key !== undefined) map.get(key)!.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    return map;
  }, [transmissions, days, periodAnchor]);

  const weekLabel = `${new Date(days[0]).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date(
    days[6],
  ).toLocaleDateString([], { month: "short", day: "numeric" })}`;

  const weekTotal = days.reduce((sum, d) => sum + (byDay.get(d)?.length ?? 0), 0);
  const monthStart = new Date(new Date(periodAnchor).getFullYear(), new Date(periodAnchor).getMonth(), 1).getTime();
  const nextMonthStart = new Date(new Date(periodAnchor).getFullYear(), new Date(periodAnchor).getMonth() + 1, 1).getTime();
  const monthTotal = transmissions.filter(
    (transmission) =>
      transmission.status !== "draft" &&
      transmission.scheduledFor &&
      transmission.scheduledFor >= monthStart &&
      transmission.scheduledFor < nextMonthStart,
  ).length;
  const periodTotal = view === "week" ? weekTotal : monthTotal;

  const movePeriod = (direction: -1 | 1) => {
    if (view === "week") {
      setPeriodAnchor((current) => addCalendarDays(current, direction * 7));
      return;
    }
    setPeriodAnchor((current) => {
      const date = new Date(current);
      return new Date(date.getFullYear(), date.getMonth() + direction, 1).getTime();
    });
  };

  const beginPostDrag = (event: DragEvent<HTMLElement>, transmissionId: string) => {
    const transmission = transmissions.find((item) => item.id === transmissionId);
    if (!transmission || transmission.status !== "scheduled") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-posterract-transmission", transmissionId);
    event.dataTransfer.setData("text/plain", transmissionId);
    attachPostDragPreview(event);
    setDraggingId(transmissionId);
  };

  const allowDayDrop = (event: DragEvent<HTMLElement>, day: number) => {
    if (!draggingId || addCalendarDays(day, 1) <= now) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropDay(day);
  };

  const finishPostDrag = () => {
    setDraggingId(null);
    setDropDay(null);
  };

  const dropPostOnDay = (event: DragEvent<HTMLElement>, day: number) => {
    event.preventDefault();
    event.stopPropagation();
    const transmissionId =
      event.dataTransfer.getData("application/x-posterract-transmission") || draggingId;
    const transmission = transmissions.find((item) => item.id === transmissionId);
    finishPostDrag();
    if (
      !transmission ||
      transmission.status !== "scheduled" ||
      !transmission.scheduledFor ||
      addCalendarDays(day, 1) <= now ||
      sameCalendarDay(transmission.scheduledFor, day)
    ) {
      return;
    }

    const nextScheduledFor = moveTimeToDay(transmission.scheduledFor, day, now);
    setReschedulingId(transmission.id);
    void rescheduleTransmission(transmission.id, nextScheduledFor)
      .then(() => {
        pushSignal({
          tone: "success",
          title: "Post rescheduled",
          detail: `“${transmission.title}” moved to ${new Date(nextScheduledFor).toLocaleString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}.`,
        });
      })
      .catch((error) => {
        pushSignal({
          tone: "danger",
          title: "Could not reschedule post",
          detail: error instanceof Error ? error.message : "Try moving the post again.",
        });
      })
      .finally(() => setReschedulingId(null));
  };

  return (
    <div className="space-y-4">
      <div>
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-neon/25 bg-neon/[0.06] text-neon">
              <CalendarDays size={15} />
            </span>
            <p className="kicker !text-neon">Publishing calendar</p>
          </div>
          <h1 className="mt-3 font-display text-[clamp(24px,3vw,38px)] font-semibold tracking-[-0.03em] text-starlight">
            Plan and schedule every post.
          </h1>
          <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-starlight-dim">
            See every scheduled post in one place, choose a time, and send it to your connected accounts.
          </p>
          <Link to="/compose" className="calendar-new-post-cta" aria-label="New post">
            <span className="calendar-new-post-cta__icon" aria-hidden>
              <Plus size={20} strokeWidth={2.25} />
            </span>
            <span className="calendar-new-post-cta__copy">
              <span className="calendar-new-post-cta__label">New post</span>
              <span className="calendar-new-post-cta__meta" aria-hidden>Create or schedule</span>
            </span>
            <span className="calendar-new-post-cta__arrow" aria-hidden>
              <ArrowRight size={17} strokeWidth={1.8} />
            </span>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          indicatorTransition={{ type: "tween", duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        />
        <Button size="sm" variant="secondary" aria-label="Previous" onClick={() => movePeriod(-1)}>
          <ChevronLeft size={14} />
        </Button>
        <Button size="sm" variant="secondary" aria-label="Next" onClick={() => movePeriod(1)}>
          <ChevronRight size={14} />
        </Button>
        <p className="font-display text-[15px] font-semibold text-starlight">
          {view === "week" ? weekLabel : new Date(periodAnchor).toLocaleDateString([], { month: "long", year: "numeric" })}
        </p>
        {!isCurrentPeriod && (
          <Button size="sm" variant="tertiary" onClick={() => setPeriodAnchor(Date.now())}>
            Back to this {view}
          </Button>
        )}
        <p className="ml-auto telemetry text-[11px] text-starlight-faint">
          {Intl.DateTimeFormat().resolvedOptions().timeZone} · {periodTotal} post{periodTotal === 1 ? "" : "s"} this {view}
        </p>
      </div>

      {view === "month" ? (
        <MonthView
          anchor={periodAnchor}
          now={now}
          transmissions={transmissions}
          platformsByPost={platformsByPost}
          onPickDay={setSelectedDay}
          onPickPost={openPost}
          draggingId={draggingId}
          dropDay={dropDay}
          reschedulingId={reschedulingId}
          onDragStart={beginPostDrag}
          onDragEnd={finishPostDrag}
          onDragOverDay={allowDayDrop}
          onDropDay={dropPostOnDay}
        />
      ) : (
      <>
      {!showDesktopWeek && <div className="space-y-2" aria-label="Schedule agenda">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const past = addCalendarDays(day, 1) < now;
          const isToday = now >= day && now < addCalendarDays(day, 1);
          return (
            <section
              key={day}
              data-calendar-day={day}
              onDragOver={(event) => allowDayDrop(event, day)}
              onDrop={(event) => dropPostOnDay(event, day)}
              className={clsx(
                "calendar-day-drop-zone cursor-pointer rounded-[14px] border bg-[var(--glass-bg)] p-3 transition-[border-color,background-color,transform]",
                isToday ? "border-neon/40" : "border-[var(--glass-border)]",
                dropDay === day && "calendar-day-drop-zone--active scale-[1.01] !border-ice bg-ice/[0.07] shadow-glow-ice-sm",
                past && "opacity-65",
              )}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button, [data-draggable-post]")) return;
                setSelectedDay(day);
              }}
            >
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setSelectedDay(day)} className="group text-left" aria-label={`Open ${new Date(day).toDateString()}`}>
                  <p className={clsx("kicker !text-[9px]", isToday && "!text-neon")}>{new Date(day).toLocaleDateString([], { weekday: "long" })}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-starlight-dim">{new Date(day).toLocaleDateString([], { month: "short", day: "numeric" })}<ArrowRight size={10} className="transition-transform group-hover:translate-x-0.5" /></p>
                </button>
                <button onClick={() => setSelectedDay(day)} className="flex h-8 items-center gap-1 rounded-[10px] bg-white/[0.035] px-2.5 text-[9px] text-starlight-dim transition-colors hover:bg-neon/[0.07] hover:text-neon" aria-label={`View ${new Date(day).toDateString()}`}><CalendarDays size={11} /> View day</button>
              </div>
              <div className="mt-2 space-y-1.5">
                {items.length === 0 ? <p className="rounded-[10px] border border-dashed border-[var(--glass-border)] px-3 py-3 text-[10px] text-starlight-faint">No posts scheduled.</p> : items.map((t) => {
                  const canDrag = t.status === "scheduled" && reschedulingId !== t.id;
                  return <div key={t.id} data-draggable-post data-transmission-id={t.id} draggable={canDrag} onDragStart={(event) => beginPostDrag(event, t.id)} onDragEnd={finishPostDrag} title={canDrag ? "Drag to move this scheduled post" : undefined} className={clsx("calendar-post-shell", canDrag && "calendar-post-shell--draggable", draggingId === t.id && "is-dragging", reschedulingId === t.id && "is-rescheduling")}><button type="button" onClick={() => openPost(t.id)} aria-label={`View post: ${t.title}`} data-calendar-post-surface draggable={false} className="calendar-post-block calendar-post-block--agenda calendar-post-compact w-full text-left flex items-center gap-2 rounded-[8px]"><ArtifactThumb artifactId={t.artifactId} className="h-8 w-6 flex-none" hoverPreview={false} /><CalendarPostSummary title={t.title} scheduledFor={t.scheduledFor!} status={t.status} platforms={platformsByPost.get(t.id) ?? []} /></button></div>;
                })}
              </div>
            </section>
          );
        })}
      </div>}
      {showDesktopWeek && <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const isToday = now >= day && now < addCalendarDays(day, 1);
          const dayFrac = isToday ? (now - day) / (addCalendarDays(day, 1) - day) : 0;
          const items = byDay.get(day) ?? [];
          const past = addCalendarDays(day, 1) < now;

          return (
            <div
              key={day}
              data-calendar-day={day}
              onDragOver={(event) => allowDayDrop(event, day)}
              onDrop={(event) => dropPostOnDay(event, day)}
              className={clsx(
                "calendar-day-drop-zone relative flex h-[320px] min-w-0 cursor-pointer flex-col rounded-[var(--radius-card)] border bg-[var(--glass-bg)] p-2 transition-[border-color,background-color,transform]",
                isToday ? "border-[rgba(101,255,154,0.45)] shadow-glow-neon-sm" : "border-[var(--glass-border)]",
                dropDay === day && "calendar-day-drop-zone--active scale-[1.01] !border-ice bg-ice/[0.07] shadow-glow-ice-sm",
                past && "opacity-60",
              )}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button, [data-draggable-post]")) return;
                setSelectedDay(day);
              }}
            >
              <button type="button" onClick={() => setSelectedDay(day)} className="group mb-2 flex items-baseline justify-between rounded-[7px] px-1 text-left" aria-label={`Open ${new Date(day).toDateString()}`}>
                <p className={clsx("kicker !text-[10px]", isToday && "!text-neon")}>
                  {new Date(day).toLocaleDateString([], { weekday: "short" })}
                </p>
                <span className="flex items-center gap-1">
                  <span className={clsx("telemetry text-[12px]", isToday ? "text-neon" : "text-starlight-faint")}>{new Date(day).getDate()}</span>
                  <ArrowRight size={9} className="text-starlight-faint transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>

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
                  const canDrag = t.status === "scheduled" && reschedulingId !== t.id;
                  return (
                    <div
                      key={t.id}
                      data-draggable-post
                      data-transmission-id={t.id}
                      draggable={canDrag}
                      onDragStart={(event) => beginPostDrag(event, t.id)}
                      onDragEnd={finishPostDrag}
                      title={canDrag ? "Drag to move this scheduled post" : undefined}
                      className={clsx(
                        "calendar-post-shell",
                        canDrag && "calendar-post-shell--draggable",
                        draggingId === t.id && "is-dragging",
                        reschedulingId === t.id && "is-rescheduling",
                      )}
                    >
                    <button
                      type="button"
                      onClick={() => openPost(t.id)}
                      aria-label={`View post: ${t.title}`}
                      data-calendar-post-surface
                      draggable={false}
                      className="calendar-post-block calendar-post-block--week calendar-post-compact w-full text-left block rounded-[8px]"
                    >
                      <CalendarPostSummary title={t.title} scheduledFor={t.scheduledFor!} status={t.status} platforms={platformsByPost.get(t.id) ?? []} />
                    </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setSelectedDay(day)}
                className="mt-1.5 flex h-8 flex-none items-center justify-center gap-1.5 rounded-[10px] bg-white/[0.025] text-starlight-faint transition-colors hover:bg-neon/[0.06] hover:text-neon"
                aria-label={`View ${new Date(day).toDateString()}`}
              >
                <CalendarDays size={11} />
                <span className="text-[9px] uppercase tracking-[0.08em]">View day</span>
              </button>
            </div>
          );
        })}
      </div>}
      </>
      )}

      {weekTotal === 0 && view === "week" && (
        <Panel>
          <EmptyState
            title="Nothing scheduled this week."
            detail="Create a post now or use a day button to schedule it into a specific time slot."
            action={
              <Link to="/compose">
                <Button variant="primary">New Post</Button>
              </Link>
            }
          />
        </Panel>
      )}

      <CalendarPostDialog transmissionId={selectedPost} onClose={closePost} />
      <DayInspector
        day={selectedDay}
        now={now}
        transmissions={transmissions}
        projections={projections}
        onClose={closeDay}
        onPickPost={openPost}
      />
    </div>
  );
}

function DayInspector({
  day,
  now,
  transmissions,
  projections,
  onClose,
  onPickPost,
}: {
  day: number | null;
  now: number;
  transmissions: ReturnType<typeof useTransmissions>;
  projections: ReturnType<typeof useProjections>;
  onClose: () => void;
  onPickPost: (id: string) => void;
}) {
  const dayStart = day ?? startOfWeek(now);
  const items = transmissions
    .filter(
      (transmission) =>
        transmission.scheduledFor &&
        transmission.status !== "draft" &&
        transmission.scheduledFor >= dayStart &&
        transmission.scheduledFor < addCalendarDays(dayStart, 1),
    )
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
  const date = new Date(dayStart);
  const isToday = now >= dayStart && now < addCalendarDays(dayStart, 1);
  const isPast = addCalendarDays(dayStart, 1) <= now;
  const scheduleAt = isPast ? undefined : scheduleTimeForDay(dayStart, now);
  const dateLabel = date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
  const stateLabel = isToday ? "Today" : isPast ? "Past date" : "Upcoming";

  return (
    <Modal
      open={day !== null}
      onClose={onClose}
      kicker={`Day focus · ${items.length} post${items.length === 1 ? "" : "s"}`}
      title={dateLabel}
      width="max-w-xl"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Close</Button>
          <Link
            to="/compose"
            search={{ at: scheduleAt, artifact: undefined }}
            className="day-inspector-schedule"
            aria-label={isPast ? "Create a new post" : `Schedule a post for ${dateLabel}`}
          >
            <CalendarPlus2 size={15} />
            <span>{isPast ? "Create new post" : "Schedule this day"}</span>
            <ArrowRight size={14} className="day-inspector-schedule__arrow" />
          </Link>
        </>
      }
    >
      <div className="day-inspector-hero">
        <div className="day-inspector-date" aria-hidden>
          <span>{date.toLocaleDateString([], { month: "short" })}</span>
          <strong>{date.getDate()}</strong>
          <small>{date.toLocaleDateString([], { weekday: "short" })}</small>
        </div>
        <div className="min-w-0">
          <p className="day-inspector-state"><span aria-hidden />{stateLabel}</p>
          <p className="mt-2 font-display text-[14px] font-semibold text-starlight">
            {items.length === 0
              ? "This date is completely open."
              : `${items.length} scheduled post${items.length === 1 ? "" : "s"} on the timeline.`}
          </p>
          <p className="mt-1 max-w-sm text-[10.5px] leading-relaxed text-starlight-faint">
            {isPast
              ? "Review what shipped on this date or create a new post without changing the calendar view."
              : "Review the day, then schedule another post directly into this date when you are ready."}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="kicker !text-[8px]">Day timeline</p>
        <p className="telemetry text-[9px] text-starlight-faint">{items.length} scheduled</p>
      </div>

      {items.length === 0 ? (
        <div className="day-inspector-empty">
          <span aria-hidden><CalendarPlus2 size={17} /></span>
          <div>
            <p className="font-display text-[12px] font-semibold text-starlight">No posts yet</p>
            <p className="mt-0.5 text-[9.5px] text-starlight-faint">This day is ready for your next launch.</p>
          </div>
        </div>
      ) : (
        <div className="day-inspector-list">
          {items.map((transmission) => {
            const platforms = projections
              .filter((projection) => projection.transmissionId === transmission.id)
              .map((projection) => projection.provider) as PlatformId[];
            return (
              <button type="button" key={transmission.id} onClick={() => onPickPost(transmission.id)} aria-label={`View post: ${transmission.title}`} className="day-inspector-post w-full text-left">
                <ArtifactThumb artifactId={transmission.artifactId} className="h-9 w-7 flex-none" hoverPreview={false} />
                <CalendarPostSummary title={transmission.title} scheduledFor={transmission.scheduledFor!} status={transmission.status} platforms={platforms} />
                <StatusBadge status={transmission.status} size="sm" />
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}


function MonthView({
  anchor,
  now,
  transmissions,
  platformsByPost,
  onPickDay,
  onPickPost,
  draggingId,
  dropDay,
  reschedulingId,
  onDragStart,
  onDragEnd,
  onDragOverDay,
  onDropDay,
}: {
  anchor: number;
  now: number;
  transmissions: ReturnType<typeof useTransmissions>;
  platformsByPost: ReadonlyMap<string, readonly PlatformId[]>;
  onPickDay: (day: number) => void;
  onPickPost: (id: string) => void;
  draggingId: string | null;
  dropDay: number | null;
  reschedulingId: string | null;
  onDragStart: (event: DragEvent<HTMLElement>, transmissionId: string) => void;
  onDragEnd: () => void;
  onDragOverDay: (event: DragEvent<HTMLElement>, day: number) => void;
  onDropDay: (event: DragEvent<HTMLElement>, day: number) => void;
}) {
  const anchorDate = new Date(anchor);
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1).getTime();
  const gridStart = startOfWeek(first);
  const leadingDays = (new Date(first).getDay() + 6) % 7;
  const daysInMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const cells = useMemo(() => Array.from({ length: cellCount }, (_, i) => addCalendarDays(gridStart, i)), [gridStart, cellCount]);
  const month = anchorDate.getMonth();

  const transmissionsByDay = useMemo(() => {
    const grouped = new Map<string, Array<(typeof transmissions)[number]>>();
    for (const transmission of transmissions) {
      if (!transmission.scheduledFor || transmission.status === "draft") continue;
      const key = calendarDayKey(transmission.scheduledFor);
      const day = grouped.get(key);
      if (day) day.push(transmission);
      else grouped.set(key, [transmission]);
    }
    for (const items of grouped.values()) items.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    return grouped;
  }, [transmissions]);

  return (
    <div className="calendar-month-scroll" role="region" aria-label="Month calendar" tabIndex={0}>
      <div className="calendar-month-content">
      <div className="mb-1 grid grid-cols-7 gap-1.5 px-0.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <p key={d} className="kicker !text-[9px] text-center">{d}</p>
        ))}
      </div>
      <div className="calendar-month-grid grid grid-cols-7 gap-1.5">
        {cells.map((day) => {
          const inMonth = new Date(day).getMonth() === month;
          const isToday = now >= day && now < addCalendarDays(day, 1);
          const items = transmissionsByDay.get(calendarDayKey(day)) ?? [];
          return (
            <div
              key={day}
              role="group"
              data-calendar-day={day}
              onClick={() => onPickDay(day)}
              onDragOver={(event) => onDragOverDay(event, day)}
              onDrop={(event) => onDropDay(event, day)}
              className={clsx(
                "calendar-day-drop-zone calendar-month-day flex min-w-0 flex-col rounded-[8px] border text-left transition-[border-color,background-color,transform] hover:border-[var(--glass-border-bright)]",
                isToday ? "border-[rgba(101,255,154,0.45)] shadow-glow-neon-sm" : "border-[var(--glass-border)]",
                dropDay === day && "calendar-day-drop-zone--active scale-[1.015] !border-ice bg-ice/[0.08] shadow-glow-ice-sm",
                inMonth ? "bg-[var(--glass-bg)]" : "bg-transparent opacity-40",
              )}
              aria-label={new Date(day).toDateString()}
            >
              <div className="calendar-month-day-heading">
              <button type="button" onClick={(event) => { event.stopPropagation(); onPickDay(day); }} aria-label={`View ${new Date(day).toDateString()}`} className={clsx("text-left text-[10px] leading-[14px] tabular-nums", isToday ? "text-neon" : "text-starlight-faint")}>
                {new Date(day).getDate()}
              </button>
              </div>
              <span className="calendar-month-posts">
                {items.slice(0, 2).map((t) => {
                  const canDrag = t.status === "scheduled" && reschedulingId !== t.id;
                  return (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onPickPost(t.id); }}
                    aria-label={`View post: ${t.title}`}
                    key={t.id}
                    data-draggable-post
                    data-transmission-id={t.id}
                    draggable={canDrag}
                    onDragStart={(event) => onDragStart(event, t.id)}
                    onDragEnd={onDragEnd}
                    title={t.title}
                    className={clsx(
                      "calendar-post-block calendar-post-block--month calendar-post-compact min-w-0 rounded-[6px] text-left text-starlight",
                      canDrag && "calendar-post-shell--draggable",
                      draggingId === t.id && "is-dragging",
                      reschedulingId === t.id && "is-rescheduling",
                    )}
                    data-calendar-post-surface
                  >
                    <CalendarPostSummary title={t.title} scheduledFor={t.scheduledFor!} status={t.status} platforms={platformsByPost.get(t.id) ?? []} />
                  </button>
                  );
                })}
              </span>
              {items.length > 2 && <button type="button" className="calendar-month-more" onClick={(event) => { event.stopPropagation(); onPickDay(day); }} aria-label={`View ${items.length - 2} more posts on ${new Date(day).toDateString()}`}>+{items.length - 2} more</button>}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

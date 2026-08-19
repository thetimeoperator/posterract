import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Copy, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Button,
  Countdown,
  EmptyState,
  Panel,
  PlatformRuneRow,
  StatusBadge,
  pushSignal,
} from "@posterract/hyperkit";
import type { PlatformId, TransmissionDTO, TransmissionStatus } from "@posterract/contract";
import { PLATFORM_CAPABILITIES } from "@posterract/contract";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import { useEngineActions, useEvents, useProjections, useTransmissions } from "@/engine/useEngine";
import { formatWhen } from "@/lib/fmt";

export const Route = createFileRoute("/_app/transmissions")({
  component: Transmissions,
});

type Filter = "all" | TransmissionStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "transmitting", label: "Transmitting" },
  { value: "live", label: "Live" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
];

function Transmissions() {
  const transmissions = useTransmissions();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useMemo(() => {
    const filtered = filter === "all" ? transmissions : transmissions.filter((t) => t.status === filter);
    return [...filtered].sort((a, b) => (b.scheduledFor ?? b.createdAt) - (a.scheduledFor ?? a.createdAt));
  }, [transmissions, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={clsx(
              "h-7 rounded-full border px-3 font-display text-[11px] font-medium transition-colors",
              filter === f.value
                ? "border-[rgba(101,255,154,0.5)] bg-[rgba(101,255,154,0.08)] text-neon"
                : "border-[var(--glass-border)] text-starlight-dim hover:text-starlight",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Panel className="min-h-[50vh]">
          <EmptyState
            title={filter === "all" ? "No transmissions yet." : `No ${filter} transmissions.`}
            detail="Compose one — upload a video, pick platforms, choose a time."
            action={
              <Link to="/compose">
                <Button variant="primary">New Post</Button>
              </Link>
            }
          />
        </Panel>
      ) : (
        <ul className="space-y-2.5">
          {list.map((t) => (
            <TransmissionRow key={t.id} t={t} expanded={expanded === t.id} onToggle={() => setExpanded((cur) => (cur === t.id ? null : t.id))} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TransmissionRow({
  t,
  expanded,
  onToggle,
}: {
  t: TransmissionDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  const projections = useProjections().filter((p) => p.transmissionId === t.id);
  const events = useEvents().filter((e) => e.transmissionId === t.id);
  const { cancelTransmission, duplicateTransmission, retryProjection } = useEngineActions();

  const statusDots = Object.fromEntries(
    projections.map((p) => [
      p.provider,
      p.status === "live"
        ? "live"
        : p.status === "failed" || p.status === "needs_reauth" || p.status === "blocked"
          ? "failed"
          : p.status === "scheduled" || p.status === "pending"
            ? "pending"
            : "transmitting",
    ]),
  ) as Partial<Record<PlatformId, "live" | "pending" | "failed" | "transmitting">>;

  return (
    <li>
      <div
        className={clsx(
          "glass relative overflow-hidden rounded-[var(--radius-card)] transition-colors",
          t.status === "transmitting" && "hk-pulse-aura",
        )}
        style={{
          borderLeft: `2px solid ${
            t.status === "live"
              ? "var(--auroral)"
              : t.status === "failed"
                ? "var(--redshift)"
                : t.status === "partial"
                  ? "var(--solar)"
                  : t.status === "transmitting"
                    ? "var(--ice)"
                    : "var(--glass-border-bright)"
          }`,
        }}
      >
        <div className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3 px-3 py-3 sm:flex sm:items-center sm:gap-4 sm:px-4">
          <ArtifactThumb artifactId={t.artifactId} className="h-16 w-10 flex-none" hoverPreview={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-starlight">{t.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <PlatformRuneRow platforms={projections.map((p) => p.provider)} statusDots={statusDots} />
              <span className="telemetry text-[11px] text-starlight-faint">{formatWhen(t.scheduledFor)}</span>
              {t.status === "scheduled" && t.scheduledFor && t.scheduledFor > Date.now() && (
                <Countdown to={t.scheduledFor} className="text-[11px]" />
              )}
            </div>
          </div>
          <div className="col-start-2 flex items-center justify-between gap-2 sm:contents">
          <StatusBadge status={t.status} />
          <div className="flex flex-none items-center gap-1">
            {t.status === "scheduled" && (
              <Button
                size="sm"
                variant="secondary"
                aria-label="Cancel transmission"
                onClick={() => cancelTransmission(t.id)}
              >
                <XCircle size={13} className="text-redshift" />
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              aria-label="Duplicate transmission"
              onClick={() => {
                duplicateTransmission(t.id);
                pushSignal({ tone: "info", title: "Duplicated", detail: "Copy scheduled one hour from now — edit it in the queue." });
              }}
            >
              <Copy size={13} />
            </Button>
            <Button size="sm" variant="secondary" aria-label={expanded ? "Collapse log" : "Expand log"} onClick={onToggle}>
              <ChevronDown size={14} className={clsx("transition-transform", expanded && "rotate-180")} />
            </Button>
          </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-[var(--glass-border)]"
            >
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
                {/* Per-platform projections */}
                <div className="space-y-2">
                  <p className="kicker !text-[10px]">Projections</p>
                  {projections.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-[10px] border border-[var(--glass-border)] px-3 py-2">
                      <span className="w-20 flex-none text-[12px] text-starlight-dim">
                        {PLATFORM_CAPABILITIES[p.provider].label}
                      </span>
                      <StatusBadge status={p.status} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-starlight-faint">
                        {p.errorSummary ?? ""}
                      </span>
                      {p.platformPostUrl && (
                        <a
                          href={p.platformPostUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex flex-none items-center gap-1 text-[11px] text-neon hover:underline"
                        >
                          View <ExternalLink size={10} />
                        </a>
                      )}
                      {(p.status === "failed" || p.status === "needs_reauth") && (
                        <Button size="sm" variant="secondary" icon={<RotateCcw size={11} />} onClick={() => retryProjection(p.id)}>
                          Retry
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {/* Transmission log */}
                <div>
                  <p className="kicker mb-2 !text-[10px]">Transmission log</p>
                  <div className="telemetry max-h-44 space-y-1 overflow-y-auto rounded-[10px] bg-void-1 px-3 py-2 text-[11px]">
                    {events.length === 0 && <p className="text-starlight-faint">Awaiting launch…</p>}
                    {[...events].reverse().map((e) => (
                      <p key={e.id} className="text-starlight-dim">
                        <span className="text-starlight-faint">
                          {new Date(e.at).toLocaleTimeString([], { hour12: false })}
                        </span>{" "}
                        ▸ {e.message}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

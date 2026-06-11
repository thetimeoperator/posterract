import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { EmptyState } from "@posterract/hyperkit";
import type { EventDTO } from "@posterract/contract";
import { useUI } from "@/state/ui";
import { mockEvents } from "@/mock/data";

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function toneFor(type: EventDTO["type"]): string {
  if (type.includes("failed") || type.includes("error")) return "var(--redshift)";
  if (type.includes("live")) return "var(--auroral)";
  if (type.includes("reauth") || type.includes("warn")) return "var(--solar)";
  return "var(--neon)";
}

/**
 * Signals — slide-over activity feed: publish results, token warnings,
 * platform cap warnings. (Mock data until Phase 4.)
 */
export function SignalsPanel() {
  const { signalsOpen, setSignalsOpen } = useUI();
  const events = mockEvents;

  return createPortal(
    <AnimatePresence>
      {signalsOpen && (
        <motion.div
          className="fixed inset-0 z-[var(--z-overlay)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            aria-label="Close Signals"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-[rgba(5,8,11,0.5)]"
            onClick={() => setSignalsOpen(false)}
          />
          <motion.aside
            role="dialog"
            aria-label="Signals — notifications"
            className="absolute bottom-0 right-0 top-0 flex w-96 flex-col border-l border-[var(--glass-border)] bg-[rgba(7,13,17,0.92)] backdrop-blur-2xl"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="flex h-16 flex-none items-center justify-between border-b border-[var(--glass-border)] px-5">
              <div>
                <p className="kicker">Signals</p>
                <p className="-mt-0.5 text-[12px] text-starlight-faint">Activity & alerts</p>
              </div>
              <button
                onClick={() => setSignalsOpen(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-starlight-dim transition-colors hover:text-starlight"
              >
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {events.length === 0 ? (
                <EmptyState title="All quiet on every frequency." detail="Publish results and portal alerts will appear here." />
              ) : (
                <ul className="space-y-1.5">
                  {events.map((ev) => (
                    <li
                      key={ev.id}
                      className="glass rounded-[var(--radius-card)] px-3.5 py-3"
                      style={{ borderLeft: `2px solid ${toneFor(ev.type)}` }}
                    >
                      <p className="text-[12.5px] leading-snug text-starlight">{ev.message}</p>
                      <p className="telemetry mt-1 text-[10px] text-starlight-faint">
                        {ev.type} · {timeAgo(ev.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

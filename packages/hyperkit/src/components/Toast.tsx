import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { create } from "zustand";

export type SignalTone = "info" | "success" | "warning" | "danger";

export type Signal = {
  id: number;
  tone: SignalTone;
  title: string;
  detail?: string;
  /** Accent override (e.g. a platform color). */
  accent?: string;
};

type SignalStore = {
  signals: Signal[];
  push: (signal: Omit<Signal, "id">) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useSignals = create<SignalStore>((set) => ({
  signals: [],
  push: (signal) => {
    const id = nextId++;
    set((s) => ({ signals: [...s.signals.slice(-3), { ...signal, id }] }));
    setTimeout(() => set((s) => ({ signals: s.signals.filter((t) => t.id !== id) })), 5200);
  },
  dismiss: (id) => set((s) => ({ signals: s.signals.filter((t) => t.id !== id) })),
}));

/** Convenience: pushSignal({tone:'success', title:'Transmission live'}) */
export function pushSignal(signal: Omit<Signal, "id">) {
  useSignals.getState().push(signal);
}

const TONE_ACCENT: Record<SignalTone, string> = {
  info: "var(--hyper-cyan)",
  success: "var(--auroral)",
  warning: "var(--solar)",
  danger: "var(--redshift)",
};

/** Mount once in the app shell. Bottom-right stack of glass signal toasts. */
export function SignalHost() {
  const { signals, dismiss } = useSignals();
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[var(--z-toast)] flex w-80 flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      <AnimatePresence>
        {signals.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="glass pointer-events-auto relative overflow-hidden rounded-[var(--radius-card)] py-3 pl-4 pr-9"
            style={{ borderLeft: `2px solid ${t.accent ?? TONE_ACCENT[t.tone]}` }}
            role="status"
          >
            <p className="font-display text-[13px] font-semibold text-starlight">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-[12px] leading-snug text-starlight-dim">{t.detail}</p>}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="absolute right-2.5 top-2.5 text-starlight-faint transition-colors hover:text-starlight"
            >
              <span aria-hidden className="text-[13px] leading-none">✕</span>
            </button>
            <span
              aria-hidden
              className={clsx("absolute bottom-0 left-0 h-px")}
              style={{
                background: t.accent ?? TONE_ACCENT[t.tone],
                animation: "hk-toast-drain 5.2s linear forwards",
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      <style>{`@keyframes hk-toast-drain { from { width: 100% } to { width: 0 } }`}</style>
    </div>,
    document.body,
  );
}

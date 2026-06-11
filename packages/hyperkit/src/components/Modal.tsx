import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width utility, default 'max-w-lg'. */
  width?: string;
};

/**
 * Portal modal — backdrop deep-blurs the void; the panel scales in from 0.96
 * with an iridescent edge flash.
 */
export function Modal({ open, onClose, kicker, title, children, footer, width = "max-w-lg" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        // Simple focus trap
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button, input, textarea")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-[rgba(2,1,10,0.7)] backdrop-blur-md"
            onClick={onClose}
            tabIndex={-1}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : kicker}
            className={clsx("glass relative w-full rounded-[var(--radius-panel)] shadow-glow-violet-md", width)}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="flex items-start justify-between gap-4 px-6 pt-5">
              <div>
                {kicker && <p className="kicker">{kicker}</p>}
                {title && (
                  <h2 className="mt-0.5 font-display text-[17px] font-semibold text-starlight">{title}</h2>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="rounded-md p-1.5 text-starlight-dim transition-colors hover:text-starlight"
              >
                <X size={16} />
              </button>
            </header>
            <div className="px-6 py-4">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-[var(--glass-border)] px-6 py-4">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

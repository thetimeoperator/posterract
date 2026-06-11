import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Plus } from "lucide-react";
import clsx from "clsx";
import { useUI } from "@/state/ui";
import { NAV_ITEMS } from "./nav";

type Command = {
  id: string;
  label: string;
  sub: string;
  run: () => void;
  icon?: React.ReactNode;
};

/**
 * The Navigator — ⌘K command palette. Jump anywhere; quick actions.
 */
export function Navigator() {
  const { navigatorOpen, setNavigatorOpen } = useUI();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setNavigatorOpen(!useUI.getState().navigatorOpen);
      }
      if (e.key === "Escape") setNavigatorOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setNavigatorOpen]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      setNavigatorOpen(false);
      void navigate({ to: path });
    };
    return [
      {
        id: "compose",
        label: "New Transmission",
        sub: "Compose and schedule a post",
        run: go("/compose"),
        icon: <Plus size={14} />,
      },
      ...NAV_ITEMS.filter((i) => !i.locked).map((i) => ({
        id: i.path,
        label: i.alien,
        sub: i.plain,
        run: go(i.path),
        icon: <i.icon size={14} />,
      })),
      {
        id: "dev-hyperkit",
        label: "Dev: Hyperkit gallery",
        sub: "Internal — design system reference",
        run: go("/dev/hyperkit"),
      },
      {
        id: "dev-core",
        label: "Dev: Core lab",
        sub: "Internal — device state test bench",
        run: go("/dev/core"),
      },
    ];
  }, [navigate, setNavigatorOpen]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (navigatorOpen) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [navigatorOpen]);

  useEffect(() => setIndex(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[index]?.run();
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return createPortal(
    <AnimatePresence>
      {navigatorOpen && (
        <motion.div
          className="fixed inset-0 z-[var(--z-navigator)] flex items-start justify-center pt-[18vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            aria-label="Close Navigator"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-[rgba(5,8,11,0.66)] backdrop-blur-sm"
            onClick={() => setNavigatorOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Navigator"
            className="glass relative w-full max-w-xl overflow-hidden rounded-[var(--radius-panel)] shadow-glow-violet-md"
            initial={{ scale: 0.97, y: -8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, y: -6, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-5">
              <span className="kicker">Navigator</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to… or type a command"
                aria-label="Search commands"
                className="h-12 flex-1 bg-transparent text-[14px] text-starlight placeholder:text-starlight-faint focus:outline-none"
              />
            </div>
            <ul ref={listRef} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-[13px] text-starlight-faint">
                  Nothing in this dimension.
                </li>
              )}
              {filtered.map((cmd, i) => (
                <li key={cmd.id} data-index={i} role="option" aria-selected={i === index}>
                  <button
                    type="button"
                    onClick={cmd.run}
                    onMouseEnter={() => setIndex(i)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors",
                      i === index ? "bg-[rgba(101,255,154,0.07)]" : "hover:bg-[rgba(155,255,197,0.06)]",
                    )}
                  >
                    <span className={clsx("text-starlight-dim", i === index && "text-neon")}>
                      {cmd.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          "block truncate font-display text-[13px] font-semibold",
                          i === index ? "text-starlight" : "text-starlight-dim",
                        )}
                      >
                        {cmd.label}
                      </span>
                      <span className="block truncate text-[11px] text-starlight-faint">{cmd.sub}</span>
                    </span>
                    {i === index && <CornerDownLeft size={13} className="flex-none text-starlight-faint" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

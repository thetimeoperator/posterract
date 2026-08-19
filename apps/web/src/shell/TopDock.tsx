import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Command, MoreHorizontal, Plus, RadioTower } from "lucide-react";
import clsx from "clsx";
import { MiniTesseract } from "@posterract/hyperkit";
import { Dock, DockIcon, DockItem } from "@/components/ui/dock";
import { LiquidSurface } from "@/components/LiquidSurface";
import { useUI } from "@/state/ui";
import { AccountMenu } from "./AccountMenu";
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS, isNavActive } from "./nav";

export function TopDock() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const systemState = useUI((state) => state.systemState);
  const setNavigatorOpen = useUI((state) => state.setNavigatorOpen);
  const setSignalsOpen = useUI((state) => state.setSignalsOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  const secondaryActive = SECONDARY_NAV_ITEMS.some((item) => isNavActive(pathname, item.path));

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-spine)] flex justify-center px-2 pt-[max(10px,env(safe-area-inset-top))] sm:px-4">
      <LiquidSurface preset="dock" className="top-dock-shell w-full max-w-[1040px] rounded-[24px]">
        <div className="flex min-w-0 items-center gap-1 px-2">
          <Link
            to="/forge"
            aria-label="Posterract Forge"
            className="group flex h-11 flex-none items-center gap-2 rounded-[16px] px-2.5 text-starlight transition-colors hover:bg-[rgba(101,255,154,0.06)]"
          >
            <MiniTesseract size={25} state={systemState} />
            <span className="hidden whitespace-nowrap font-display text-[12px] font-bold tracking-[0.17em] sm:block">
              POSTER<span className="text-neon">RACT</span>
            </span>
          </Link>

          <span className="mx-1 h-7 w-px flex-none bg-[var(--glass-border)]" aria-hidden />

          <div className="min-w-0 flex-1">
            <Dock className="mx-auto">
              {PRIMARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(pathname, item.path);
                return (
                  <DockItem key={item.path} label={item.label} active={active}>
                    <Link
                      to={item.path}
                      aria-label={`${item.label} — ${item.flavor}`}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "relative flex h-10 w-full items-center justify-center rounded-[14px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/70",
                        active
                          ? "border-[rgba(101,255,154,0.34)] text-neon"
                          : "border-transparent text-starlight-faint hover:text-starlight",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="dock-active-lens"
                          className="absolute inset-0 rounded-[14px] bg-[linear-gradient(135deg,rgba(101,255,154,0.14),rgba(124,247,255,0.05))] shadow-glow-neon-sm"
                          transition={{ type: "spring", stiffness: 260, damping: 26 }}
                        />
                      )}
                      <DockIcon>
                        <Icon className="relative z-10 h-full w-full" strokeWidth={1.8} />
                      </DockIcon>
                      {active && <span className="dock-light-trace" aria-hidden />}
                    </Link>
                  </DockItem>
                );
              })}
              <DockItem label="More" active={secondaryActive || moreOpen}>
                <button
                  type="button"
                  aria-label="More Posterract destinations"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                  className={clsx("flex h-10 w-full items-center justify-center rounded-[14px] border transition-colors hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/70", secondaryActive ? "border-neon/30 bg-neon/[0.08] text-neon" : "border-transparent text-starlight-faint")}
                >
                  <DockIcon><MoreHorizontal className="h-full w-full" /></DockIcon>
                </button>
              </DockItem>
            </Dock>
          </div>

          <span className="mx-1 hidden h-7 w-px flex-none bg-[var(--glass-border)] md:block" aria-hidden />
          <div className="hidden flex-none items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => setNavigatorOpen(true)}
              className="dock-utility"
              aria-label="Open command palette"
            ><Command size={15} /></button>
            <button
              type="button"
              onClick={() => setSignalsOpen(true)}
              className="dock-utility relative"
              aria-label="Open notifications"
            >
              <Bell size={15} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-neon shadow-glow-neon-sm" />
            </button>
            <Link to="/compose" className="dock-create" aria-label="Create a new post"><Plus size={16} /></Link>
            <AccountMenu />
          </div>
        </div>
      </LiquidSurface>

      <AnimatePresence>
        {moreOpen && (
          <>
            <button className="pointer-events-auto fixed inset-0 -z-10 cursor-default" aria-label="Close more menu" onClick={() => setMoreOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto absolute right-3 top-[calc(100%+8px)] w-[270px] sm:right-[max(16px,calc((100vw-1040px)/2))]"
            >
              <LiquidSurface preset="modal" className="rounded-[22px] p-2 shadow-2xl">
                <p className="kicker px-3 pb-2 pt-2">Systems</p>
                {SECONDARY_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(pathname, item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMoreOpen(false)}
                      className={clsx("flex items-center gap-3 rounded-[13px] px-3 py-2.5 transition-colors", active ? "bg-neon/10 text-neon" : "text-starlight-dim hover:bg-white/[0.04] hover:text-starlight")}
                    >
                      <Icon size={16} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-[12px] font-semibold">{item.label}</span>
                        <span className="block text-[10px] text-starlight-faint">{item.flavor}</span>
                      </span>
                    </Link>
                  );
                })}
                <div className="mt-1 grid grid-cols-2 gap-1 border-t border-[var(--glass-border)] pt-2 md:hidden">
                  <button onClick={() => { setMoreOpen(false); setNavigatorOpen(true); }} className="dock-more-action"><Command size={13} /> Commands</button>
                  <button onClick={() => { setMoreOpen(false); setSignalsOpen(true); }} className="dock-more-action"><RadioTower size={13} /> Signals</button>
                </div>
              </LiquidSurface>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

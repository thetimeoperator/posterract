import { motion } from "framer-motion";
import { Link, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { Dock, DockIcon, DockItem } from "@/components/ui/dock";
import { LiquidSurface } from "@/components/LiquidSurface";
import { MVP_NAV_ITEMS, isNavActive } from "./nav";

/** A compact, buttons-only navigation lens anchored to the bottom edge. */
export function BottomDock() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav
      aria-label="Posterract dock"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-spine)] flex justify-center px-2 pb-[max(10px,env(safe-area-inset-bottom))]"
    >
      <LiquidSurface preset="dock" className="bottom-dock-shell relative z-20 rounded-full">
        <Dock className="bottom-dock-buttons" panelHeight={58} magnification={64}>
          {MVP_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.path);
            return (
              <DockItem key={item.path} label={item.label} active={active} className="bottom-dock-item">
                <Link
                  to={item.path}
                  aria-label={`${item.label} — ${item.flavor}`}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "relative flex h-full w-full items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/70",
                    active ? "border-transparent text-neon" : "border-transparent text-starlight-dim hover:text-white",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-active-lens"
                      className="bottom-dock-active absolute inset-0 rounded-full"
                      transition={{ type: "spring", stiffness: 280, damping: 27 }}
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
        </Dock>
      </LiquidSurface>
    </nav>
  );
}

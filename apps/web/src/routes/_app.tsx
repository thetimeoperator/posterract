import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { SignalHost, Starfield } from "@posterract/hyperkit";
import { Spine } from "@/shell/Spine";
import { TopBar } from "@/shell/TopBar";
import { Navigator } from "@/shell/Navigator";
import { SignalsPanel } from "@/shell/SignalsPanel";
import { useUI } from "@/state/ui";
import { ENGINE_MODE, useEngineBoot } from "@/engine/useEngine";
import { WarpingIn } from "@/shell/SystemStates";
import { Homepage } from "@/marketing/Homepage";
import { useAuthState } from "@/lib/useAuthState";

export const Route = createFileRoute("/_app")({
  component: ENGINE_MODE === "cloud" ? GuardedAppShell : AppShell,
});

/** Cloud mode: signed-out visitors see the public homepage; the product remains protected. */
function GuardedAppShell(): ReactElement {
  const { isLoading, isAuthenticated } = useAuthState();
  const pathname: string = useRouterState({ select: (s) => s.location.pathname });
  if (isLoading) return pathname === "/" ? <Homepage /> : <WarpingIn />;
  if (!isAuthenticated) {
    if (pathname === "/") return <Homepage />;
    return <Navigate to="/" />;
  }
  return <AppShell />;
}

/**
 * The Posterract shell: the chamber (black + green core glow + 84px grid,
 * original Vidtryx heritage) → starfield → Spine + TopBar → page.
 */
function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const collapsed = useUI((s) => s.spineCollapsed);
  useEngineBoot();

  return (
    <div className="chamber relative min-h-screen">
      <div className="chamber-grid fixed inset-0" aria-hidden />
      <div className="pointer-events-none fixed inset-0">
        <Starfield />
      </div>

      <Spine />

      <div
        className={clsx(
          "relative z-[var(--z-content)] transition-[padding] duration-300 ease-[var(--ease-warp)]",
          collapsed ? "pl-16" : "pl-60",
        )}
      >
        <TopBar />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            initial={{ opacity: 0, scale: 1.01, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.99, filter: "blur(6px)" }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-6 py-6"
          >
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>

      <Navigator />
      <SignalsPanel />
      <SignalHost />
    </div>
  );
}

import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import { SignalHost } from "@posterract/hyperkit";
import { TopDock } from "@/shell/TopDock";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";
import { Navigator } from "@/shell/Navigator";
import { SignalsPanel } from "@/shell/SignalsPanel";
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
 * Persistent liquid-space shell. The backdrop and dock never remount between
 * routes, so motion reads as one continuous workspace rather than page loads.
 */
function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const reducedMotion = Boolean(useReducedMotion());
  useEngineBoot();

  return (
    <div className="chamber relative min-h-screen overflow-x-hidden">
      <SpaceBackdrop />
      <TopDock />

      <div className="relative z-[var(--z-content)] pt-[92px] sm:pt-[102px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10, filter: reducedMotion ? "none" : "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -5, filter: reducedMotion ? "none" : "blur(4px)" }}
            transition={{ duration: reducedMotion ? 0.1 : 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto min-h-[calc(100vh-102px)] w-full max-w-[1500px] px-3 pb-8 pt-4 sm:px-6 sm:pt-6"
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

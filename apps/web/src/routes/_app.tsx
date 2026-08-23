import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { SignalHost } from "@posterract/hyperkit";
import { AppHeader } from "@/shell/AppHeader";
import { BottomDock } from "@/shell/BottomDock";
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
  useEngineBoot();

  return (
    <div className="chamber relative min-h-screen overflow-x-hidden">
      <SpaceBackdrop />
      <AppHeader />
      <BottomDock />

      <div className="relative z-[var(--z-content)] pt-[70px] sm:pt-[76px]">
        <main className="mx-auto min-h-[calc(100vh-76px)] w-full max-w-[1500px] px-3 pb-[calc(108px+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6">
          <Outlet />
        </main>
      </div>

      <Navigator />
      <SignalsPanel />
      <SignalHost />
    </div>
  );
}

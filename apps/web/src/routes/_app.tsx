import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useLayoutEffect, type ReactElement } from "react";
import { SignalHost } from "@posterract/hyperkit";
import { AppHeader } from "@/shell/AppHeader";
import { BottomDock } from "@/shell/BottomDock";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";
import { Navigator } from "@/shell/Navigator";
import { SignalsPanel } from "@/shell/SignalsPanel";
import { ENGINE_BACKEND, ENGINE_MODE, startEngine, useEngineBoot } from "@/engine/useEngine";
import { WarpingIn } from "@/shell/SystemStates";
import { useAuthState } from "@/lib/useAuthState";
import { BillingGate } from "@/billing/BillingGate";
import { isPosterractDesktop } from "@/lib/desktop";
import { useDesktopAuth } from "@/lib/desktopAuth";
import { DesktopSignIn } from "@/components/DesktopSignIn";

/**
 * The public homepage is for signed-out visitors at "/": it loads on its own,
 * so the app never downloads the landing's code and styles. At "/" it starts
 * loading straight away, alongside the session check.
 */
const loadHomepage = () => import("@/marketing/Homepage");
const Homepage = lazy(() => loadHomepage().then((module) => ({ default: module.Homepage })));
if (typeof window !== "undefined" && window.location.pathname === "/") void loadHomepage();

function PublicHomepage(): ReactElement {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030506]" />}>
      <Homepage />
    </Suspense>
  );
}

export const Route = createFileRoute("/_app")({
  component: ENGINE_MODE === "cloud"
    ? isPosterractDesktop()
      ? DesktopGuardedAppShell
      : GuardedAppShell
    : AppShell,
});

function DesktopGuardedAppShell(): ReactElement {
  const auth = useDesktopAuth();
  const userId = auth.status === "signed_in" ? auth.session?.user?.id : undefined;
  // Signed in: last visit's data paints at once, and the real data starts loading beside the billing check.
  useLayoutEffect(() => startEngine(userId), [userId]);
  if (auth.status !== "signed_in") return <DesktopSignIn />;
  return ENGINE_BACKEND === "postgres" ? <BillingGate><AppShell /></BillingGate> : <AppShell />;
}

/** Cloud mode: signed-out visitors see the public homepage; the product remains protected. */
function GuardedAppShell(): ReactElement {
  const { isLoading, isAuthenticated, user } = useAuthState();
  const pathname: string = useRouterState({ select: (s) => s.location.pathname });
  const userId = isAuthenticated ? user?.id : undefined;
  // Signed in: last visit's data paints at once, and the real data starts loading beside the billing check.
  useLayoutEffect(() => startEngine(userId), [userId]);
  if (isLoading) return pathname === "/" ? <PublicHomepage /> : <WarpingIn />;
  if (!isAuthenticated) {
    if (pathname === "/") return <PublicHomepage />;
    return <Navigate to="/" />;
  }
  return ENGINE_BACKEND === "postgres" ? (
    <BillingGate>
      <AppShell />
    </BillingGate>
  ) : (
    <AppShell />
  );
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

import { Outlet, createRootRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { HullBreach, WarpingIn } from "@/shell/SystemStates";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: LostDimension,
  errorComponent: ({ error, reset }) => <HullBreach error={error} reset={reset} />,
  pendingComponent: WarpingIn,
});

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!window.desktop) return;
    return window.desktop.on("cli:request", (payload) => {
      const editorFrame = document.querySelector<HTMLIFrameElement>('iframe[title="Posterract Create editor"]');
      const editorReady = editorFrame?.contentDocument?.readyState === "complete";
      if (pathname === "/create" && editorReady) {
        editorFrame.contentWindow?.postMessage(
          { type: "posterract-cli-request", payload },
          "*",
        );
        return;
      }
      window.__posterractPendingCliRequests ??= [];
      window.__posterractPendingCliRequests.push(payload);
      if (pathname !== "/create") void navigate({ to: "/create" });
    });
  }, [navigate, pathname]);

  return (
    <div className="relative min-h-full">
      <Outlet />
    </div>
  );
}

function LostDimension() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="kicker">404 — Uncharted</p>
      <h1 className="font-display text-2xl text-starlight">
        Lost in a dimension that doesn&apos;t exist.
      </h1>
      <a href="/" className="text-neon underline underline-offset-4">
        Return to the Bridge
      </a>
    </main>
  );
}

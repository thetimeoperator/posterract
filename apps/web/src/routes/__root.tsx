import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: LostDimension,
});

function RootLayout() {
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
      <a href="/" className="text-hyper-cyan underline underline-offset-4">
        Return to the Bridge
      </a>
    </main>
  );
}

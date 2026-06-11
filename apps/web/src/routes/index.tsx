import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Bridge,
});

function Bridge() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="kicker">The Bridge — Dashboard</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight text-iridescent">
        POSTERRACT
      </h1>
      <p className="max-w-sm text-center text-starlight-dim">
        One artifact. Six projections. The fourth dimension is time.
      </p>
    </main>
  );
}

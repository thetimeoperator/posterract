import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { SignalHost, Starfield } from "@posterract/hyperkit";
import { Spine } from "@/shell/Spine";
import { TopBar } from "@/shell/TopBar";
import { Navigator } from "@/shell/Navigator";
import { SignalsPanel } from "@/shell/SignalsPanel";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

/**
 * The Posterract shell: void gradient → starfield → Spine + TopBar → page.
 * Pages transition with the "dimensional shift".
 */
function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="relative min-h-screen bg-void-0">
      {/* Nebula wash */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 75% -10%, rgba(139,92,246,0.07), transparent 60%), radial-gradient(700px 500px at 15% 110%, rgba(94,242,255,0.05), transparent 60%)",
        }}
      />
      <div className="pointer-events-none fixed inset-0">
        <Starfield />
      </div>

      <Spine />

      <div className="relative z-[var(--z-content)] pl-16">
        <TopBar />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.main
            key={pathname}
            initial={{ opacity: 0, scale: 1.01, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.99, filter: "blur(6px)" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
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

import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Plus, Search } from "lucide-react";
import { Button } from "@posterract/hyperkit";
import { useUI } from "@/state/ui";
import { navItemForPath } from "./nav";

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setNavigatorOpen, setSignalsOpen } = useUI();
  const item = navItemForPath(pathname);

  return (
    <header className="sticky top-0 z-[var(--z-topbar)] flex h-16 items-center gap-3 border-b border-[var(--glass-border)] bg-[rgba(5,8,11,0.6)] px-6 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        {item && (
          <>
            <p className="kicker">{item.alien}</p>
            <p className="-mt-0.5 text-[12px] text-starlight-faint">{item.plain}</p>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setNavigatorOpen(true)}
        className="flex h-9 w-64 items-center gap-2 rounded-[10px] border border-[var(--glass-border)] bg-void-2 px-3 text-starlight-faint transition-colors hover:border-[var(--glass-border-bright)] hover:text-starlight-dim"
        aria-label="Open Navigator (Cmd+K)"
      >
        <Search size={14} />
        <span className="text-[12px]">Navigate anywhere…</span>
        <kbd className="telemetry ml-auto rounded border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px]">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setSignalsOpen(true)}
        aria-label="Open Signals (notifications)"
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--glass-border)] text-starlight-dim transition-colors hover:border-[var(--glass-border-bright)] hover:text-starlight"
      >
        <Bell size={15} />
        <span
          aria-hidden
          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-neon shadow-glow-neon-md"
        />
      </button>

      <Link to="/compose">
        <Button variant="primary" size="md" icon={<Plus size={15} />}>
          New Transmission
        </Button>
      </Link>
    </header>
  );
}

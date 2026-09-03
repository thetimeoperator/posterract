import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Command } from "lucide-react";
import { MiniTesseract } from "@posterract/hyperkit";
import { useUI } from "@/state/ui";
import { AccountMenu } from "./AccountMenu";
import { navItemForPath } from "./nav";

/** Brand and account controls stay above the workspace, separate from navigation. */
export function AppHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const systemState = useUI((state) => state.systemState);
  const setNavigatorOpen = useUI((state) => state.setNavigatorOpen);
  const setSignalsOpen = useUI((state) => state.setSignalsOpen);
  const destination = navItemForPath(pathname);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-spine)] px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
      <div className="mx-auto flex h-12 w-full max-w-[1500px] items-center justify-between gap-4">
        <Link
          to="/continuum"
          aria-label="Posterract home"
          className="pointer-events-auto group flex min-w-0 items-center gap-2.5 text-starlight"
        >
          <span className="transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
            <MiniTesseract size={27} state={systemState} />
          </span>
          <span className="whitespace-nowrap font-display text-[12px] font-bold tracking-[0.2em] sm:text-[13px]">
            POSTER<span className="text-neon">RACT</span>
          </span>
          {destination && (
            <>
              <span className="hidden h-5 w-px bg-white/10 sm:block" aria-hidden />
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate font-display text-[11px] font-semibold text-starlight-dim">
                  {destination.label}
                </span>
                <span className="block truncate text-[8.5px] tracking-wide text-starlight-faint">
                  {destination.flavor}
                </span>
              </span>
            </>
          )}
        </Link>

        <div className="pointer-events-auto flex flex-none items-center gap-1.5">
          <button
            type="button"
            onClick={() => setNavigatorOpen(true)}
            className="app-header-action hidden sm:inline-flex"
            aria-label="Open command palette"
          ><Command size={15} /></button>
          <button
            type="button"
            onClick={() => setSignalsOpen(true)}
            className="app-header-action relative hidden sm:inline-flex"
            aria-label="Open notifications"
          >
            <Bell size={15} />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-neon shadow-glow-neon-sm" />
          </button>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

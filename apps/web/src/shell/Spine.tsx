import { Link, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { Avatar, Hint, MiniTesseract } from "@posterract/hyperkit";
import { useUI } from "@/state/ui";
import { NAV_ITEMS } from "./nav";

/**
 * The Spine — Posterract's left nav rail. Collapsed to icons; expands on
 * hover. Every alien name is paired with its plain meaning.
 */
export function Spine() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const systemState = useUI((s) => s.systemState);

  return (
    <nav
      aria-label="Primary"
      className="group/spine fixed inset-y-0 left-0 z-[var(--z-spine)] flex w-16 flex-col border-r border-[var(--glass-border)] bg-[rgba(6,4,21,0.75)] backdrop-blur-xl transition-[width] duration-300 ease-[var(--ease-warp)] hover:w-60"
    >
      {/* Mark */}
      <Link
        to="/"
        className="flex h-16 flex-none items-center gap-3 overflow-hidden border-b border-[var(--glass-border)] px-[19px]"
        aria-label="Posterract — The Bridge"
      >
        <MiniTesseract size={26} state={systemState} />
        <span className="whitespace-nowrap font-display text-[15px] font-bold tracking-[0.18em] text-starlight opacity-0 transition-opacity duration-200 group-hover/spine:opacity-100">
          POSTERRACT
        </span>
      </Link>

      {/* Compose CTA */}
      <div className="px-3 pb-1 pt-3">
        <Link
          to="/compose"
          className="border-iridescent hk-charge flex h-10 items-center gap-2.5 overflow-hidden rounded-[10px] px-[9px] text-starlight transition-shadow hover:shadow-glow-violet-md"
        >
          <Plus size={18} className="flex-none" />
          <span className="whitespace-nowrap font-display text-[12px] font-semibold tracking-wide opacity-0 transition-opacity duration-200 group-hover/spine:opacity-100">
            New Transmission
          </span>
        </Link>
      </div>

      {/* Items */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-3 py-2">
        {NAV_ITEMS.filter((i) => i.section === "main").map((item) => (
          <SpineItem key={item.path} item={item} active={isActive(pathname, item.path)} />
        ))}
        <div className="mx-2 my-2 h-px flex-none bg-[var(--glass-border)]" role="separator" />
        {NAV_ITEMS.filter((i) => i.section === "system").map((item) => (
          <SpineItem key={item.path} item={item} active={isActive(pathname, item.path)} />
        ))}
      </div>

      {/* Workspace + user */}
      <div className="flex flex-none items-center gap-3 overflow-hidden border-t border-[var(--glass-border)] px-[15px] py-3">
        <Hint text="Vessel: Posterract HQ">
          <span className="border-iridescent flex h-8 w-8 flex-none items-center justify-center rounded-full font-display text-[11px] font-bold text-starlight">
            P
          </span>
        </Hint>
        <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover/spine:opacity-100">
          <p className="truncate font-display text-[12px] font-semibold text-starlight">Posterract HQ</p>
          <p className="truncate text-[11px] text-starlight-faint">Free orbit</p>
        </div>
        <Avatar name="S P" size={26} className="ml-auto flex-none opacity-0 transition-opacity duration-200 group-hover/spine:opacity-100" />
      </div>
    </nav>
  );
}

function isActive(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

function SpineItem({ item, active }: { item: (typeof NAV_ITEMS)[number]; active: boolean }) {
  const Icon = item.icon;
  const inner = (
    <>
      {/* Active edge */}
      <span
        aria-hidden
        className={clsx(
          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition-all duration-200",
          active ? "bg-hyper-cyan shadow-glow-cyan-md" : "bg-transparent",
        )}
      />
      <Icon
        size={17}
        className={clsx(
          "flex-none transition-colors",
          active ? "text-hyper-cyan" : "text-starlight-dim group-hover/item:text-starlight",
        )}
      />
      <span className="flex min-w-0 flex-col opacity-0 transition-opacity duration-200 group-hover/spine:opacity-100">
        <span
          className={clsx(
            "truncate font-display text-[12px] font-semibold tracking-wide",
            active ? "text-starlight" : "text-starlight-dim group-hover/item:text-starlight",
          )}
        >
          {item.alien}
        </span>
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-starlight-faint">
          {item.locked ? item.locked : item.plain}
        </span>
      </span>
    </>
  );

  if (item.locked) {
    return (
      <span
        aria-disabled
        title={`${item.alien} — ${item.locked}`}
        className="group/item relative flex h-11 cursor-not-allowed items-center gap-3 rounded-[10px] px-[11px] opacity-45"
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group/item relative flex h-11 items-center gap-3 rounded-[10px] px-[11px] transition-colors duration-200",
        active ? "bg-[rgba(94,242,255,0.06)]" : "hover:bg-[rgba(139,92,246,0.07)]",
      )}
    >
      {inner}
    </Link>
  );
}

import { Link, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Avatar, Hint, MiniTesseract } from "@posterract/hyperkit";
import { useUI } from "@/state/ui";
import { NAV_ITEMS } from "./nav";

/**
 * The Spine — Posterract's left nav rail. Expanded by default so the
 * POSTERRACT wordmark is always visible; collapsible to icons.
 */
export function Spine() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const systemState = useUI((s) => s.systemState);
  const collapsed = useUI((s) => s.spineCollapsed);
  const setCollapsed = useUI((s) => s.setSpineCollapsed);

  return (
    <nav
      aria-label="Primary"
      className={clsx(
        "fixed inset-y-0 left-0 z-[var(--z-spine)] flex flex-col border-r border-[var(--glass-border)] bg-[rgba(7,13,17,0.78)] backdrop-blur-xl transition-[width] duration-300 ease-[var(--ease-warp)]",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Mark + wordmark */}
      <Link
        to="/"
        className="flex h-16 flex-none items-center gap-3 overflow-hidden border-b border-[var(--glass-border)] px-[19px]"
        aria-label="Posterract — Dashboard"
      >
        <MiniTesseract size={26} state={systemState} />
        {!collapsed && (
          <span className="whitespace-nowrap font-display text-[15px] font-bold tracking-[0.18em] text-starlight">
            POSTER<span className="text-neon">RACT</span>
          </span>
        )}
      </Link>

      {/* Compose CTA */}
      <div className="px-3 pb-1 pt-3">
        <Link
          to="/compose"
          className="border-aurora hk-charge flex h-10 items-center gap-2.5 overflow-hidden rounded-[10px] px-[9px] text-starlight transition-shadow hover:shadow-glow-neon-md"
        >
          <Plus size={18} className="flex-none text-neon" />
          {!collapsed && (
            <span className="whitespace-nowrap font-display text-[12px] font-semibold tracking-wide">
              New Post
            </span>
          )}
        </Link>
      </div>

      {/* Items */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-3 py-2">
        {NAV_ITEMS.filter((i) => i.section === "main").map((item) => (
          <SpineItem key={item.path} item={item} active={isActive(pathname, item.path)} collapsed={collapsed} />
        ))}
        <div className="mx-2 my-2 h-px flex-none bg-[var(--glass-border)]" role="separator" />
        {NAV_ITEMS.filter((i) => i.section === "system").map((item) => (
          <SpineItem key={item.path} item={item} active={isActive(pathname, item.path)} collapsed={collapsed} />
        ))}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="mx-3 mb-1 flex h-9 flex-none items-center gap-2.5 rounded-[10px] px-[11px] text-starlight-faint transition-colors hover:bg-[rgba(101,255,154,0.06)] hover:text-starlight-dim"
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && <span className="text-[11px]">Collapse</span>}
      </button>

      {/* Workspace + user */}
      <div className="flex flex-none items-center gap-3 overflow-hidden border-t border-[var(--glass-border)] px-[15px] py-3">
        <Hint text="Vessel: Posterract HQ">
          <span className="border-aurora flex h-8 w-8 flex-none items-center justify-center rounded-full font-display text-[11px] font-bold text-starlight">
            P
          </span>
        </Hint>
        {!collapsed && (
          <>
            <div className="min-w-0">
              <p className="truncate font-display text-[12px] font-semibold text-starlight">Posterract HQ</p>
              <p className="truncate text-[11px] text-starlight-faint">Free orbit</p>
            </div>
            <Avatar name="S P" size={26} className="ml-auto flex-none" />
          </>
        )}
      </div>
    </nav>
  );
}

function isActive(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

function SpineItem({
  item,
  active,
  collapsed,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const inner = (
    <>
      <span
        aria-hidden
        className={clsx(
          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition-all duration-200",
          active ? "bg-neon shadow-glow-neon-md" : "bg-transparent",
        )}
      />
      <Icon
        size={17}
        className={clsx(
          "flex-none transition-colors",
          active ? "text-neon" : "text-starlight-dim group-hover/item:text-starlight",
        )}
      />
      {!collapsed && (
        <span className="flex min-w-0 flex-col">
          <span
            className={clsx(
              "truncate font-display text-[12.5px] font-semibold tracking-wide",
              active ? "text-starlight" : "text-starlight-dim group-hover/item:text-starlight",
            )}
          >
            {item.label}
          </span>
          <span className="truncate text-[9.5px] uppercase tracking-[0.12em] text-starlight-faint">
            {item.locked ? item.locked : item.flavor}
          </span>
        </span>
      )}
    </>
  );

  if (item.locked) {
    return (
      <span
        aria-disabled
        title={`${item.label} — ${item.locked}`}
        className="group/item relative flex h-11 flex-none cursor-not-allowed items-center gap-3 rounded-[10px] px-[11px] opacity-45"
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      aria-current={active ? "page" : undefined}
      title={collapsed ? `${item.label} (${item.flavor})` : undefined}
      className={clsx(
        "group/item relative flex h-11 flex-none items-center gap-3 rounded-[10px] px-[11px] transition-colors duration-200",
        active ? "bg-[rgba(101,255,154,0.06)]" : "hover:bg-[rgba(101,255,154,0.05)]",
      )}
    >
      {inner}
    </Link>
  );
}

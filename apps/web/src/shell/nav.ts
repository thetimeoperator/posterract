import {
  LayoutDashboard,
  CalendarDays,
  Radio,
  Archive,
  Orbit,
  BarChart3,
  Flame,
  TerminalSquare,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: string;
  /** Primary label — plain product language (Dashboard, Calendar, Posts…). */
  label: string;
  /** Flavor name from the Posterract lore, shown as the small subtitle. */
  flavor: string;
  icon: LucideIcon;
  /** Locked items render dimmed with a status note instead of navigating. */
  locked?: string;
  section: "main" | "system";
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", flavor: "The Bridge", icon: LayoutDashboard, section: "main" },
  { path: "/continuum", label: "Calendar", flavor: "Continuum", icon: CalendarDays, section: "main" },
  { path: "/transmissions", label: "Posts", flavor: "Transmissions", icon: Radio, section: "main" },
  { path: "/vault", label: "Library", flavor: "The Vault", icon: Archive, section: "main" },
  { path: "/automations", label: "Automations", flavor: "Protocols", icon: Zap, section: "main" },
  { path: "/portals", label: "Accounts", flavor: "Portals", icon: Orbit, section: "main" },
  { path: "/echoes", label: "Analytics", flavor: "Echoes", icon: BarChart3, section: "main" },
  { path: "/forge", label: "AI Studio", flavor: "The Forge", icon: Flame, locked: "coming online", section: "main" },
  { path: "/uplink", label: "API", flavor: "Uplink", icon: TerminalSquare, section: "system" },
  { path: "/settings", label: "Settings", flavor: "Ship Systems", icon: Settings, section: "system" },
];

export function navItemForPath(pathname: string): Pick<NavItem, "label" | "flavor"> | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  if (pathname.startsWith("/compose")) return { label: "New Post", flavor: "Transmission composer" };
  return NAV_ITEMS.filter((item) => item.path !== "/").find((item) =>
    pathname.startsWith(item.path),
  );
}

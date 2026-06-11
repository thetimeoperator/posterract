import {
  LayoutDashboard,
  CalendarDays,
  Radio,
  Archive,
  Orbit,
  Activity,
  Flame,
  TerminalSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: string;
  alien: string;
  plain: string;
  icon: LucideIcon;
  /** Locked items render dimmed with a status note instead of navigating. */
  locked?: string;
  section: "main" | "system";
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/", alien: "The Bridge", plain: "Dashboard", icon: LayoutDashboard, section: "main" },
  { path: "/continuum", alien: "Continuum", plain: "Schedule", icon: CalendarDays, section: "main" },
  { path: "/transmissions", alien: "Transmissions", plain: "Posts", icon: Radio, section: "main" },
  { path: "/vault", alien: "The Vault", plain: "Library", icon: Archive, section: "main" },
  { path: "/portals", alien: "Portals", plain: "Accounts", icon: Orbit, section: "main" },
  { path: "/echoes", alien: "Echoes", plain: "Analytics", icon: Activity, locked: "calibrating", section: "main" },
  { path: "/forge", alien: "The Forge", plain: "AI Studio", icon: Flame, locked: "coming online", section: "main" },
  { path: "/uplink", alien: "Uplink", plain: "API", icon: TerminalSquare, section: "system" },
  { path: "/settings", alien: "Ship Systems", plain: "Settings", icon: Settings, section: "system" },
];

export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.filter((item) => item.path !== "/").find((item) =>
    pathname.startsWith(item.path),
  );
}

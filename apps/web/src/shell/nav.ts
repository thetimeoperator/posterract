import {
  Archive,
  BarChart3,
  Bot,
  CalendarDays,
  Clapperboard,
  Orbit,
  Radio,
  Settings,
  Plus,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: "/create" | "/forge" | "/skills" | "/continuum" | "/transmissions" | "/echoes" | "/vault" | "/portals" | "/uplink" | "/settings";
  label: string;
  flavor: string;
  icon: LucideIcon;
  section: "mvp" | "future" | "main" | "system";
  locked?: string;
};

/** The primary destinations included in the product dock, in visible order. */
export const MVP_NAV_ITEMS: NavItem[] = [
  { path: "/create", label: "Create", flavor: "Agent video editor", icon: Clapperboard, section: "mvp" },
  { path: "/continuum", label: "Calendar", flavor: "Publishing schedule", icon: CalendarDays, section: "mvp" },
  { path: "/uplink", label: "API Keys", flavor: "Agent access", icon: Bot, section: "mvp" },
  { path: "/echoes", label: "Analytics", flavor: "Performance", icon: BarChart3, section: "mvp" },
  { path: "/portals", label: "Social accounts", flavor: "Connections", icon: Orbit, section: "mvp" },
  { path: "/vault", label: "Assets", flavor: "Media library", icon: Archive, section: "mvp" },
  { path: "/settings", label: "Settings", flavor: "Workspace", icon: Settings, section: "mvp" },
];

/** Retained product routes for later phases; deliberately absent from MVP navigation. */
export const FUTURE_NAV_ITEMS: NavItem[] = [
  { path: "/forge", label: "Agent Lab", flavor: "Private agent workspace", icon: Plus, section: "future" },
  { path: "/skills", label: "Skills", flavor: "Private workflows", icon: Bot, section: "future" },
  { path: "/transmissions", label: "History", flavor: "Publishing history", icon: Radio, section: "future" },
];

export const NAV_ITEMS = MVP_NAV_ITEMS;
const ALL_NAV_ITEMS = [...MVP_NAV_ITEMS, ...FUTURE_NAV_ITEMS];

export function isNavActive(pathname: string, path: NavItem["path"]) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function navItemForPath(pathname: string): Pick<NavItem, "label" | "flavor"> | undefined {
  if (pathname === "/") return { label: "Calendar", flavor: "Publishing schedule" };
  if (pathname.startsWith("/compose")) return { label: "New post", flavor: "Schedule or publish" };
  return ALL_NAV_ITEMS.find((item) => isNavActive(pathname, item.path));
}

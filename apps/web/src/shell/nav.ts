import {
  Archive,
  BarChart3,
  Bot,
  CalendarDays,
  Clapperboard,
  IdCard,
  Orbit,
  Radio,
  Settings,
  Plus,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: "/create" | "/forge" | "/skills" | "/continuum" | "/transmissions" | "/echoes" | "/points" | "/profile" | "/vault" | "/portals" | "/uplink" | "/settings";
  label: string;
  flavor: string;
  icon: LucideIcon;
  section: "mvp" | "future" | "main" | "system";
  locked?: string;
};

/**
 * The dock: the product's loop, in order. Make the videos, post them, see
 * what worked, level up.
 */
export const DOCK_NAV_ITEMS: NavItem[] = [
  { path: "/create", label: "Create", flavor: "Agent video editor", icon: Clapperboard, section: "mvp" },
  { path: "/continuum", label: "Calendar", flavor: "Publishing schedule", icon: CalendarDays, section: "mvp" },
  { path: "/echoes", label: "Analytics", flavor: "Performance", icon: BarChart3, section: "mvp" },
  { path: "/points", label: "Points", flavor: "Levels & leaderboard", icon: Trophy, section: "mvp" },
];

/** Setup, not daily work: in the account menu (and ⌘K). */
export const SETUP_NAV_ITEMS: NavItem[] = [
  { path: "/profile", label: "Profile", flavor: "Your rank cards", icon: IdCard, section: "mvp" },
  { path: "/portals", label: "Social accounts", flavor: "Connections & businesses", icon: Orbit, section: "mvp" },
  { path: "/vault", label: "Assets", flavor: "Media library", icon: Archive, section: "mvp" },
  { path: "/uplink", label: "API Keys", flavor: "Agent access", icon: Bot, section: "mvp" },
  { path: "/settings", label: "Settings", flavor: "Workspace", icon: Settings, section: "mvp" },
];

export const MVP_NAV_ITEMS: NavItem[] = [...DOCK_NAV_ITEMS, ...SETUP_NAV_ITEMS];

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

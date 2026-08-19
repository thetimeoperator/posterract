import {
  Archive,
  BarChart3,
  Bot,
  CalendarDays,
  KeyRound,
  Orbit,
  Radio,
  Settings,
  Sparkles,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: "/forge" | "/skills" | "/continuum" | "/transmissions" | "/echoes" | "/points" | "/vault" | "/portals" | "/uplink" | "/settings";
  label: string;
  flavor: string;
  icon: LucideIcon;
  section: "primary" | "secondary" | "main" | "system";
  locked?: string;
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { path: "/forge", label: "Forge", flavor: "Agent workspace", icon: Sparkles, section: "primary" },
  { path: "/skills", label: "Skills", flavor: "Private workflows", icon: Bot, section: "primary" },
  { path: "/continuum", label: "Schedule", flavor: "Continuum", icon: CalendarDays, section: "primary" },
  { path: "/transmissions", label: "History", flavor: "Transmissions", icon: Radio, section: "primary" },
  { path: "/echoes", label: "Analytics", flavor: "Echoes", icon: BarChart3, section: "primary" },
  { path: "/points", label: "Points", flavor: "Resonance", icon: Zap, section: "primary" },
];

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { path: "/vault", label: "Assets", flavor: "The Vault", icon: Archive, section: "secondary" },
  { path: "/portals", label: "Social accounts", flavor: "Portals", icon: Orbit, section: "secondary" },
  { path: "/uplink", label: "Agent API", flavor: "Uplink", icon: TerminalSquare, section: "secondary" },
  { path: "/settings", label: "Settings", flavor: "Ship systems", icon: Settings, section: "secondary" },
];

export const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

export function isNavActive(pathname: string, path: NavItem["path"]) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function navItemForPath(pathname: string): Pick<NavItem, "label" | "flavor"> | undefined {
  if (pathname === "/") return { label: "Forge", flavor: "Agent workspace" };
  if (pathname.startsWith("/compose")) return { label: "Prepare post", flavor: "Transmission composer" };
  return NAV_ITEMS.find((item) => isNavActive(pathname, item.path));
}

export const AGENT_KEY_ICON = KeyRound;

import type { CSSProperties } from "react";
import { POINTS_START_AT, rankForLevel } from "@posterract/contract";
import { TIER_MATERIALS } from "@/components/points/RankEmblem";

export const formatPoints = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const formatWhole = (value: number) => Math.round(value).toLocaleString("en-US");

export const formatCompact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(value) >= 1000 ? 2 : 0 }).format(value);

/** Launch day, when everyone started at zero: "September 24, 2026". */
export const launchDay = () =>
  new Date(POINTS_START_AT).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A level's tier colours as custom properties, the way the Points tab tints its cards. */
export function tierVars(level: number): CSSProperties {
  const material = TIER_MATERIALS[rankForLevel(level).tier];
  const value = Number.parseInt(material.ink[1].slice(1), 16);
  return {
    "--tier-rgb": `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`,
    "--tier-ink-1": material.ink[0],
    "--tier-ink-2": material.ink[1],
  } as CSSProperties;
}

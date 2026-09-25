import { useId, type CSSProperties } from "react";
import clsx from "clsx";
import { rankForLevel, type RankTierId } from "@posterract/contract";

/**
 * A rank's emblem, drawn like a Call of Duty rank icon: the tier is the metal
 * and the frame (a shield, then a crown gem, wings, bigger wings, a star), the
 * title is the insignia inside it (chevrons for the first four titles, bars for
 * Lieutenant and Captain, stars from Major to General).
 */

type Material = {
  /** Metal gradient, top to bottom. */
  metal: string[];
  edge: string;
  field: string;
  /** Tint glowing from the middle of the field. */
  tint: string;
  /** Insignia gradient, top to bottom. */
  ink: [string, string];
  glow: string;
};

export const TIER_MATERIALS: Record<RankTierId, Material> = {
  bronze: {
    metal: ["#ffd3a8", "#d4874b", "#8a4a1f", "#4a230c"],
    edge: "#ffbf8a",
    field: "#150b05",
    tint: "#d4874b",
    ink: ["#ffe2c4", "#d4874b"],
    glow: "rgba(222,135,70,.55)",
  },
  silver: {
    metal: ["#ffffff", "#d3dae2", "#8b96a3", "#3f4953"],
    edge: "#f4f8fc",
    field: "#0c1014",
    tint: "#b8c2cc",
    ink: ["#ffffff", "#aeb9c5"],
    glow: "rgba(214,226,238,.45)",
  },
  gold: {
    metal: ["#fff6c4", "#f4c64e", "#b07a12", "#553604"],
    edge: "#ffe58a",
    field: "#150e02",
    tint: "#f4c64e",
    ink: ["#fff6cf", "#f0bc3c"],
    glow: "rgba(255,204,70,.6)",
  },
  platinum: {
    metal: ["#ffffff", "#c9f2ec", "#6fb3aa", "#22423f"],
    edge: "#e8fffb",
    field: "#081311",
    tint: "#9fe0d6",
    ink: ["#ffffff", "#a8ece2"],
    glow: "rgba(170,245,232,.5)",
  },
  diamond: {
    metal: ["#ffffff", "#b8fbff", "#39c8e6", "#0b4b63"],
    edge: "#d6fdff",
    field: "#03111a",
    tint: "#7cf7ff",
    ink: ["#ffffff", "#8af8ff"],
    glow: "rgba(124,247,255,.65)",
  },
  master: {
    metal: ["#5f6e69", "#27302d", "#0b0e0d", "#000000"],
    edge: "#65ff9a",
    field: "#000000",
    tint: "#1d3a2a",
    ink: ["#b6ffd0", "#65ff9a"],
    glow: "rgba(101,255,154,.5)",
  },
  grandmaster: {
    metal: ["#ffc2c9", "#ff4d63", "#b3122c", "#4a0010"],
    edge: "#ff9aa6",
    field: "#140208",
    tint: "#ff2d4b",
    ink: ["#ffe0e4", "#ff5d71"],
    glow: "rgba(255,45,75,.6)",
  },
  titan: {
    metal: ["#d5dce2", "#78848e", "#2f373e", "#0b0e10"],
    edge: "#ffcf7a",
    field: "#0b0703",
    tint: "#ffb347",
    ink: ["#fff4dc", "#ffcf7a"],
    glow: "rgba(255,190,90,.55)",
  },
  mythic: {
    metal: ["#4b5a56", "#161d1b", "#050707", "#000000"],
    edge: "#7cf7ff",
    field: "#000000",
    tint: "#0c2a33",
    ink: ["#e6feff", "#7cf7ff"],
    glow: "rgba(124,247,255,.55)",
  },
  legendary: {
    metal: ["#ffffff", "#d9ffe8", "#65ff9a", "#16a052", "#053d1f"],
    edge: "#ffffff",
    field: "#010d06",
    tint: "#65ff9a",
    ink: ["#ffffff", "#b8ffd4"],
    glow: "rgba(101,255,154,.85)",
  },
};

const SHIELD = "M60 16 L92 28 V62 C92 83 78 97 60 106 C42 97 28 83 28 62 V28 Z";
const FIELD = "M60 24 L85 33.5 V62 C85 79 74 90.5 60 98 C46 90.5 35 79 35 62 V33.5 Z";
const SHINE = "M60 18.5 L90 29.5 V39 C76 33 62 31.5 30 39.5 V29.5 Z";
const FEATHERS = [
  "M31 36 L2 26 L8.5 36 L30 45 Z",
  "M30 46 L5 41.5 L11.5 50 L29 55 Z",
  "M29 56 L10 56.5 L16.5 63.5 L29 64.5 Z",
];
const GEM = "M60 2.5 L67.5 11.5 L60 20.5 L52.5 11.5 Z";
const SPECKS: Array<[number, number, number]> = [
  [45, 42, 0.9], [72, 40, 0.7], [52, 82, 0.8], [75, 74, 1], [41, 63, 0.6],
  [79, 55, 0.7], [60, 91, 0.6], [65, 34, 0.5], [47, 72, 0.5], [70, 87, 0.6],
];

function starPath(cx: number, cy: number, r: number) {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? r : r * 0.42;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(" L")} Z`;
}

const chevron = (y: number) => `M42 ${y + 11} L60 ${y} L78 ${y + 11} L78 ${y + 17} L60 ${y + 6} L42 ${y + 17} Z`;
const bar = (y: number) => `M44 ${y + 1.5} Q44 ${y} 45.5 ${y} H74.5 Q76 ${y} 76 ${y + 1.5} V${y + 6} Q76 ${y + 7.5} 74.5 ${y + 7.5} H45.5 Q44 ${y + 7.5} 44 ${y + 6} Z`;

/** The insignia for each of the ten titles, as filled paths. */
function insignia(titleIndex: number): string[] {
  switch (titleIndex) {
    case 0:
      return [chevron(53)];
    case 1:
      return [chevron(47), chevron(57)];
    case 2:
      return [chevron(42), chevron(52), chevron(62)];
    case 3:
      return [chevron(37), chevron(47), chevron(57), "M43 75 Q60 85 77 75 L77 81 Q60 91 43 81 Z"];
    case 4:
      return [bar(58)];
    case 5:
      return [bar(51), bar(64)];
    case 6:
      return [starPath(60, 61, 12.5)];
    case 7:
      return [starPath(49.5, 62, 8.8), starPath(70.5, 62, 8.8)];
    case 8:
      return [starPath(60, 50, 8.2), starPath(48.5, 68, 8.2), starPath(71.5, 68, 8.2)];
    default:
      // Four stars in a row over a shoulder board.
      return [
        starPath(43.5, 56, 6.4),
        starPath(54.5, 56, 6.4),
        starPath(65.5, 56, 6.4),
        starPath(76.5, 56, 6.4),
        bar(67),
        "M47 79 L60 86 L73 79 L73 83.5 L60 90.5 L47 83.5 Z",
      ];
  }
}

export function RankEmblem({
  level,
  size = 64,
  glow = true,
  gleam = false,
  locked = false,
  className,
  style,
}: {
  level: number;
  size?: number;
  glow?: boolean;
  /** A light sweep across the metal, for the big emblem. */
  gleam?: boolean;
  /** Drawn dark, for tiers not reached yet. */
  locked?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const rank = rankForLevel(level);
  const material = TIER_MATERIALS[rank.tier];
  const id = `emblem${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tier = rank.tierIndex;
  const wings = tier >= 6 ? FEATHERS : tier >= 4 ? FEATHERS.slice(1) : [];
  const gem = (tier >= 2 && tier <= 3) || (tier >= 6 && tier <= 7);
  const crown = tier >= 8;
  const shapes = insignia(rank.titleIndex);
  const metalStops = material.metal.map((color, index) => (
    <stop key={index} offset={index / (material.metal.length - 1)} stopColor={color} />
  ));

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`${rank.label}, level ${rank.minLevel}`}
      className={clsx("rank-emblem", `rank-emblem--${rank.tier}`, locked && "rank-emblem--locked", className)}
      style={{
        ...(glow && !locked ? { filter: `drop-shadow(0 0 ${Math.max(3, size / 9)}px ${material.glow})` } : undefined),
        ...style,
      }}
    >
      <defs>
        <linearGradient id={`${id}-metal`} x1="0.2" y1="0" x2="0.55" y2="1">
          {metalStops}
        </linearGradient>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={material.ink[0]} />
          <stop offset="1" stopColor={material.ink[1]} />
        </linearGradient>
        <radialGradient id={`${id}-tint`} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor={material.tint} stopOpacity={0.42} />
          <stop offset="1" stopColor={material.tint} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${id}-gleam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0.55} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={SHIELD} />
        </clipPath>
      </defs>

      {tier === 9 && (
        <g className="rank-emblem__rays" style={{ transformOrigin: "60px 60px" }}>
          {Array.from({ length: 12 }, (_, index) => (
            <path
              key={index}
              d="M60 60 L57.2 2 L62.8 2 Z"
              fill={material.ink[1]}
              opacity={0.22}
              transform={`rotate(${index * 30} 60 60)`}
            />
          ))}
        </g>
      )}

      {wings.length > 0 && (
        <g fill={`url(#${id}-metal)`} stroke={material.edge} strokeWidth={0.9} strokeLinejoin="round">
          {wings.map((d) => <path key={`l${d}`} d={d} />)}
          <g transform="translate(120 0) scale(-1 1)">
            {wings.map((d) => <path key={`r${d}`} d={d} />)}
          </g>
        </g>
      )}

      <path d={SHIELD} fill={`url(#${id}-metal)`} stroke={material.edge} strokeWidth={1.3} strokeLinejoin="round" />
      <path d={FIELD} fill={material.field} stroke="rgba(0,0,0,.65)" strokeWidth={1.2} />
      <path d={FIELD} fill={`url(#${id}-tint)`} />
      {rank.tier === "mythic" &&
        SPECKS.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={material.edge} opacity={0.85} />)}

      <g transform="translate(0 1.4)" fill="rgba(0,0,0,.6)">
        {shapes.map((d) => <path key={`s${d}`} d={d} />)}
      </g>
      <g fill={`url(#${id}-ink)`} stroke="rgba(0,0,0,.45)" strokeWidth={0.8} strokeLinejoin="round">
        {shapes.map((d) => <path key={d} d={d} />)}
      </g>

      <path d={SHINE} fill="#fff" opacity={0.16} />
      {gleam && !locked && (
        <g clipPath={`url(#${id}-clip)`}>
          <g transform="skewX(-18)">
            <rect className="rank-emblem__gleam" x={-40} y={0} width={36} height={120} fill={`url(#${id}-gleam)`} />
          </g>
        </g>
      )}

      {gem && (
        <path d={GEM} fill={`url(#${id}-metal)`} stroke={material.edge} strokeWidth={1} strokeLinejoin="round" />
      )}
      {crown && (
        <path d={starPath(60, 9.5, 9.5)} fill={`url(#${id}-ink)`} stroke={material.edge} strokeWidth={0.9} strokeLinejoin="round" />
      )}
    </svg>
  );
}

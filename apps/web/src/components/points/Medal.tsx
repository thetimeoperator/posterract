import { useId } from "react";
import clsx from "clsx";
import { Lock, type LucideIcon } from "lucide-react";

function notchedRing(cx: number, cy: number, outer: number, inner: number, teeth: number) {
  const points: string[] = [];
  for (let index = 0; index < teeth * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (index * Math.PI) / teeth;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(" L")} Z`;
}

const RING = notchedRing(50, 50, 48, 45, 36);

/** A commendation medal: a notched gold ring around a dark disc with its icon; steel and locked until earned. */
export function Medal({
  icon: Icon,
  mark,
  unlocked,
  size = 76,
}: {
  icon: LucideIcon;
  /** A number stamped under the icon, e.g. a streak's days. */
  mark?: string;
  unlocked: boolean;
  size?: number;
}) {
  const id = `medal${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const metal = unlocked ? ["#fff6c4", "#f4c64e", "#a8700f", "#4d3104"] : ["#56615e", "#2a3230", "#141918", "#0a0d0c"];
  return (
    <span className={clsx("medal", unlocked ? "medal--on" : "medal--off")} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id={`${id}-metal`} x1="0.2" y1="0" x2="0.6" y2="1">
            {metal.map((color, index) => (
              <stop key={color} offset={index / (metal.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
          <radialGradient id={`${id}-disc`} cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stopColor={unlocked ? "#2a2208" : "#141a19"} />
            <stop offset="1" stopColor={unlocked ? "#0a0802" : "#060808"} />
          </radialGradient>
        </defs>
        <path d={RING} fill={`url(#${id}-metal)`} stroke={unlocked ? "#ffe58a" : "#3b4543"} strokeWidth={0.8} />
        <circle cx={50} cy={50} r={38.5} fill="rgba(0,0,0,.55)" />
        <circle cx={50} cy={50} r={36} fill={`url(#${id}-disc)`} stroke={`url(#${id}-metal)`} strokeWidth={2.2} />
        <path d="M22 38 Q50 18 78 38 Q50 26 22 38 Z" fill="#fff" opacity={unlocked ? 0.14 : 0.05} />
      </svg>
      <span className="medal__face">
        <Icon size={Math.round(size * 0.3)} strokeWidth={2} aria-hidden />
        {mark && <span className="medal__mark">{mark}</span>}
      </span>
      {!unlocked && (
        <span className="medal__lock" aria-hidden>
          <Lock size={11} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}

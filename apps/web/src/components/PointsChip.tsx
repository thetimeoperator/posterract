import clsx from "clsx";
import { Trophy } from "lucide-react";
import type { ProjectionDTO } from "@posterract/contract";

/** What a post has earned on the Points tab, e.g. "+22.4 pts". */
export function PointsChip({ points, size = "md", className }: { points: number; size?: "sm" | "md"; className?: string }) {
  const value = points.toLocaleString(undefined, { maximumFractionDigits: points >= 100 ? 0 : 1 });
  return (
    <span
      title={`${points.toLocaleString(undefined, { maximumFractionDigits: 2 })} points earned`}
      className={clsx(
        "inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full bg-[rgba(101,255,154,.08)] font-display font-medium text-neon shadow-[inset_0_0_0_1px_rgba(101,255,154,.22)]",
        size === "sm" ? "h-4 px-1.5 text-[9px]" : "h-5 px-2 text-[10.5px]",
        className,
      )}
    >
      <Trophy size={size === "sm" ? 8 : 10} aria-hidden />+{value} pts
    </span>
  );
}

/** Each post's points across its platforms, for posts that have earned any. */
export function pointsByTransmission(projections: readonly ProjectionDTO[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const projection of projections) {
    if (projection.points === undefined) continue;
    totals.set(projection.transmissionId, (totals.get(projection.transmissionId) ?? 0) + projection.points);
  }
  return totals;
}

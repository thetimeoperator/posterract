import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HoverFeature = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
};

export function FeaturesSectionWithHoverEffects({
  features,
  className,
}: {
  features: HoverFeature[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "relative z-10 mx-auto grid max-w-7xl grid-cols-1 py-10 md:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {features.map((feature, index) => (
        <li
          key={feature.id}
          className={cn(
            "group/feature relative flex min-w-0 flex-col border-neutral-800 py-10 lg:border-r",
            (index === 0 || index === 4) && "lg:border-l",
            index < 4 && "lg:border-b",
          )}
        >
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 h-full w-full from-neutral-800 to-transparent opacity-0 transition duration-200 group-hover/feature:opacity-100 motion-reduce:transition-none",
              index < 4 ? "bg-gradient-to-t" : "bg-gradient-to-b",
            )}
          />
          <div aria-hidden="true" className="relative z-10 mb-4 px-10 text-neutral-400 [&>svg]:size-6">
            {feature.icon}
          </div>
          <h3 className="relative z-10 mb-2 px-10 text-lg font-bold">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 h-6 w-1 origin-center rounded-tr-full rounded-br-full bg-neutral-700 transition-all duration-200 group-hover/feature:h-8 group-hover/feature:bg-blue-500 motion-reduce:transition-none"
            />
            <span className="inline-block text-neutral-100 transition duration-200 group-hover/feature:translate-x-2 motion-reduce:transform-none motion-reduce:transition-none">
              {feature.title}
            </span>
          </h3>
          <p className="relative z-10 max-w-xs px-10 text-sm text-neutral-300">
            {feature.description}
          </p>
        </li>
      ))}
    </ol>
  );
}

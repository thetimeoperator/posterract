import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
  type SpringOptions,
} from "framer-motion";
import {
  createContext,
  useContext,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import clsx from "clsx";

type DockContextValue = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  magnification: number;
  reducedMotion: boolean;
};

const DockContext = createContext<DockContextValue | null>(null);

function useDock() {
  const value = useContext(DockContext);
  if (!value) throw new Error("DockItem must be rendered inside Dock");
  return value;
}

export type DockProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

export function Dock({
  children,
  className,
  distance = 132,
  panelHeight = 58,
  magnification = 70,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  ...rest
}: DockProps) {
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div className="flex max-w-full justify-center" {...rest}>
      <motion.div
        role="toolbar"
        aria-label="Posterract navigation"
        onMouseMove={(event) => mouseX.set(event.pageX)}
        onMouseLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        className={clsx(
          "flex h-[var(--dock-height)] max-w-full items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
        style={{ "--dock-height": `${panelHeight}px` } as CSSProperties}
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification, reducedMotion }}>
          {children}
        </DockContext.Provider>
      </motion.div>
    </div>
  );
}

export type DockItemProps = {
  children: ReactNode;
  className?: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
};

export function DockItem({ children, className, label, active, disabled }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { distance, magnification, mouseX, spring, reducedMotion } = useDock();
  const mouseDistance = useTransform(mouseX, (value) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return Number.POSITIVE_INFINITY;
    return value - rect.x - rect.width / 2;
  });
  const widthTarget = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [40, reducedMotion ? 40 : magnification, 40],
  );
  const focusWidth = useMotionValue(40);
  const combinedWidth = useTransform(
    [widthTarget, focusWidth],
    ([hoverValue, focusValue]: number[]) => Math.max(hoverValue, focusValue),
  );
  const width = useSpring(combinedWidth, spring);

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      onFocusCapture={() => focusWidth.set(reducedMotion ? 40 : magnification)}
      onBlurCapture={() => focusWidth.set(40)}
      className={clsx(
        "group/dock relative flex h-10 flex-none items-center justify-center",
        disabled && "opacity-45",
        className,
      )}
      data-active={active ? "true" : "false"}
    >
      {children}
      <span
        role="tooltip"
        className={clsx(
          "pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--glass-border)] bg-[rgba(5,10,12,0.94)] px-2.5 py-1 font-display text-[10px] font-semibold tracking-wide text-starlight opacity-0 shadow-glow-neon-sm backdrop-blur-xl transition-all duration-150 group-hover/dock:translate-y-0 group-hover/dock:opacity-100 group-focus-within/dock:opacity-100",
          active && "text-neon opacity-100",
        )}
      >
        {label}
      </span>
    </motion.div>
  );
}

export function DockIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("flex h-1/2 w-1/2 items-center justify-center", className)}>
      {children}
    </span>
  );
}

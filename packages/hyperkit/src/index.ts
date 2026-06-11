/**
 * @posterract/hyperkit — Posterract's design system.
 * Import tokens.css + hyperkit.css once in the app entry.
 */

export { Button } from "./components/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/Button";

export { Panel } from "./components/Panel";
export type { PanelProps } from "./components/Panel";

export { FieldShell, Input, Textarea } from "./components/Field";
export type { InputProps, TextareaProps } from "./components/Field";

export { Toggle } from "./components/Toggle";
export { Segmented } from "./components/Segmented";
export type { SegmentedOption } from "./components/Segmented";

export { Tabs } from "./components/Tabs";
export type { TabSpec } from "./components/Tabs";

export { Modal } from "./components/Modal";
export { SignalHost, useSignals, pushSignal } from "./components/Toast";
export type { Signal, SignalTone } from "./components/Toast";

export { StatusBadge } from "./components/StatusBadge";
export type { BadgeStatus } from "./components/StatusBadge";

export { PlatformChip, PlatformRuneRow } from "./components/PlatformChip";
export {
  PlatformRune,
  InstagramRune,
  TikTokRune,
  FacebookRune,
  ThreadsRune,
  XRune,
  YouTubeRune,
} from "./components/PlatformRune";

export { ProgressBeam, ProgressComet, OrbitRing } from "./components/Progress";

export {
  Skeleton,
  Avatar,
  EmptyState,
  ConstellationGlyph,
  Countdown,
  Telemetry,
  Hint,
} from "./components/Bits";

export { Starfield } from "./fx/Starfield";
export { GridHorizon } from "./fx/GridHorizon";
export { MiniTesseract } from "./fx/MiniTesseract";
export type { MiniTesseractState } from "./fx/MiniTesseract";

export const HYPERKIT_VERSION = "0.1.0";

import type { VidtryxMode } from "./types";

const newsStages = [
  { id: "script", label: "Writing angle", durationMs: 2400 },
  { id: "visual-plan", label: "Designing scenes", durationMs: 2600 },
  { id: "avatar", label: "Rendering character", durationMs: 3200 },
  { id: "hyperframes", label: "Building visuals", durationMs: 3200 },
  { id: "assembly", label: "Assembling video", durationMs: 2600 },
  { id: "export", label: "Export ready", durationMs: 1200 },
] as const;

export const modes: VidtryxMode[] = [
  {
    id: "news-character",
    name: "News Character Mode",
    shortName: "NEWS",
    color: "#65ff9a",
    description: "Turn a prompt into a vertical character video.",
    enabled: true,
    runMode: "fake",
    fakeStages: [...newsStages],
  },
  {
    id: "ugc-ad",
    name: "UGC Ad Mode",
    shortName: "UGC",
    color: "#ffcc66",
    description: "Creator-style product ad generation.",
    enabled: false,
    runMode: "fake",
    fakeStages: [...newsStages],
  },
  {
    id: "product-demo",
    name: "Product Demo Mode",
    shortName: "DEMO",
    color: "#66d7ff",
    description: "Feature-led demo video generation.",
    enabled: false,
    runMode: "fake",
    fakeStages: [...newsStages],
  },
  {
    id: "faceless-reel",
    name: "Faceless Reel Mode",
    shortName: "REEL",
    color: "#b875ff",
    description: "Narrated short-form reel generation.",
    enabled: false,
    runMode: "fake",
    fakeStages: [...newsStages],
  },
  {
    id: "clip-repurposer",
    name: "Clip Repurposer Mode",
    shortName: "CLIP",
    color: "#ff718f",
    description: "Turn long footage into short cuts.",
    enabled: false,
    runMode: "fake",
    fakeStages: [...newsStages],
  },
];

export const enabledMode = modes.find((mode) => mode.enabled) ?? modes[0];

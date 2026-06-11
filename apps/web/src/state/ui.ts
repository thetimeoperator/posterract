import { create } from "zustand";
import type { MiniTesseractState } from "@posterract/hyperkit";

const SPINE_KEY = "posterract.spine.collapsed";

type UIState = {
  navigatorOpen: boolean;
  signalsOpen: boolean;
  systemState: MiniTesseractState;
  spineCollapsed: boolean;
  setNavigatorOpen: (open: boolean) => void;
  setSignalsOpen: (open: boolean) => void;
  setSystemState: (state: MiniTesseractState) => void;
  setSpineCollapsed: (collapsed: boolean) => void;
};

export const useUI = create<UIState>((set) => ({
  navigatorOpen: false,
  signalsOpen: false,
  systemState: "idle",
  spineCollapsed:
    typeof window !== "undefined" && window.localStorage.getItem(SPINE_KEY) === "1",
  setNavigatorOpen: (navigatorOpen) => set({ navigatorOpen }),
  setSignalsOpen: (signalsOpen) => set({ signalsOpen }),
  setSystemState: (systemState) => set({ systemState }),
  setSpineCollapsed: (spineCollapsed) => {
    window.localStorage.setItem(SPINE_KEY, spineCollapsed ? "1" : "0");
    set({ spineCollapsed });
  },
}));

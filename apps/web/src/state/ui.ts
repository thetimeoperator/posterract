import { create } from "zustand";
import type { MiniTesseractState } from "@posterract/hyperkit";

type UIState = {
  navigatorOpen: boolean;
  signalsOpen: boolean;
  systemState: MiniTesseractState;
  setNavigatorOpen: (open: boolean) => void;
  setSignalsOpen: (open: boolean) => void;
  setSystemState: (state: MiniTesseractState) => void;
};

export const useUI = create<UIState>((set) => ({
  navigatorOpen: false,
  signalsOpen: false,
  systemState: "idle",
  setNavigatorOpen: (navigatorOpen) => set({ navigatorOpen }),
  setSignalsOpen: (signalsOpen) => set({ signalsOpen }),
  setSystemState: (systemState) => set({ systemState }),
}));

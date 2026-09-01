import { create } from "zustand";
import { desktopRequest, isPosterractDesktop } from "./desktop";

export type DesktopAuthState = {
  status: "loading" | "signed_out" | "authorizing" | "signed_in" | "error";
  session?: {
    user: { id: string; email: string; name?: string };
    workspaceId: string;
    role: string;
    device: { id: string; name: string; platform: string; appVersion?: string };
  };
  error?: string;
  secureStorageAvailable: boolean;
};

const initial: DesktopAuthState = {
  status: isPosterractDesktop() ? "loading" : "signed_out",
  secureStorageAvailable: false,
};

export const useDesktopAuth = create<DesktopAuthState>(() => initial);

let initialized = false;
export function initializeDesktopAuth(): void {
  if (initialized || !isPosterractDesktop() || !window.desktop) return;
  initialized = true;
  window.desktop.on("main:event", (payload) => {
    const event = payload as { channel?: string; data?: DesktopAuthState };
    if (event.channel === "auth:state-changed" && event.data) {
      useDesktopAuth.setState(event.data, true);
    }
  });
  void desktopRequest<DesktopAuthState>("auth:get-state")
    .then((state) => useDesktopAuth.setState(state, true))
    .catch((error) =>
      useDesktopAuth.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        secureStorageAvailable: false,
      }),
    );
}

export async function desktopSignIn(): Promise<DesktopAuthState> {
  const state = await desktopRequest<DesktopAuthState>("auth:sign-in");
  useDesktopAuth.setState(state, true);
  return state;
}

export async function desktopSignOut(): Promise<void> {
  const state = await desktopRequest<DesktopAuthState>("auth:sign-out");
  useDesktopAuth.setState(state, true);
}

initializeDesktopAuth();

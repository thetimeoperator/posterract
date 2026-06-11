import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Profile = {
  displayName: string;
  handle: string;
  workspaceName: string;
  timezone: string;
  defaultPlatforms: string[];
  shipAudio: boolean;
};

type ProfileState = Profile & {
  update: (patch: Partial<Profile>) => void;
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      displayName: "Operator",
      handle: "@posterract",
      workspaceName: "Posterract HQ",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      defaultPlatforms: ["instagram", "tiktok", "youtube"],
      shipAudio: false,
      update: (patch) => set(patch),
    }),
    { name: "posterract.profile" },
  ),
);

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "OP"
  );
}

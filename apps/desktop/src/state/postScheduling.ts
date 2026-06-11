import { nowIso } from "../lib/timing";
import type { ContentCapsule, PlatformAccount, PlatformId, ScheduleMode } from "./types";

export type ReadyCapsule = ContentCapsule & {
  status: "ready";
  outputUrl: string;
};

type PostScheduleState = {
  capsules: ContentCapsule[];
  selectedCapsuleId?: string;
  platformAccounts: PlatformAccount[];
  selectedPlatformIds: PlatformId[];
  scheduleMode: ScheduleMode;
  scheduledFor: string;
};

export type PostScheduleValidation =
  | {
      ok: true;
      capsule: ReadyCapsule;
      connectedTargets: PlatformAccount[];
      createdAt: string;
      scheduledFor: string;
    }
  | {
      ok: false;
      reason: string;
    };

const capsuleById = (capsules: ContentCapsule[], capsuleId?: string) =>
  capsules.find((capsule) => capsule.id === capsuleId) ?? capsules[0];

const isReadyCapsule = (capsule: ContentCapsule | undefined): capsule is ReadyCapsule =>
  capsule?.status === "ready" && Boolean(capsule.outputUrl);

const hasValidFutureSchedule = (iso: string) => {
  const scheduledAt = Date.parse(iso);
  return Number.isFinite(scheduledAt) && scheduledAt > Date.now();
};

export function validatePostSchedule(state: PostScheduleState): PostScheduleValidation {
  const capsule = capsuleById(state.capsules, state.selectedCapsuleId);
  if (!isReadyCapsule(capsule)) {
    return { ok: false, reason: "Select a ready capsule with output media before scheduling." };
  }

  if (state.selectedPlatformIds.length === 0) {
    return { ok: false, reason: "Select at least one connected platform." };
  }

  const connectedTargets = state.selectedPlatformIds
    .map((platformId) => state.platformAccounts.find((account) => account.id === platformId))
    .filter((account): account is PlatformAccount => Boolean(account?.connected));

  if (connectedTargets.length !== state.selectedPlatformIds.length) {
    return { ok: false, reason: "Every selected platform must be connected." };
  }

  const createdAt = nowIso();
  const scheduledFor = state.scheduleMode === "now" ? createdAt : state.scheduledFor;
  if (state.scheduleMode === "later" && !hasValidFutureSchedule(scheduledFor)) {
    return { ok: false, reason: "Choose a valid future publish time." };
  }

  return {
    ok: true,
    capsule,
    connectedTargets,
    createdAt,
    scheduledFor,
  };
}

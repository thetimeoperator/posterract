import { create } from "zustand";
import { addMinutesIso, artifactId, distributionRunId, nowIso, packageId, publishJobId } from "../lib/timing";
import { enabledMode, modes } from "./modes";
import { validatePostSchedule } from "./postScheduling";
import {
  capsules as seedCapsules,
  platformAccounts as seedPlatformAccounts,
  publishJobs as seedPublishJobs,
} from "./productData";
import { createFakeRunCapsule } from "./runCapsule";
import { runMode } from "./runMode";
import { getSocialBackend, type SocialBackendStatus } from "./socialBackend";
import type {
  AttachedFile,
  ContentCapsule,
  DistributionRun,
  ModeId,
  PlatformId,
  PlatformAccount,
  PostPackage,
  ProductSurface,
  PublishJob,
  RunEventEnvelope,
  RunArtifact,
  RunEvent,
  RunLogEntry,
  RunModeHandle,
  ScheduleMode,
  VidtryxMode,
  VidtryxPhase,
} from "./types";

type RunEventMessage = RunEvent | RunEventEnvelope;

type VidtryxState = {
  modes: VidtryxMode[];
  productSurface: ProductSurface;
  selectedModeId: ModeId;
  phase: VidtryxPhase;
  prompt: string;
  files: AttachedFile[];
  runId?: string;
  runError?: string;
  currentStageId?: string;
  currentStageLabel: string;
  currentStageIndex: number;
  stageProgress: number;
  overallProgress: number;
  runLog: RunLogEntry[];
  artifacts: RunArtifact[];
  outputUrl?: string;
  runHandle?: RunModeHandle;
  capsules: ContentCapsule[];
  selectedCapsuleId?: string;
  platformAccounts: PlatformAccount[];
  selectedPlatformIds: PlatformId[];
  scheduleMode: ScheduleMode;
  scheduledFor: string;
  scheduleError?: string;
  postCaption: string;
  postPackages: PostPackage[];
  publishJobs: PublishJob[];
  distributionRuns: DistributionRun[];
  socialBackendStatus: SocialBackendStatus;
  setProductSurface: (surface: ProductSurface) => void;
  openCreate: () => void;
  openPost: (capsuleId?: string) => void;
  selectCapsule: (capsuleId: string) => void;
  updatePostCaption: (caption: string) => void;
  togglePlatform: (platformId: PlatformId) => void;
  setScheduleMode: (mode: ScheduleMode) => void;
  setScheduledFor: (iso: string) => void;
  schedulePublish: () => void;
  syncSocialBackend: () => Promise<void>;
  selectMode: (modeId: ModeId) => void;
  setPrompt: (prompt: string) => void;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  startRun: () => void;
  resetRun: () => void;
  consumeEvent: (event: RunEventMessage) => void;
};

const modeById = (modeId: ModeId) => modes.find((mode) => mode.id === modeId) ?? enabledMode;

const queuedLog = (mode: VidtryxMode): RunLogEntry[] =>
  mode.fakeStages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    progress: 0,
    status: "queued",
  }));

const canRun = (state: VidtryxState) => state.prompt.trim().length > 0 || state.files.length > 0;

const capsuleById = (capsules: ContentCapsule[], capsuleId?: string) =>
  capsules.find((capsule) => capsule.id === capsuleId) ?? capsules[0];

const unwrapRunEvent = (message: RunEventMessage) => ("payload" in message ? message.payload : message);

const connectedPlatformIds = seedPlatformAccounts
  .filter((account) => account.connected)
  .slice(0, 3)
  .map((account) => account.id);

const socialBackend = getSocialBackend();

const mergeCapsules = (current: ContentCapsule[], incoming: ContentCapsule[] = []) => {
  if (incoming.length === 0) return current;
  const currentIds = new Set(current.map((capsule) => capsule.id));
  const mergedCurrent = current.map((capsule) => {
    const synced = incoming.find((candidate) => candidate.id === capsule.id);
    return synced ? { ...capsule, backendId: synced.backendId } : capsule;
  });
  return [...incoming.filter((capsule) => !currentIds.has(capsule.id)), ...mergedCurrent];
};

const connectedIdsFromAccounts = (accounts: PlatformAccount[]) =>
  accounts.filter((account) => account.connected).map((account) => account.id);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown social backend error.");

export const useVidtryxStore = create<VidtryxState>((set, get) => ({
  modes,
  productSurface: "home",
  selectedModeId: enabledMode.id,
  phase: "idle",
  prompt: "",
  files: [],
  currentStageLabel: "Standby",
  currentStageIndex: -1,
  stageProgress: 0,
  overallProgress: 0,
  runLog: queuedLog(enabledMode),
  artifacts: [],
  capsules: seedCapsules,
  selectedCapsuleId: seedCapsules[0]?.id,
  platformAccounts: seedPlatformAccounts,
  selectedPlatformIds: connectedPlatformIds,
  scheduleMode: "later",
  scheduledFor: addMinutesIso(180),
  scheduleError: undefined,
  postCaption: seedCapsules[0]?.caption ?? "",
  postPackages: [],
  publishJobs: seedPublishJobs,
  distributionRuns: [],
  socialBackendStatus: socialBackend.configured ? "syncing" : "mock",

  setProductSurface: (surface) => set({ productSurface: surface }),

  openCreate: () =>
    set((state) => ({
      productSurface: "create",
      phase: state.phase === "idle" ? "selecting" : state.phase,
      currentStageLabel: state.phase === "idle" ? "Select mode" : state.currentStageLabel,
    })),

  openPost: (capsuleId) =>
    set((state) => {
      const selectedCapsule = capsuleById(state.capsules, capsuleId ?? state.selectedCapsuleId);
      return {
        productSurface: "post",
        selectedCapsuleId: selectedCapsule?.id,
        postCaption: selectedCapsule?.caption ?? state.postCaption,
        scheduleError: undefined,
      };
    }),

  selectCapsule: (capsuleId) =>
    set((state) => {
      const selectedCapsule = capsuleById(state.capsules, capsuleId);
      return {
        selectedCapsuleId: selectedCapsule?.id,
        postCaption: selectedCapsule?.caption ?? state.postCaption,
        productSurface: state.productSurface === "home" ? "post" : state.productSurface,
        scheduleError: undefined,
      };
    }),

  updatePostCaption: (caption) => set({ postCaption: caption, scheduleError: undefined }),

  togglePlatform: (platformId) =>
    set((state) => {
      const account = state.platformAccounts.find((platform) => platform.id === platformId);
      if (!account?.connected) return state;
      const selected = state.selectedPlatformIds.includes(platformId);
      return {
        selectedPlatformIds: selected
          ? state.selectedPlatformIds.filter((id) => id !== platformId)
          : [...state.selectedPlatformIds, platformId],
        scheduleError: undefined,
      };
    }),

  setScheduleMode: (mode) => set({ scheduleMode: mode, scheduleError: undefined }),

  setScheduledFor: (iso) => set({ scheduledFor: iso, scheduleError: undefined }),

  schedulePublish: () => {
    const state = get();
    const validation = validatePostSchedule(state);
    if (!validation.ok) {
      set({ scheduleError: validation.reason });
      return;
    }

    const { capsule, connectedTargets, createdAt, scheduledFor } = validation;
    const nextPackages = connectedTargets.map<PostPackage>((account) => ({
      id: packageId(),
      capsuleId: capsule.id,
      platformId: account.id,
      title: capsule.title,
      caption: state.postCaption,
      hashtags: capsule.hashtags,
      mediaUrl: capsule.outputUrl,
    }));
    const nextJobs = nextPackages.map<PublishJob>((postPackage) => {
      const account = connectedTargets.find((target) => target.id === postPackage.platformId);
      return {
        id: publishJobId(),
        capsuleId: capsule.id,
        platformId: postPackage.platformId,
        packageId: postPackage.id,
        status: state.scheduleMode === "now" ? "posting" : "scheduled",
        scheduledFor,
        createdAt,
        label: `${capsule.title} -> ${account?.platform ?? postPackage.platformId}`,
      };
    });
    const distributionRun: DistributionRun = {
      id: distributionRunId(),
      capsuleId: capsule.id,
      jobIds: nextJobs.map((job) => job.id),
      createdAt,
      status: state.scheduleMode === "now" ? "posting" : "scheduled",
    };

    set((current) => ({
      productSurface: "post",
      scheduleError: undefined,
      postPackages: [...current.postPackages, ...nextPackages],
      publishJobs: [...nextJobs, ...current.publishJobs],
      distributionRuns: [distributionRun, ...current.distributionRuns],
      capsules: current.capsules.map((item) =>
        item.id === capsule.id
          ? { ...item, caption: current.postCaption, status: current.scheduleMode === "now" ? "posting" : "scheduled" }
          : item,
      ),
    }));

    if (socialBackend.configured) {
      void socialBackend
        .createDistributionRun({
          capsule,
          caption: state.postCaption,
          targets: connectedTargets,
          scheduleMode: state.scheduleMode,
          scheduledFor,
        })
        .then((result) => {
          const optimisticJobIds = new Set(nextJobs.map((job) => job.id));
          const optimisticPackageIds = new Set(nextPackages.map((postPackage) => postPackage.id));
          set((current) => ({
            scheduleError: undefined,
            socialBackendStatus: "ready",
            postPackages: [
              ...result.postPackages,
              ...current.postPackages.filter((postPackage) => !optimisticPackageIds.has(postPackage.id)),
            ],
            publishJobs: [
              ...result.publishJobs,
              ...current.publishJobs.filter((job) => !optimisticJobIds.has(job.id)),
            ],
            distributionRuns: [
              result.distributionRun,
              ...current.distributionRuns.filter((run) => run.id !== distributionRun.id),
            ],
            capsules: current.capsules.map((item) =>
              item.id === result.capsule.id
                ? { ...item, backendId: result.capsule.backendId, status: state.scheduleMode === "now" ? "posting" : "scheduled" }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          set((current) => ({
            scheduleError: errorMessage(error),
            socialBackendStatus: "failed",
            publishJobs: current.publishJobs.map((job) =>
              nextJobs.some((nextJob) => nextJob.id === job.id)
                ? { ...job, status: "failed", error: errorMessage(error) }
                : job,
            ),
          }));
        });
      return;
    }

    if (state.scheduleMode === "now") {
      window.setTimeout(() => {
        set((current) => ({
          publishJobs: current.publishJobs.map((job) =>
            nextJobs.some((nextJob) => nextJob.id === job.id)
              ? {
                  ...job,
                  status: "posted",
                  platformPostUrl: `https://example.com/${job.platformId}/${job.id}`,
                }
              : job,
          ),
          distributionRuns: current.distributionRuns.map((run) =>
            run.id === distributionRun.id ? { ...run, status: "posted" } : run,
          ),
          capsules: current.capsules.map((item) => (item.id === capsule.id ? { ...item, status: "posted" } : item)),
        }));
      }, 1200);
    }
  },

  syncSocialBackend: async () => {
    if (!socialBackend.configured) {
      set({ socialBackendStatus: "mock" });
      return;
    }

    set({ socialBackendStatus: "syncing" });
    try {
      const snapshot = await socialBackend.loadSnapshot();
      set((state) => {
        const nextAccounts = snapshot.platformAccounts?.length ? snapshot.platformAccounts : state.platformAccounts;
        return {
          socialBackendStatus: "ready",
          platformAccounts: nextAccounts,
          selectedPlatformIds: connectedIdsFromAccounts(nextAccounts),
          publishJobs: snapshot.publishJobs?.length ? snapshot.publishJobs : state.publishJobs,
          capsules: mergeCapsules(state.capsules, snapshot.capsules),
        };
      });
    } catch (error: unknown) {
      set({
        socialBackendStatus: "failed",
        scheduleError: errorMessage(error),
      });
    }
  },

  selectMode: (modeId) => {
    const nextMode = modeById(modeId);
    if (!nextMode.enabled || get().phase === "running") return;
    set({
      productSurface: "create",
      selectedModeId: nextMode.id,
      phase: "armed",
      currentStageLabel: "Mode armed",
      runLog: queuedLog(nextMode),
      artifacts: [],
      outputUrl: undefined,
      runError: undefined,
      overallProgress: 0,
      stageProgress: 0,
    });
  },

  setPrompt: (prompt) => {
    const phase = get().phase;
    set({
      prompt,
      phase: phase === "idle" || phase === "armed" || phase === "selecting" ? "input" : phase,
    });
  },

  addFiles: (incomingFiles) => {
    const mapped = incomingFiles.map((file) => ({
      id: `${file.name}_${file.size}_${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type || "unknown",
    }));
    set((state) => ({
      files: [...state.files, ...mapped],
      phase: state.phase === "running" ? state.phase : "input",
    }));
  },

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== id),
    })),

  startRun: () => {
    const state = get();
    if (state.phase === "running" || !canRun(state)) return;
    state.runHandle?.cancel();
    const selectedMode = modeById(state.selectedModeId);
    const handle = runMode({ mode: selectedMode, emit: get().consumeEvent });
    set({
      productSurface: "create",
      runHandle: handle,
      runId: handle.id,
      phase: "running",
      runError: undefined,
      currentStageLabel: "Initializing",
      currentStageIndex: -1,
      currentStageId: undefined,
      stageProgress: 0,
      overallProgress: 0,
      outputUrl: undefined,
      scheduleError: undefined,
      artifacts: [],
      runLog: queuedLog(selectedMode),
    });
  },

  resetRun: () => {
    get().runHandle?.cancel();
    const mode = modeById(get().selectedModeId);
    set({
      phase: "armed",
      runId: undefined,
      runError: undefined,
      currentStageId: undefined,
      currentStageLabel: "Mode armed",
      currentStageIndex: -1,
      stageProgress: 0,
      overallProgress: 0,
      artifacts: [],
      outputUrl: undefined,
      runHandle: undefined,
      scheduleError: undefined,
      runLog: queuedLog(mode),
    });
  },

  consumeEvent: (message) => {
    const event = unwrapRunEvent(message);
    if (event.runId !== get().runId) return;

    const selectedMode = modeById(get().selectedModeId);
    if (event.type === "run.started") {
      set({
        runId: event.runId,
        phase: "running",
        currentStageLabel: "Initializing",
        overallProgress: 0,
      });
      return;
    }

    if (event.type === "stage.started") {
      set((state) => ({
        currentStageId: event.stageId,
        currentStageLabel: event.label,
        currentStageIndex: event.index,
        stageProgress: 0,
        runLog: state.runLog.map((entry) =>
          entry.id === event.stageId ? { ...entry, status: "active", progress: 0 } : entry,
        ),
      }));
      return;
    }

    if (event.type === "stage.progress") {
      const stageCount = selectedMode.fakeStages.length;
      const stageIndex = Math.max(0, get().currentStageIndex);
      const overallProgress = (stageIndex + event.progress) / stageCount;
      set((state) => ({
        stageProgress: event.progress,
        overallProgress,
        runLog: state.runLog.map((entry) =>
          entry.id === event.stageId ? { ...entry, progress: event.progress } : entry,
        ),
      }));
      return;
    }

    if (event.type === "stage.completed") {
      const stageCount = selectedMode.fakeStages.length;
      const stageIndex = selectedMode.fakeStages.findIndex((stage) => stage.id === event.stageId);
      set((state) => ({
        stageProgress: 1,
        overallProgress: Math.max(state.overallProgress, (stageIndex + 1) / stageCount),
        runLog: state.runLog.map((entry) =>
          entry.id === event.stageId ? { ...entry, status: "complete", progress: 1 } : entry,
        ),
      }));
      return;
    }

    if (event.type === "artifact.created") {
      set((state) => ({
        artifacts: [
          ...state.artifacts,
          {
            id: artifactId(),
            type: event.artifactType,
            label: event.label,
            url: event.url,
            createdAt: nowIso(),
          },
        ],
      }));
      return;
    }

    if (event.type === "run.completed") {
      const current = get();
      const currentMode = modeById(current.selectedModeId);
      const nextCapsule = createFakeRunCapsule({
        mode: currentMode,
        prompt: current.prompt,
        outputUrl: event.outputUrl,
      });
      set({
        phase: "complete",
        currentStageLabel: "Export ready",
        currentStageIndex: selectedMode.fakeStages.length - 1,
        stageProgress: 1,
        overallProgress: 1,
        outputUrl: event.outputUrl,
        runHandle: undefined,
        capsules: [nextCapsule, ...current.capsules],
        selectedCapsuleId: nextCapsule.id,
        postCaption: nextCapsule.caption,
      });
      if (socialBackend.configured) {
        void socialBackend
          .saveCapsule(nextCapsule)
          .then((syncedCapsule) => {
            set((state) => ({
              capsules: state.capsules.map((capsule) =>
                capsule.id === syncedCapsule.id ? { ...capsule, backendId: syncedCapsule.backendId } : capsule,
              ),
              socialBackendStatus: "ready",
            }));
          })
          .catch((error: unknown) => {
            set({
              socialBackendStatus: "failed",
              scheduleError: errorMessage(error),
            });
          });
      }
      return;
    }

    if (event.type === "run.failed") {
      set({
        phase: "failed",
        runError: event.message,
        currentStageLabel: "Run failed",
        runHandle: undefined,
      });
    }
  },
}));

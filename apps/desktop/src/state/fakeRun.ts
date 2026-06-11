import { sampleOutputUrl } from "../lib/sampleOutput";
import type { RunEvent, RunModeHandle, VidtryxMode } from "./types";

type Emit = (event: RunEvent) => void;

export type FakeRunHandle = RunModeHandle & {
  id: string;
  runMode: "fake";
};

type FakeRunRequest = {
  id: string;
  mode: VidtryxMode;
  emit: Emit;
};

export function startFakeRun({ id, mode, emit }: FakeRunRequest): FakeRunHandle {
  const timeouts: number[] = [];
  const intervals: number[] = [];
  const testSpeed = new URLSearchParams(window.location.search).get("testSpeed") === "fast";
  const speed = testSpeed ? 0.08 : 1;

  const schedule = (callback: () => void, delayMs: number) => {
    const timeout = window.setTimeout(callback, delayMs);
    timeouts.push(timeout);
  };

  emit({ type: "run.started", runId: id, modeId: mode.id });

  let cursor = 250 * speed;

  mode.fakeStages.forEach((stage, index) => {
    const durationMs = stage.durationMs * speed;

    schedule(() => {
      emit({
        type: "stage.started",
        runId: id,
        stageId: stage.id,
        label: stage.label,
        index,
      });

      const startedAt = performance.now();
      const interval = window.setInterval(() => {
        const progress = Math.min((performance.now() - startedAt) / durationMs, 1);
        emit({ type: "stage.progress", runId: id, stageId: stage.id, progress });
        if (progress >= 1) {
          window.clearInterval(interval);
        }
      }, 80);
      intervals.push(interval);
    }, cursor);

    cursor += durationMs;

    schedule(() => {
      emit({ type: "stage.completed", runId: id, stageId: stage.id });

      if (stage.id === "script") {
        emit({
          type: "artifact.created",
          runId: id,
          artifactType: "script",
          label: "Runtime script",
        });
      }

      if (stage.id === "hyperframes") {
        emit({
          type: "artifact.created",
          runId: id,
          artifactType: "preview",
          label: "Motion preview",
        });
      }
    }, cursor + 40);

    cursor += 180 * speed;
  });

  schedule(() => {
    emit({
      type: "artifact.created",
      runId: id,
      artifactType: "video",
      label: "Final master",
      url: sampleOutputUrl,
    });
    emit({ type: "run.completed", runId: id, outputUrl: sampleOutputUrl });
  }, cursor + 500);

  return {
    id,
    runMode: "fake",
    cancel: () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      intervals.forEach((interval) => window.clearInterval(interval));
    },
  };
}

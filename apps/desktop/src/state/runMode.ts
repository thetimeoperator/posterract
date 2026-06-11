import { runId, nowIso } from "../lib/timing";
import { startFakeRun } from "./fakeRun";
import type { RunEvent, RunEventEnvelope, RunModeHandle, VidtryxMode } from "./types";

type RunModeRequest = {
  mode: VidtryxMode;
  emit: (envelope: RunEventEnvelope) => void;
};

const enqueueEvent = (callback: () => void) => {
  window.queueMicrotask(callback);
};

export function runMode({ mode, emit }: RunModeRequest): RunModeHandle {
  const id = runId();
  let sequence = 0;

  const emitEnvelope = (payload: RunEvent) => {
    const envelope: RunEventEnvelope = {
      runId: payload.runId,
      runMode: mode.runMode,
      sequence,
      emittedAt: nowIso(),
      payload,
    };
    sequence += 1;
    enqueueEvent(() => emit(envelope));
  };

  switch (mode.runMode) {
    case "fake":
      return startFakeRun({ id, mode, emit: emitEnvelope });
  }
}

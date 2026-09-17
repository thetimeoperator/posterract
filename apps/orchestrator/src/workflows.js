import {
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  executeChild,
  patched,
  proxyActivities,
  sleep,
  setHandler,
} from "@temporalio/workflow";

const activities = proxyActivities({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "30 seconds",
    maximumInterval: "10 minutes",
    backoffCoefficient: 2,
  },
});

export const publishNow = defineSignal("publishNow");
export const cancelPublication = defineSignal("cancelPublication");
export const reschedulePublication = defineSignal("reschedulePublication");
export const refreshAnalytics = defineSignal("refreshAnalytics");

export async function systemSmokeWorkflow(input = {}) {
  return {
    ok: true,
    architecture: "postiz-compatible",
    received: input,
  };
}

export async function analyticsRefreshWorkflow() {
  let refreshRequested = false;
  setHandler(refreshAnalytics, () => {
    refreshRequested = true;
  });
  for (let cycle = 0; cycle < 28; cycle += 1) {
    refreshRequested = false;
    try {
      const accountIds = await activities.listAnalyticsAccounts();
      await Promise.all(
        accountIds.map((accountId) =>
          activities.refreshAccountAnalytics(accountId).catch((error) => ({
            status: "failed",
            error: error instanceof Error ? error.message : "Analytics refresh failed",
          })),
        ),
      );
    } catch {
      // The next durable cycle retries global failures without killing the loop.
    }
    await condition(() => refreshRequested, "6 hours");
  }
  return continueAsNew();
}

export async function publicationWorkflow(input) {
  let releaseEarly = false;
  let canceled = false;

  setHandler(publishNow, () => {
    releaseEarly = true;
  });
  setHandler(cancelPublication, () => {
    canceled = true;
  });

  const transmission = await activities.loadTransmission(input.transmissionId);
  if (!transmission) {
    throw ApplicationFailure.nonRetryable(
      "Transmission does not exist",
      "transmission_not_found",
    );
  }

  let scheduledFor = new Date(transmission.scheduled_for).getTime();
  setHandler(reschedulePublication, (nextScheduledFor) => {
    if (Number.isFinite(nextScheduledFor)) scheduledFor = nextScheduledFor;
  });
  while (!releaseEarly && !canceled && Date.now() < scheduledFor) {
    const observedSchedule = scheduledFor;
    await condition(
      () => releaseEarly || canceled || scheduledFor !== observedSchedule,
      Math.min(scheduledFor - Date.now(), 60_000),
    );
  }

  if (canceled) {
    await activities.markTransmissionCanceled(input.transmissionId);
    return { status: "canceled" };
  }

  await activities.markTransmissionTransmitting(input.transmissionId);
  const projections = await activities.loadPendingProjections(
    input.transmissionId,
    input.projectionIds,
  );
  const results = await Promise.all(
    projections.map(async (projection) => {
      try {
        return {
          projectionId: projection.id,
          result: patched("tiktok-direct-post-v1") && projection.provider === "tiktok" && projection.platform_options?.mode === "direct"
            ? await executeChild(tiktokDirectPostWorkflow, { workflowId: `tiktok-direct:${projection.id}`, args: [{ projectionId: projection.id }] })
            : await activities.publishProjection(projection.id),
        };
      } catch (error) {
        return {
          projectionId: projection.id,
          error: error instanceof Error ? error.message : "Publishing failed",
        };
      }
    }),
  );

  await activities.finalizeTransmission(input.transmissionId);
  await activities.enqueueAnalyticsIndex(input.transmissionId);
  await activities.enqueueMediaCleanup(input.transmissionId);
  return { status: "completed", results };
}

const directActivities = proxyActivities({
  startToCloseTimeout: "90 seconds",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds", maximumInterval: "30 seconds" },
});
const mediaActivities = proxyActivities({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3, initialInterval: "15 seconds" },
});

export async function tiktokDirectPostWorkflow({ projectionId, resume = false }) {
  try {
    if (!resume) {
      const prepared = await mediaActivities.prepareTikTokDirect(projectionId);
      if (["failed", "live", "canceled"].includes(prepared.status)) return prepared;
      let initialized;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        initialized = await directActivities.initializeTikTokDirect(projectionId);
        if (initialized.status !== "retry") break;
        await sleep(initialized.delay || 60_000);
      }
      if (initialized.status === "retry") return await directActivities.failTikTokDirect(projectionId, "rate_limit_retry_exhausted", "rate_limit");
      if (initialized.status !== "processing") return initialized;
    }
    // No init call during status polling. Continue-as-new keeps history bounded
    // even when TikTok moderation or an outage lasts for hours.
    for (let poll = 0; poll < 240; poll += 1) {
      const result = await directActivities.pollTikTokDirect(projectionId);
      if (result.status !== "processing") return result;
      await sleep(result.delay || (poll < 12 ? 5_000 : 30_000));
    }
  } catch {
    return await directActivities.failTikTokDirect(projectionId, "publishing_interrupted_check_status_before_retry");
  }
  return continueAsNew({ projectionId, resume: true });
}

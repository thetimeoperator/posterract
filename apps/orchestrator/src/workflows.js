import {
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
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

  const scheduledFor = new Date(transmission.scheduled_for).getTime();
  while (!releaseEarly && !canceled && Date.now() < scheduledFor) {
    await sleep(Math.min(scheduledFor - Date.now(), 60_000));
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
          result: await activities.publishProjection(projection.id),
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

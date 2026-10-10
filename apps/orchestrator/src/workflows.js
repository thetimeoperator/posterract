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
  workflowInfo,
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

// Stats and post lists are read on their own task queue, by worker slots of
// their own, so reading thousands of accounts never holds up a post going
// out. A batch's activity heartbeats as it goes; one cut off by a restart
// carries on from the account it reached.
function backgroundActivities() {
  return proxyActivities({
    taskQueue: `${workflowInfo().taskQueue}-background`,
    startToCloseTimeout: "2 hours",
    heartbeatTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "1 minute",
      maximumInterval: "10 minutes",
      backoffCoefficient: 2,
    },
  });
}

const ACCOUNTS_PAGE = 500;
const ACCOUNTS_PER_BATCH = 25;

// One pass over every connected account, a page of IDs at a time, each page
// in batches of accounts: a pass adds a few events per 25 accounts to the
// run's history, and the run starts afresh after each pass.
async function eachAccountBatch(kind, run) {
  const background = backgroundActivities();
  let after;
  for (;;) {
    const page = await background.listAccountsPage({ kind, after, limit: ACCOUNTS_PAGE });
    if (page.length === 0) return;
    const batches = [];
    for (let index = 0; index < page.length; index += ACCOUNTS_PER_BATCH) {
      batches.push(page.slice(index, index + ACCOUNTS_PER_BATCH));
    }
    await Promise.all(batches.map((batch) => run(background, batch).catch(() => undefined)));
    if (page.length < ACCOUNTS_PAGE) return;
    after = page.at(-1);
  }
}

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
  if (patched("background-batches")) {
    try {
      await eachAccountBatch("analytics", (background, batch) => background.refreshAnalyticsBatch(batch));
    } catch {
      // The next pass retries without killing the loop.
    }
    // Stats, and the points scored from them, refresh twice a day. A new
    // post refreshes its own accounts on its own (accountAnalyticsNowWorkflow).
    await condition(() => refreshRequested, "12 hours");
    return continueAsNew();
  }
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
    // Stats, and the points scored from them, refresh twice a day. The patch
    // keeps the loop already running on the old 6-hour timer replaying cleanly.
    await condition(() => refreshRequested, patched("analytics-twice-daily") ? "12 hours" : "6 hours");
    // A run begun before the batches moves onto them at its next wake.
    if (patched("background-batches")) return continueAsNew();
  }
  return continueAsNew();
}

// Every post on every connected account, whichever app or tool made it, read
// each hour so the Analytics posting graph counts all of them.
export async function accountPostsWorkflow() {
  if (patched("background-batches")) {
    try {
      await eachAccountBatch("posts", (background, batch) => background.syncPostsBatch(batch));
    } catch {
      // The next pass retries without killing the loop.
    }
    await sleep("1 hour");
    return continueAsNew();
  }
  for (let cycle = 0; cycle < 24; cycle += 1) {
    try {
      const accountIds = await activities.listPostSyncAccounts();
      await Promise.all(
        accountIds.map((accountId) =>
          activities.syncAccountPosts(accountId).catch(() => undefined),
        ),
      );
    } catch {
      // The next cycle retries global failures without killing the loop.
    }
    await sleep("1 hour");
    if (patched("background-batches")) return continueAsNew();
  }
  return continueAsNew();
}

// A newly connected account: read its existing posts now, not at the next
// hourly pass.
export async function accountPostsNowWorkflow(accountId) {
  if (patched("background-batches")) return backgroundActivities().syncPostsBatch([accountId]);
  return activities.syncAccountPosts(accountId);
}

// A post just went live: refresh the stats of the account it went to (not
// every account), once at a time per account.
export async function accountAnalyticsNowWorkflow(accountId) {
  return backgroundActivities().refreshAnalyticsBatch([accountId]);
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
    const woken = () => releaseEarly || canceled || scheduledFor !== observedSchedule;
    // One timer for the whole wait; a publish-now, cancel or reschedule
    // signal still ends it early. Runs from before this change woke every
    // minute, which grew each history by thousands of events while a post
    // waited, and a restarted worker had to replay them all at once. The
    // patch keeps those runs replaying, and one whose history already grew
    // long starts over as a fresh run (reschedules and cancels are in the
    // database, so the new run picks them up).
    if (patched("publication-single-wait")) {
      if (workflowInfo().historyLength > 500) return await continueAsNew(input);
      await condition(woken, scheduledFor - Date.now());
    } else {
      await condition(woken, Math.min(scheduledFor - Date.now(), 60_000));
    }
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

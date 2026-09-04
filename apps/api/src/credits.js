/**
 * Workspace AI credit accounts. Balances live in workspace_credits, every
 * change is mirrored into the immutable credit_ledger, and callers pass the
 * client (pool or transaction) so grants and reserves join the surrounding
 * transaction. Ledger semantics: 'grant' and 'refund' add credits, 'reserve'
 * and 'expire' remove them, and 'settle' finalizes a reservation without
 * moving the balance again (the reserve row already carried the debit).
 */

function dateMillis(value) {
  return value ? new Date(value).getTime() : null;
}

export function publicCredits(row) {
  return {
    plan: row?.plan ?? null,
    balance: Number(row?.balance ?? 0),
    allotment: Number(row?.allotment ?? 0),
    cycleResetsAt: dateMillis(row?.cycle_resets_at),
  };
}

export async function loadWorkspaceCredits(client, workspaceId) {
  const result = await client.query(
    `select plan, balance, allotment, cycle_started_at, cycle_resets_at
     from workspace_credits
     where workspace_id = $1`,
    [workspaceId],
  );
  return publicCredits(result.rows[0]);
}

export async function loadCreditLedger(client, workspaceId, limit) {
  const result = await client.query(
    `select id, delta, kind, note, generation_id, created_at
     from credit_ledger
     where workspace_id = $1
     order by created_at desc, id desc
     limit $2`,
    [workspaceId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    delta: Number(row.delta),
    kind: row.kind,
    note: row.note ?? undefined,
    generationId: row.generation_id ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function recordLedgerEntry(
  client,
  { workspaceId, delta, kind, generationId, note },
) {
  await client.query(
    `insert into credit_ledger (workspace_id, delta, kind, generation_id, note)
     values ($1, $2, $3, $4, $5)`,
    [workspaceId, delta, kind, generationId ?? null, note ?? null],
  );
}

/**
 * Reset the workspace to a fresh plan cycle: the balance becomes the plan
 * allotment (no rollover at launch), any unused remainder is expired in the
 * ledger, and the grant names the cycle it pays for.
 */
export async function grantPlanCycle(
  client,
  { workspaceId, plan, allotment, cycleStartedAt, cycleResetsAt, note },
) {
  const existing = await client.query(
    `select balance from workspace_credits where workspace_id = $1 for update`,
    [workspaceId],
  );
  const previousBalance = Number(existing.rows[0]?.balance ?? 0);
  await client.query(
    `insert into workspace_credits
       (workspace_id, plan, balance, allotment, cycle_started_at, cycle_resets_at)
     values ($1, $2, $3, $3, $4, $5)
     on conflict (workspace_id) do update set
       plan = excluded.plan,
       balance = excluded.balance,
       allotment = excluded.allotment,
       cycle_started_at = excluded.cycle_started_at,
       cycle_resets_at = excluded.cycle_resets_at,
       updated_at = now()`,
    [workspaceId, plan, allotment, cycleStartedAt ?? null, cycleResetsAt ?? null],
  );
  if (previousBalance > 0) {
    await recordLedgerEntry(client, {
      workspaceId,
      delta: -previousBalance,
      kind: "expire",
      note: `Unused credits expired at the ${plan} cycle reset`,
    });
  }
  await recordLedgerEntry(client, {
    workspaceId,
    delta: allotment,
    kind: "grant",
    note,
  });
}

/** Keep the stored plan in sync with an active credit-plan subscription. */
export async function setWorkspacePlan(client, workspaceId, plan) {
  await client.query(
    `insert into workspace_credits (workspace_id, plan)
     values ($1, $2)
     on conflict (workspace_id) do update set
       plan = excluded.plan, updated_at = now()`,
    [workspaceId, plan],
  );
}

/** Downgrade/cancel: the plan ends but the balance survives until cycle end. */
export async function clearWorkspacePlan(client, workspaceId) {
  await client.query(
    `update workspace_credits
     set plan = null, updated_at = now()
     where workspace_id = $1 and plan is not null`,
    [workspaceId],
  );
}

/**
 * Atomically debit a reservation. Returns the remaining balance, or undefined
 * when the workspace cannot cover the quote (nothing is written in that case).
 */
export async function reserveCredits(
  client,
  { workspaceId, credits, generationId, note },
) {
  const reserved = await client.query(
    `update workspace_credits
     set balance = balance - $2, updated_at = now()
     where workspace_id = $1 and balance >= $2
     returning balance`,
    [workspaceId, credits],
  );
  if (!reserved.rows[0]) return undefined;
  await recordLedgerEntry(client, {
    workspaceId,
    delta: -credits,
    kind: "reserve",
    generationId,
    note,
  });
  return Number(reserved.rows[0].balance);
}

/** Finalize a reservation; the reserve entry already carried the debit. */
export async function settleCredits(
  client,
  { workspaceId, credits, generationId, note },
) {
  await recordLedgerEntry(client, {
    workspaceId,
    delta: 0,
    kind: "settle",
    generationId,
    note: note ?? `Settled ${credits} credits`,
  });
}

/** Return reserved credits to the balance after a failed generation. */
export async function refundCredits(
  client,
  { workspaceId, credits, generationId, note },
) {
  await client.query(
    `update workspace_credits
     set balance = balance + $2, updated_at = now()
     where workspace_id = $1`,
    [workspaceId, credits],
  );
  await recordLedgerEntry(client, {
    workspaceId,
    delta: credits,
    kind: "refund",
    generationId,
    note,
  });
}

/**
 * Advance the credit cycle if its reset date has passed.
 *
 * Credits refill monthly from the payment date, whatever cadence Stripe
 * invoices on. Without this a yearly subscriber would be granted once and get
 * a single month's allowance for a year's money, because the grant used to
 * follow the invoice period.
 *
 * The roll is lazy — it happens the next time the account is read rather than
 * on a schedule — so it needs no cron and cannot drift. A workspace nobody
 * touches for five months rolls straight to the current period on the next
 * read and is granted once, not five times: the allowance is a ceiling per
 * month, not something that accumulates.
 *
 * Only an active plan rolls. A cancelled one keeps whatever balance it had
 * until its final period ends, which is what the customer paid for.
 */
export async function rollCycleIfDue(client, workspaceId, allotmentFor) {
  const current = await client.query(
    `select plan, allotment, cycle_started_at, cycle_resets_at
       from workspace_credits where workspace_id = $1 for update`,
    [workspaceId],
  );
  const row = current.rows[0];
  if (!row?.plan || !row.cycle_resets_at) return false;

  const now = Date.now();
  let resetsAt = new Date(row.cycle_resets_at);
  if (now < resetsAt.getTime()) return false;

  // Walk forward a month at a time to the period we are actually in, so a
  // long absence lands on the right anchor date rather than one month past
  // whenever it was last read.
  let startedAt = new Date(row.cycle_started_at ?? resetsAt);
  let guard = 0;
  while (resetsAt.getTime() <= now && guard < 240) {
    startedAt = new Date(resetsAt);
    resetsAt = addOneMonth(resetsAt);
    guard += 1;
  }

  const allotment = allotmentFor?.(row.plan) ?? Number(row.allotment ?? 0);
  const previousBalance = Number(
    (await client.query("select balance from workspace_credits where workspace_id = $1", [workspaceId]))
      .rows[0]?.balance ?? 0,
  );

  await client.query(
    `update workspace_credits
        set balance = $2,
            allotment = $2,
            cycle_started_at = $3,
            cycle_resets_at = $4,
            transcribe_seconds_used = 0,
            updated_at = now()
      where workspace_id = $1`,
    [workspaceId, allotment, startedAt.toISOString(), resetsAt.toISOString()],
  );

  if (previousBalance > 0) {
    await recordLedgerEntry(client, {
      workspaceId,
      delta: -previousBalance,
      kind: "expire",
      note: `Unused credits expired at the ${row.plan} monthly refill`,
    });
  }
  await recordLedgerEntry(client, {
    workspaceId,
    delta: allotment,
    kind: "grant",
    note: `Granted ${allotment} ${row.plan} credits for the month beginning ${startedAt.toISOString().slice(0, 10)}`,
  });
  return true;
}

/**
 * One month on from `date`, keeping the anchor day where the month is short:
 * a subscription bought on the 31st refills on the 28th in February and back
 * on the 31st in March, rather than drifting earlier every month.
 */
export function addOneMonth(date) {
  const anchorDay = date.getUTCDate();
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, daysInMonth));
  return next;
}

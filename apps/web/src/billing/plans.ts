/**
 * Posterract plan tiers + AI credit catalog.
 *
 * The static catalog below is DISPLAY data only (marketing copy, fallback
 * pricing). Anything that charges money — checkout URLs, Stripe price ids —
 * must come from the billing API (`/v1/billing/config`); tiers the API does
 * not advertise degrade to a "not available yet" state instead of guessing.
 */
import type { BillingConfigDTO, BillingPlanDTO } from "@posterract/contract";

export type PlanTierId = "creator" | "studio" | "agency";

export const PLAN_TIER_IDS: PlanTierId[] = ["creator", "studio", "agency"];

export type PlanTier = {
  id: PlanTierId;
  name: string;
  /** Display fallback in whole USD/month; the API amount wins when present. */
  monthlyUsd: number;
  /** AI credits granted each monthly cycle. */
  credits: number;
  tagline: string;
  /** What the credit allotment roughly buys, in plain terms. */
  creditNote: string;
  features: string[];
  /** Studio is the visually highlighted default choice. */
  highlight?: boolean;
};

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "creator",
    name: "Creator",
    monthlyUsd: 20,
    credits: 150,
    tagline: "The full publishing harness, plus a taster of the AI engine.",
    creditNote: "150 credits — a monthly taster",
    features: [
      "Publish + schedule on every connected platform",
      "Authorized analytics in one room",
      "Agent API keys",
      "150 AI credits each month",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    monthlyUsd: 50,
    credits: 2_250,
    tagline: "Enough generation to feed a real weekly content schedule.",
    creditNote: "2,250 credits — ~31 six-second clips",
    features: [
      "Everything in Creator",
      "2,250 AI credits each month",
      "~31 six-second AI clips",
      "Images, voice & transcription from the same pool",
    ],
    highlight: true,
  },
  {
    id: "agency",
    name: "Agency",
    monthlyUsd: 100,
    credits: 5_250,
    tagline: "Volume generation and headroom for client rosters.",
    creditNote: "5,250 credits — ~72 clips",
    features: [
      "Everything in Studio",
      "5,250 AI credits each month (~72 clips)",
      "Priority generation queue",
      "Higher account limits + longer scheduling horizon",
    ],
  },
];

export const PLAN_TIER_BY_ID: Record<PlanTierId, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((tier) => [tier.id, tier]),
) as Record<PlanTierId, PlanTier>;

export function isPlanTierId(value: unknown): value is PlanTierId {
  return value === "creator" || value === "studio" || value === "agency";
}

/** What credits buy, for display next to any balance. */
export const CREDIT_RATES = [
  { kind: "Image", rate: "10 cr / 1K · 15 cr / 2K" },
  { kind: "Video", rate: "12 cr per second · 20 cr/s in 2K HD (4–15s)" },
  { kind: "Voice", rate: "3 cr per 1,000 characters" },
  { kind: "Transcription", rate: "1 cr per minute" },
] as const;

// ---------------------------------------------------------------------------
// Credits state (GET /v1/credits)
// ---------------------------------------------------------------------------

export type CreditsSummary = {
  plan: PlanTierId | null;
  balance: number;
  allotment: number;
  /** ISO timestamp for the next monthly grant. */
  cycleResetsAt: string;
};

export type CreditsState = {
  plan: PlanTierId | null;
  balance: number;
  allotment: number;
  cycleResetsAt: string | null;
  loading: boolean;
  /** False in demo mode or while the credits endpoint is not live yet. */
  available: boolean;
};

export const UNAVAILABLE_CREDITS: CreditsState = {
  plan: null,
  balance: 0,
  allotment: 0,
  cycleResetsAt: null,
  loading: false,
  available: false,
};

export type CreditLedgerKind = "grant" | "reserve" | "settle" | "refund" | "expire";

export type CreditLedgerEntry = {
  id: string;
  delta: number;
  kind: CreditLedgerKind;
  note?: string;
  generationId?: string;
  createdAt: string;
};

export function formatCredits(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** "Resets Sep 14 · in 14 days" pieces for a cycleResetsAt timestamp. */
export function creditsResetInfo(cycleResetsAt: string | null | undefined):
  | { date: string; days: number; label: string }
  | undefined {
  if (!cycleResetsAt) return undefined;
  const at = new Date(cycleResetsAt);
  if (Number.isNaN(at.getTime())) return undefined;
  const days = Math.max(0, Math.ceil((at.getTime() - Date.now()) / 86_400_000));
  const date = at.toLocaleDateString([], { month: "short", day: "numeric" });
  const label = days === 0 ? "resets today" : days === 1 ? "resets tomorrow" : `resets in ${days} days`;
  return { date, days, label };
}

// ---------------------------------------------------------------------------
// Tier catalog from the billing API. `/v1/billing/config` historically knows a
// single plan (`plans.monthly` / `plans.yearly`); the tiered backend adds a
// `tiers` field. Both an array and a record keyed by tier id are accepted so
// the interface keeps working while the API side lands in parallel.
// ---------------------------------------------------------------------------

export type BillingTierPlans = {
  monthly?: BillingPlanDTO;
  yearly?: BillingPlanDTO;
};

export type BillingTierCatalog = Partial<Record<PlanTierId, BillingTierPlans>>;

export type ExtendedBillingConfig = BillingConfigDTO & {
  tiers?: unknown;
};

function readPlan(value: unknown): BillingPlanDTO | undefined {
  if (!value || typeof value !== "object") return undefined;
  const plan = value as Partial<BillingPlanDTO>;
  if (typeof plan.priceId !== "string" || typeof plan.amount !== "number") return undefined;
  return {
    priceId: plan.priceId,
    amount: plan.amount,
    currency: "usd",
    interval: plan.interval === "year" ? "year" : "month",
  };
}

function readTierEntry(id: unknown, value: unknown): [PlanTierId, BillingTierPlans] | undefined {
  if (!isPlanTierId(id) || !value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const nested = (entry.plans ?? entry) as Record<string, unknown>;
  const monthly = readPlan(nested.monthly) ?? readPlan(entry.monthly);
  const yearly = readPlan(nested.yearly) ?? readPlan(entry.yearly);
  if (!monthly && !yearly) return undefined;
  return [id, { monthly, yearly }];
}

/** Defensive reader for the tier catalog the billing API advertises. */
export function readTierCatalog(config: ExtendedBillingConfig | null | undefined): BillingTierCatalog {
  const catalog: BillingTierCatalog = {};
  const tiers = config?.tiers;
  if (!tiers || typeof tiers !== "object") return catalog;
  const entries = Array.isArray(tiers)
    ? tiers.map((tier) => [(tier as { id?: unknown })?.id, tier] as const)
    : Object.entries(tiers);
  for (const [id, value] of entries) {
    const read = readTierEntry(id, value);
    if (read) catalog[read[0]] = read[1];
  }
  return catalog;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Display price for a tier: the API amount when advertised, else the catalog fallback. */
export function tierMonthlyPrice(tier: PlanTier, catalog: BillingTierCatalog): string {
  const advertised = catalog[tier.id]?.monthly?.amount;
  return typeof advertised === "number" ? formatUsd(advertised) : formatUsd(tier.monthlyUsd * 100);
}

import { useEffect, useState } from "react";
import type { SavagesPlanDTO, SavagesPlanId } from "@posterract/contract";
import { posterractApiUrl } from "@/lib/authClient";

/** Each plan's price in cents, as Stripe charges it. */
export type SavagesPlans = Partial<Record<SavagesPlanId, number>>;

/** The public API's base: same origin in production, api.posterract.app elsewhere. */
export const savagesApiBase = () => posterractApiUrl || "https://api.posterract.app";

/** "$59.99", "$599.99", "$2,000", "$119.89". */
export function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function toPlans(list: SavagesPlanDTO[]): SavagesPlans {
  return Object.fromEntries(list.map((plan) => [plan.id, plan.amount]));
}

/** The live prices for the landing card. `initial` skips the request (the local preview passes it). */
export function useSavagesPlans(initial?: SavagesPlans) {
  const [plans, setPlans] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    setFailed(false);
    void fetch(`${savagesApiBase()}/v1/savages/plans`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const data = (await response.json()) as { plans?: SavagesPlanDTO[] };
        if (!data.plans?.length) throw new Error("unavailable");
        setPlans(toPlans(data.plans));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [initial, attempt]);

  return { plans, failed, retry: () => setAttempt((value) => value + 1) };
}

/** Stripe Checkout for someone with no Posterract login yet. Resolves to Stripe's URL. */
export async function startGuestCheckout(plan: SavagesPlanId): Promise<string> {
  const response = await fetch(`${savagesApiBase()}/v1/savages/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? "checkout_unavailable");
  return data.url;
}

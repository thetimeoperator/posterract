import { useEffect, useState } from "react";
import type { BillingConfigDTO } from "@posterract/contract";
import { posterractApiUrl } from "@/lib/authClient";

/** The plan's prices in cents, from the billing config the checkout itself uses. */
export type PlanPrices = { monthly: number; yearly: number };

export function usePlanPrices(initial?: PlanPrices) {
  const [prices, setPrices] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    setFailed(false);
    void fetch(`${posterractApiUrl || "https://api.posterract.app"}/v1/billing/config`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Pricing unavailable");
        const config = (await response.json()) as BillingConfigDTO;
        const monthly = config.plans?.monthly.amount;
        const yearly = config.plans?.yearly.amount;
        if (!config.configured || monthly === undefined || yearly === undefined) throw new Error("Pricing unavailable");
        setPrices({ monthly, yearly });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [initial, attempt]);

  return { prices, failed, retry: () => setAttempt((value) => value + 1) };
}

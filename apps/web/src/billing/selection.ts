export type PlanId = "pro" | "allstar" | "superstar";
export type BillingCycle = "monthly" | "yearly";
export type BillingSelection = { plan: PlanId; interval: BillingCycle };

export function readBillingSelection(search = window.location.search): BillingSelection {
  const params = new URLSearchParams(search);
  return {
    plan: "pro",
    interval: params.get("interval") === "yearly" ? "yearly" : "monthly",
  };
}

export function billingSelectionUrl(selection: BillingSelection): string {
  return `/?${new URLSearchParams({ ...selection, plan: "pro" })}`;
}

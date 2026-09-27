import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BusinessDTO } from "@posterract/contract";
import { useBusinesses } from "@/engine/useEngine";

/**
 * The business the whole app is looking at, picked in the header ("" = all
 * businesses). Calendar, Analytics and New post follow it. Remembered per
 * browser.
 */
export const useBusinessView = create<{ businessId: string; setBusinessId: (id: string) => void }>()(
  persist((set) => ({ businessId: "", setBusinessId: (businessId) => set({ businessId }) }), { name: "posterract.business-view" }),
);

/** The picked business, or undefined for all businesses (or one that was since deleted). */
export function useSelectedBusiness(): BusinessDTO | undefined {
  const businessId = useBusinessView((state) => state.businessId);
  const businesses = useBusinesses();
  return businesses.find((business) => business.id === businessId);
}

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, LayoutGrid, Plus } from "lucide-react";
import { BusinessLogo } from "@/components/BusinessLogo";
import { useBusinesses } from "@/engine/useEngine";
import { useBusinessView, useSelectedBusiness } from "@/state/business";

/**
 * The business the app is looking at: all of them, or one. Calendar,
 * Analytics and New post follow it. Always shown, so businesses are easy to
 * find even before the first one exists.
 */
export function BusinessSwitcher() {
  const businesses = useBusinesses();
  const selected = useSelectedBusiness();
  const setBusinessId = useBusinessView((state) => state.setBusinessId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const choose = (id: string) => { setBusinessId(id); setOpen(false); };
  const label = selected?.name ?? (businesses.length ? "All businesses" : "Businesses");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Business: ${label}`}
        className="app-header-business"
      >
        {selected ? <BusinessLogo name={selected.name} logoUrl={selected.logoUrl} size={20} /> : <LayoutGrid size={15} className="text-neon" />}
        <span className="app-header-business-name">{label}</span>
        <ChevronDown size={13} className={open ? "rotate-180 text-starlight-faint transition-transform" : "text-starlight-faint transition-transform"} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="glass popup-menu-surface absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-[var(--radius-card)] p-1.5"
          >
            <p className="kicker px-2.5 pb-1 pt-1.5 !text-[9px]">Show</p>
            <button role="menuitemradio" aria-checked={!selected} type="button" onClick={() => choose("")} className="app-header-business-option">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] text-neon"><LayoutGrid size={12} /></span>
              <span className="flex-1 truncate">All businesses</span>
              {!selected && <Check size={13} className="text-neon" />}
            </button>
            {businesses.map((business) => (
              <button key={business.id} role="menuitemradio" aria-checked={selected?.id === business.id} type="button" onClick={() => choose(business.id)} className="app-header-business-option">
                <BusinessLogo name={business.name} logoUrl={business.logoUrl} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{business.name}</span>
                  <span className="block text-[10px] text-starlight-faint">{business.accounts.length} account{business.accounts.length === 1 ? "" : "s"}</span>
                </span>
                {selected?.id === business.id && <Check size={13} className="text-neon" />}
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--glass-border)] pt-1">
              <Link to="/portals" role="menuitem" onClick={() => setOpen(false)} className="app-header-business-option text-neon">
                <span className="flex h-6 w-6 items-center justify-center"><Plus size={14} /></span>
                {businesses.length ? "Manage businesses" : "Create your first business"}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

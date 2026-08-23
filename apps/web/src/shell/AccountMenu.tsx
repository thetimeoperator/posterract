import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogIn, LogOut, Settings, UserRound } from "lucide-react";
import { useProfile, initials } from "@/state/profile";
import { authClient } from "@/lib/authClient";
import { ENGINE_MODE } from "@/engine/useEngine";

/** Account menu — avatar dropdown, the thing every product has top-right. */
export function AccountMenu() {
  const profile = useProfile();
  const navigate = useNavigate();
  const session = ENGINE_MODE === "cloud" ? authClient.useSession() : null;
  const displayName = session?.data?.user?.name || profile.displayName;
  const subtitle = session?.data?.user?.email || `${profile.handle} · ${profile.workspaceName}`;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--glass-border)] pl-1.5 pr-2 text-starlight-dim transition-colors hover:border-[var(--glass-border-bright)] hover:text-starlight"
      >
        <span className="border-aurora flex h-6 w-6 items-center justify-center rounded-full font-display text-[10px] font-bold text-starlight">
          {initials(displayName)}
        </span>
        <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="glass popup-menu-surface absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-[var(--radius-card)]"
          >
            <div className="border-b border-[var(--glass-border)] px-4 py-3">
              <p className="font-display text-[13px] font-semibold text-starlight">{displayName}</p>
              <p className="telemetry truncate text-[11px] text-starlight-faint">{subtitle}</p>
            </div>
            <div className="p-1.5">
              <MenuLink to="/settings" icon={<UserRound size={14} />} label="Profile" onPick={() => setOpen(false)} />
              <MenuLink to="/settings" icon={<Settings size={14} />} label="Settings" onPick={() => setOpen(false)} />
              {ENGINE_MODE === "cloud" ? (
                <button
                  role="menuitem"
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    await authClient.signOut();
                    void navigate({ to: "/gate" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-starlight-dim transition-colors hover:bg-[rgba(255,113,143,0.08)] hover:text-redshift"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              ) : (
                <div
                  role="menuitem"
                  aria-disabled
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12.5px] text-starlight-faint"
                  title="Demo mode — accounts live in the cloud build"
                >
                  <LogIn size={14} />
                  Demo mode (no account)
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuLink({
  to,
  icon,
  label,
  onPick,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  onPick: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onPick}
      className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12.5px] text-starlight-dim transition-colors hover:bg-[rgba(101,255,154,0.07)] hover:text-starlight"
    >
      {icon}
      {label}
    </Link>
  );
}

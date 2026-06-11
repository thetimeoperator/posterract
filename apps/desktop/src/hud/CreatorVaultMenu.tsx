import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Boxes, History, Menu, RadioTower, Send, UserRound, X } from "lucide-react";
import type { ContentCapsule, PlatformAccount, PublishJob } from "../state/types";

type VaultPage = "profile" | "generations";

type CreatorVaultMenuProps = {
  capsules: ContentCapsule[];
  selectedCapsuleId?: string;
  platformAccounts: PlatformAccount[];
  publishJobs: PublishJob[];
  onSelectCapsule: (capsuleId: string) => void;
  onOpenPost: (capsuleId: string) => void;
};

export function CreatorVaultMenu({
  capsules,
  selectedCapsuleId,
  platformAccounts,
  publishJobs,
  onSelectCapsule,
  onOpenPost,
}: CreatorVaultMenuProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<VaultPage>("profile");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const profileTabRef = useRef<HTMLButtonElement>(null);
  const generationsTabRef = useRef<HTMLButtonElement>(null);
  const readyCount = capsules.filter((capsule) => capsule.status === "ready").length;
  const scheduledCount = publishJobs.filter((job) => job.status === "scheduled").length;
  const connectedCount = platformAccounts.filter((account) => account.connected).length;

  const recentCapsules = useMemo(() => capsules.slice(0, 4), [capsules]);
  const closeVault = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPage("profile");
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const focusPageTab = useCallback((nextPage: VaultPage) => {
    window.requestAnimationFrame(() => {
      if (nextPage === "profile") {
        profileTabRef.current?.focus();
        return;
      }
      generationsTabRef.current?.focus();
    });
  }, []);

  const activatePage = useCallback(
    (nextPage: VaultPage) => {
      setPage(nextPage);
      focusPageTab(nextPage);
    },
    [focusPageTab],
  );

  const handlePageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nextPage =
      event.key === "ArrowRight" || event.key === "End"
        ? "generations"
        : event.key === "ArrowLeft" || event.key === "Home"
          ? "profile"
          : undefined;

    if (!nextPage) return;
    event.preventDefault();
    activatePage(nextPage);
  };

  useEffect(() => {
    if (!open) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      if (page === "profile") {
        profileTabRef.current?.focus();
        return;
      }
      generationsTabRef.current?.focus();
    });

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeVault(true);
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeVault, open, page]);

  return (
    <div className={clsx("creator-vault", open && "is-open")}>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="creator-vault__halo"
              initial={{ opacity: 0, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.76 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            />

            <motion.aside
              id="creator-vault-panel"
              className="creator-vault__panel hud-panel"
              data-testid="creator-vault-panel"
              role="dialog"
              aria-label="Creator vault"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="vault-page-switch" role="tablist" aria-label="Vault pages" onKeyDown={handlePageKeyDown}>
                <button
                  ref={profileTabRef}
                  id="vault-profile-tab"
                  role="tab"
                  data-testid="vault-profile-page"
                  className={clsx(page === "profile" && "is-active")}
                  type="button"
                  aria-selected={page === "profile"}
                  aria-controls="vault-profile-panel"
                  tabIndex={page === "profile" ? 0 : -1}
                  onClick={() => activatePage("profile")}
                >
                  <UserRound size={14} />
                  Profile
                </button>
                <button
                  ref={generationsTabRef}
                  id="vault-generations-tab"
                  role="tab"
                  data-testid="vault-generations-page"
                  className={clsx(page === "generations" && "is-active")}
                  type="button"
                  aria-selected={page === "generations"}
                  aria-controls="vault-generations-panel"
                  tabIndex={page === "generations" ? 0 : -1}
                  onClick={() => activatePage("generations")}
                >
                  <History size={14} />
                  Generated
                </button>
              </div>

              <AnimatePresence mode="wait">
                {page === "profile" ? (
                  <motion.div
                    key="profile"
                    id="vault-profile-panel"
                    role="tabpanel"
                    aria-labelledby="vault-profile-tab"
                    className="vault-page"
                    data-testid="vault-profile-panel"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    <div className="vault-profile">
                      <div className="vault-avatar">
                        <span>VX</span>
                      </div>
                      <div>
                        <span>Creator profile</span>
                        <strong>Local creator agent</strong>
                        <small>{connectedCount} social relays online</small>
                      </div>
                    </div>

                    <div className="vault-stats" aria-label="Creator vault stats">
                      <div>
                        <strong>{capsules.length}</strong>
                        <small>Generated</small>
                      </div>
                      <div>
                        <strong>{readyCount}</strong>
                        <small>Ready</small>
                      </div>
                      <div>
                        <strong>{scheduledCount}</strong>
                        <small>Scheduled</small>
                      </div>
                    </div>

                    <div className="vault-section-title">
                      <RadioTower size={14} />
                      <span>Connected relays</span>
                    </div>
                    <div className="vault-relay-grid">
                      {platformAccounts.slice(0, 4).map((account) => (
                        <span key={account.id} className={clsx(account.connected && "is-online")}>
                          <i style={{ background: account.color }} />
                          {account.platform}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="generations"
                    id="vault-generations-panel"
                    role="tabpanel"
                    aria-labelledby="vault-generations-tab"
                    className="vault-page"
                    data-testid="vault-generations-panel"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    <div className="vault-section-title vault-section-title--top">
                      <History size={14} />
                      <span>Past Generated Parts</span>
                    </div>

                    <div className="vault-generation-list" data-testid="vault-generations">
                      {recentCapsules.map((capsule, index) => (
                        <motion.button
                          key={capsule.id}
                          className={clsx("vault-generation", capsule.id === selectedCapsuleId && "is-selected")}
                          type="button"
                          aria-pressed={capsule.id === selectedCapsuleId}
                          initial={{ opacity: 0, x: -14 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.22, delay: 0.04 + index * 0.045 }}
                          onClick={() => {
                            onSelectCapsule(capsule.id);
                            onOpenPost(capsule.id);
                            closeVault();
                          }}
                        >
                          <span className="vault-generation__core" style={{ background: capsule.thumbnailTone }} />
                          <span className="vault-generation__copy">
                            <strong>{capsule.title}</strong>
                            <small>
                              {capsule.status} / {capsule.duration}
                            </small>
                          </span>
                          <Send size={13} />
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.aside>

            <motion.div
              className="creator-vault__orbit"
              initial={{ opacity: 0, scale: 0.7, rotate: -18 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.72, rotate: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <span>
                <UserRound size={14} />
              </span>
              <span>
                <Boxes size={14} />
              </span>
              <span>
                <RadioTower size={14} />
              </span>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        ref={triggerRef}
        className="creator-vault__button"
        data-testid="creator-vault-button"
        type="button"
        aria-label={open ? "Close creator vault" : "Open creator vault"}
        aria-expanded={open}
        aria-controls="creator-vault-panel"
        onClick={() => {
          if (open) {
            closeVault();
            return;
          }
          setPage("profile");
          setOpen(true);
        }}
      >
        <span className="creator-vault__button-ring">{open ? <X size={18} /> : <Menu size={18} />}</span>
        <strong>Vault</strong>
      </button>
    </div>
  );
}

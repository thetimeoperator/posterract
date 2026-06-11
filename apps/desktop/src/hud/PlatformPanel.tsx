import clsx from "clsx";
import { Check, PlugZap, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { PlatformAccount, PlatformId } from "../state/types";

type PlatformPanelProps = {
  accounts: PlatformAccount[];
  selectedPlatformIds: PlatformId[];
  onTogglePlatform: (platformId: PlatformId) => void;
};

export function PlatformPanel({ accounts, selectedPlatformIds, onTogglePlatform }: PlatformPanelProps) {
  const statusLabel = (account: PlatformAccount) =>
    account.connectionStatus ? account.connectionStatus.replaceAll("_", " ") : "needs connection";

  return (
    <motion.aside
      className="platform-panel hud-panel"
      initial={{ x: 34, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut", delay: 0.06 }}
    >
      <div className="panel-kicker">
        <PlugZap size={14} />
        <span>Platform Targets</span>
      </div>
      <div className="platform-grid" data-testid="platform-panel">
        {accounts.map((account) => {
          const selectable = account.connected;
          const selected = selectable && selectedPlatformIds.includes(account.id);
          return (
            <button
              key={account.id}
              className={clsx("platform-card", selected && "is-selected", !selectable && "is-disabled")}
              style={{ "--platform-color": account.color } as CSSProperties}
              type="button"
              disabled={!selectable}
              aria-disabled={!selectable}
              onClick={() => onTogglePlatform(account.id)}
            >
              <span className="platform-card__mark">{account.platform.slice(0, 2).toUpperCase()}</span>
              <span className="platform-card__copy">
                <strong>{account.platform}</strong>
                <small>{account.handle}</small>
              </span>
              <span className="platform-card__state">
                {selectable ? (
                  selected ? (
                    <>
                      <Check size={14} />
                      <span>Selected</span>
                    </>
                  ) : (
                    "Ready"
                  )
                ) : (
                  <>
                    <ShieldAlert size={14} />
                    <span>{statusLabel(account)}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </motion.aside>
  );
}

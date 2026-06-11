import clsx from "clsx";
import { Check, Clock3, Loader2, Send, ShieldAlert } from "lucide-react";
import { formatShortDateTime } from "../lib/format";
import type { ContentCapsule, PlatformAccount, PublishJob } from "../state/types";

type PublishQueueProps = {
  jobs: PublishJob[];
  capsules: ContentCapsule[];
  platformAccounts: PlatformAccount[];
};

function JobIcon({ status }: { status: PublishJob["status"] }) {
  if (status === "posted") return <Check size={13} />;
  if (["posting", "claiming", "uploading_media", "publishing", "processing", "retrying"].includes(status)) {
    return <Loader2 size={13} />;
  }
  if (["needs-connection", "needs_reauth", "blocked_by_platform", "failed"].includes(status)) {
    return <ShieldAlert size={13} />;
  }
  return <Clock3 size={13} />;
}

const statusCopy = (status: PublishJob["status"]) => status.replaceAll("_", " ").replace("needs-connection", "needs connection");

export function PublishQueue({ jobs, capsules, platformAccounts }: PublishQueueProps) {
  return (
    <section className="publish-queue hud-panel">
      <div className="panel-kicker">
        <Send size={14} />
        <span>Launch Queue</span>
      </div>
      <div className="publish-list" data-testid="publish-queue">
        {jobs.length === 0 && <span className="empty-artifacts">No publish jobs yet</span>}
        {jobs.slice(0, 6).map((job) => {
          const capsule = capsules.find((item) => item.id === job.capsuleId);
          const account = platformAccounts.find((item) => item.id === job.platformId);

          return (
            <div className={clsx("publish-row", `is-${job.status}`)} data-testid="publish-job" key={job.id}>
              <span className="publish-row__icon">
                <JobIcon status={job.status} />
              </span>
              <span className="publish-row__copy">
                <strong>{account?.platform ?? job.platformId}</strong>
                <small>{capsule?.title ?? job.label}</small>
              </span>
              <span className="publish-row__status">
                {statusCopy(job.status)}
                <small>{formatShortDateTime(job.scheduledFor)}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

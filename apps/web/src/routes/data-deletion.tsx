import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { LegalPage } from "./privacy";

type DeletionSearch = { code?: string };
type DeletionStatus = {
  provider: "instagram" | "facebook" | "threads";
  status: "processing" | "completed";
  requestedAt: number;
  completedAt?: number;
} | null;

const deletionStatusClient = import.meta.env.VITE_CONVEX_URL
  ? new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL)
  : null;

export const Route = createFileRoute("/data-deletion")({
  validateSearch: (search: Record<string, unknown>): DeletionSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
  component: DataDeletionStatus,
});

function DataDeletionStatus() {
  const { code } = Route.useSearch();
  const normalizedCode = code?.trim().toUpperCase();
  const convexConfigured = Boolean(import.meta.env.VITE_CONVEX_URL);

  return (
    <LegalPage title="Data Deletion Status" updated="July 20, 2026">
      <p className="legal-lede">
        Use the confirmation code returned by Meta to check a Posterract platform-data deletion
        request.
      </p>

      {!convexConfigured ? (
        <StatusCard title="Status service unavailable" state="UNAVAILABLE">
          The deletion-status service is not configured in this environment. The production
          Posterract status URL remains available.
        </StatusCard>
      ) : !normalizedCode ? (
        <StatusCard title="Confirmation code required" state="AWAITING CODE">
          Open the complete status URL provided when the deletion request was submitted, or contact
          Posterract support with your confirmation code.
        </StatusCard>
      ) : (
        <DeletionReceipt confirmationCode={normalizedCode} />
      )}

      <p>
        Questions about a deletion request can be sent to{" "}
        <a href="mailto:pahlevansina@gmail.com">pahlevansina@gmail.com</a>. Include only the
        confirmation code; never email an OAuth token or social-platform password.
      </p>
    </LegalPage>
  );
}

function DeletionReceipt({ confirmationCode }: { confirmationCode: string }) {
  const [status, setStatus] = useState<DeletionStatus | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus(undefined);
    setFailed(false);

    if (!deletionStatusClient) {
      setFailed(true);
      return () => {
        active = false;
      };
    }

    deletionStatusClient
      .query(api.metaCallbacks.getDeletionStatus, { confirmationCode })
      .then((receipt) => {
        if (active) setStatus(receipt);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [confirmationCode]);

  if (failed) {
    return (
      <StatusCard title="Status service unavailable" state="UNAVAILABLE">
        Posterract could not retrieve this deletion receipt. Contact Posterract support with the
        confirmation code so the request can be verified.
      </StatusCard>
    );
  }
  if (status === undefined) {
    return (
      <StatusCard title="Checking request" state="VERIFYING">
        Posterract is retrieving the deletion receipt.
      </StatusCard>
    );
  }
  if (status === null) {
    return (
      <StatusCard title="Request not found" state="NO MATCH">
        This confirmation code is invalid or is not associated with a Posterract deletion request.
        Confirm that the complete code was copied correctly.
      </StatusCard>
    );
  }
  return (
    <StatusCard
      title={status.status === "completed" ? "Deletion completed" : "Deletion in progress"}
      state={status.status === "completed" ? "COMPLETED" : "PROCESSING"}
    >
      <dl className="mt-5 grid gap-3 text-[12px] sm:grid-cols-2">
        <StatusField label="Platform" value={platformName(status.provider)} />
        <StatusField label="Confirmation code" value={confirmationCode} mono />
        <StatusField label="Requested" value={formatTimestamp(status.requestedAt)} />
        <StatusField
          label="Completed"
          value={status.completedAt ? formatTimestamp(status.completedAt) : "Processing"}
        />
      </dl>
      <p className="mt-5">
        {status.status === "completed"
          ? "Posterract has removed the matching connection credentials and stored platform-derived data. If no matching connection existed, the request is complete because Posterract had no associated platform data to remove."
          : "The request has been authenticated and Posterract is completing the associated cleanup."}
      </p>
    </StatusCard>
  );
}

function StatusCard({
  title,
  state,
  children,
}: {
  title: string;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section className="platform-policy platform-policy-featured" aria-live="polite">
      <div className="platform-policy-heading">
        <h2 className="!mt-0">{title}</h2>
        <span>{state}</span>
      </div>
      <div>{children}</div>
    </section>
  );
}

function StatusField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="telemetry text-[9px] uppercase tracking-[0.12em] text-starlight-faint">
        {label}
      </dt>
      <dd className={`mt-1 text-starlight ${mono ? "font-mono break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function platformName(provider: "instagram" | "facebook" | "threads"): string {
  if (provider === "instagram") return "Instagram";
  if (provider === "facebook") return "Facebook";
  return "Threads";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

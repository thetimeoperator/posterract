declare const process: {
  env: Record<string, string | undefined>;
};

export type ConnectorMode = "fake" | "live";

export type WorkerEnv = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  workerSecret?: string;
  maxJobs: number;
  connectorMode: ConnectorMode;
};

const optional = (name: string) => process.env[name]?.trim();

const required = (name: string) => {
  const value = optional(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const connectorMode = (value: string | undefined): ConnectorMode => (value === "live" ? "live" : "fake");

export function loadEnv(): WorkerEnv {
  return {
    supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    workerId: optional("VIDTRYX_WORKER_ID") ?? `vidtryx-worker-${Date.now()}`,
    workerSecret: optional("VIDTRYX_WORKER_SECRET"),
    maxJobs: positiveInteger(optional("VIDTRYX_MAX_JOBS"), 10),
    connectorMode: connectorMode(optional("VIDTRYX_CONNECTOR_MODE")),
  };
}

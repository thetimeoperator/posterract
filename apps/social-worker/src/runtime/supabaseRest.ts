import type {
  PlatformAccountRow,
  PostPackageRow,
  PublishAttemptInsert,
  PublishEventInsert,
  PublishJobRow,
} from "./types";

export type SupabaseRestClient = {
  claimDuePublishJobs(maxJobs: number, workerId: string): Promise<PublishJobRow[]>;
  getPostPackage(packageId: string): Promise<PostPackageRow>;
  getPlatformAccount(accountId: string): Promise<PlatformAccountRow>;
  updatePublishJob(jobId: string, patch: Partial<PublishJobRow>): Promise<PublishJobRow>;
  insertPublishAttempt(attempt: PublishAttemptInsert): Promise<void>;
  insertPublishEvent(event: PublishEventInsert): Promise<void>;
};

type RestClientInput = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

const encodeFilter = (value: string) => encodeURIComponent(value);

class SupabaseRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SupabaseRestError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new SupabaseRestError(`Supabase request failed with ${response.status}`, response.status, text);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function createSupabaseRestClient(input: RestClientInput): SupabaseRestClient {
  const baseUrl = input.supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: input.serviceRoleKey,
    authorization: `Bearer ${input.serviceRoleKey}`,
    "content-type": "application/json",
  };

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...init.headers,
      },
    });
    return parseResponse<T>(response);
  };

  const selectOne = async <T>(table: string, id: string): Promise<T> => {
    const rows = await request<T[]>(`/rest/v1/${table}?id=eq.${encodeFilter(id)}&limit=1`, {
      method: "GET",
    });
    const row = rows[0];
    if (!row) throw new Error(`Missing ${table} row ${id}`);
    return row;
  };

  return {
    claimDuePublishJobs(maxJobs, workerId) {
      return request<PublishJobRow[]>("/rest/v1/rpc/claim_due_publish_jobs", {
        method: "POST",
        body: JSON.stringify({ max_jobs: maxJobs, worker_id: workerId }),
      });
    },

    getPostPackage(packageId) {
      return selectOne<PostPackageRow>("post_packages", packageId);
    },

    getPlatformAccount(accountId) {
      return selectOne<PlatformAccountRow>("platform_accounts", accountId);
    },

    async updatePublishJob(jobId, patch) {
      const rows = await request<PublishJobRow[]>(`/rest/v1/publish_jobs?id=eq.${encodeFilter(jobId)}`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      const row = rows[0];
      if (!row) throw new Error(`Publish job ${jobId} was not updated`);
      return row;
    },

    async insertPublishAttempt(attempt) {
      await request<unknown>("/rest/v1/publish_attempts", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(attempt),
      });
    },

    async insertPublishEvent(event) {
      await request<unknown>("/rest/v1/publish_events", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          ...event,
          payload: event.payload ?? {},
        }),
      });
    },
  };
}

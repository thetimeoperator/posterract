import { loadEnv } from "./env";
import { runPublishWorkerTick } from "./runtime/jobRunner";
import { createSupabaseRestClient } from "./runtime/supabaseRest";

export async function main() {
  const env = loadEnv();
  const db = createSupabaseRestClient({
    supabaseUrl: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const claimedCount = await runPublishWorkerTick({ env, db });
  console.log(`Vidtryx social worker claimed ${claimedCount} publish job(s).`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Vidtryx social worker failed: ${message}`);
});

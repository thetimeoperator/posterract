// Run from apps/orchestrator. Reads histories only; no activities are executed.
import { resolve } from "node:path";
import { Client, Connection } from "@temporalio/client";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";

const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
try {
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE || "default" });
  const workflowBundle = await bundleWorkflowCode({ workflowsPath: resolve("src/workflows.js") });
  let verified = 0;
  for await (const execution of client.workflow.list({ query: 'WorkflowType = "publicationWorkflow"', pageSize: 5 })) {
    const history = await client.workflow.getHandle(execution.workflowId, execution.runId).fetchHistory();
    await Worker.runReplayHistory({ workflowBundle }, history);
    verified++;
    if (verified === 5) break;
  }
  console.log(JSON.stringify({ historicalPublicationWorkflowsReplayed: verified, activitiesExecuted: 0 }));
} finally { await connection.close(); }

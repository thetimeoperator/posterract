import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net: re-dispatch any due post whose run was lost (deploy mid-publish,
// crash, etc.). The exact-time scheduler is the primary mechanism.
crons.interval("sweep stalled posts", { minutes: 2 }, internal.publish.sweep, {});

export default crons;

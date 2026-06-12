import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";

/** The signed-in user's workspace, or null (logged out / not bootstrapped). */
export async function getOwnedWorkspace(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"workspaces"> | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  return await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .first();
}

/** Like getOwnedWorkspace but throws — for mutations. */
export async function requireWorkspace(ctx: QueryCtx | MutationCtx): Promise<Doc<"workspaces">> {
  const workspace = await getOwnedWorkspace(ctx);
  if (!workspace) throw new Error("Not signed in (or workspace not initialized)");
  return workspace;
}

/** Assert a document belongs to the caller's workspace. */
export function assertOwnership(
  doc: { workspaceId: Doc<"workspaces">["_id"] } | null | undefined,
  workspace: Doc<"workspaces">,
): asserts doc is { workspaceId: Doc<"workspaces">["_id"] } {
  if (!doc || doc.workspaceId !== workspace._id) {
    throw new Error("Not found");
  }
}

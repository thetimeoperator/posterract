import { DeleteObjectCommand } from "@aws-sdk/client-s3";

export function loadVaultMedia(postgres, workspaceId) {
  return postgres.query(
    `select * from media_assets
     where workspace_id = $1 and purged_at is null
       and status not in ('purged', 'aborted')
     order by created_at desc`,
    [workspaceId],
  );
}

export function registerMediaDeleteRoute(app, { postgres, r2, environment, requireMediaWrite, requiredWorkspace }) {
  app.delete("/v1/media/:id", { preHandler: requireMediaWrite }, async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const client = await postgres.connect();
    try {
      await client.query("begin");
      // Serialize with post creation, which locks the same asset before using it.
      const { rows: [media] } = await client.query(
        `select id, r2_key, status, purged_at from media_assets
         where id = $1 and workspace_id = $2 for update`,
        [request.params.id, workspaceId],
      );
      // Deletion is complete when the workspace's asset is already gone.
      if (!media || media.purged_at || media.status === "purged") {
        await client.query("commit");
        return reply.code(204).send();
      }
      const inUse = await client.query(
        `select 1 from transmissions
         where media_asset_id = $1 and status in ('scheduled', 'transmitting') limit 1`,
        [media.id],
      );
      if (inUse.rows.length) {
        await client.query("rollback");
        return reply.code(409).send({ error: "media_in_use" });
      }
      if (r2) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: environment.R2_BUCKET, Key: media.r2_key }));
        } catch (error) {
          // An absent object must not strand its database entry. Permission,
          // bucket and service failures still fail instead of hiding real media.
          const code = error.name || error.Code || error.code;
          if (code !== "NoSuchKey" && code !== "NotFound") throw error;
        }
      }
      await client.query(
        `update media_assets set status = 'purged', purged_at = now(), updated_at = now()
         where id = $1 and workspace_id = $2`,
        [media.id, workspaceId],
      );
      await client.query("commit");
      return reply.code(204).send();
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });
}

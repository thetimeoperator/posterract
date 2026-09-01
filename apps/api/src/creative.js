import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  applyEdits,
  compileVirtualProject,
  stampProject,
} from "@posterract/video-compiler";
import { POSTERRACT_STARTER_SOURCE } from "@posterract/video-compiler/starter";

const MAX_FILES = 100;
const MAX_FILE_BYTES = 1_048_576;
const MAX_SOURCE_BYTES = 5_242_880;
const RUNTIME_VERSION = "diffusion-aeb873b";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceHash(files) {
  return sha256(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => `${path}\0${sha256(content)}`)
      .join("\0"),
  );
}

function languageFor(path) {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".json")) return "json";
  return "md";
}

function validPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => !segment || segment === "." || segment === "..") &&
    /\.(tsx|ts|json|md)$/.test(path)
  );
}

function validAssetPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  );
}

function validManifest(manifest) {
  return (
    manifest &&
    typeof manifest === "object" &&
    manifest.version === 1 &&
    Array.isArray(manifest.folders) &&
    manifest.folders.length <= 1_000 &&
    Array.isArray(manifest.assets) &&
    manifest.assets.length <= 10_000
  );
}

function validateFiles(files) {
  const entries = Object.entries(files);
  if (!entries.length || entries.length > MAX_FILES) throw new Error("invalid_file_count");
  let total = 0;
  for (const [path, content] of entries) {
    if (!validPath(path) || typeof content !== "string") throw new Error("invalid_source_file");
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_FILE_BYTES) throw new Error("source_file_too_large");
    total += bytes;
  }
  if (total > MAX_SOURCE_BYTES) throw new Error("project_source_too_large");
}

function actorFrom(request) {
  if (request.authContext?.kind === "api_key") {
    return { type: "agent_api_key", apiKeyId: request.authContext.apiKeyId, userId: null };
  }
  if (request.authContext?.kind === "session") {
    return { type: "user", apiKeyId: null, userId: request.authContext.userId };
  }
  return { type: "system", apiKeyId: null, userId: null };
}

function publicProject(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    entryPath: row.entry_path,
    width: row.width,
    height: row.height,
    frameRate: Number(row.frame_rate),
    defaultDurationMs: row.default_duration_ms,
    retentionPolicy: row.retention_policy,
    currentRevisionId: row.current_revision_id,
    lastGoodRevisionId: row.last_good_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadRevisionFiles(client, revisionId) {
  const result = await client.query(
    `select path, content
     from creative_project_revision_files
     where revision_id = $1
     order by path`,
    [revisionId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.path, row.content]));
}

async function loadProject(client, workspaceId, projectId, lock = false) {
  const result = await client.query(
    `select * from creative_projects
     where id = $1 and workspace_id = $2 and deleted_at is null
     ${lock ? "for update" : ""}`,
    [projectId, workspaceId],
  );
  return result.rows[0];
}

async function createRevision(client, project, files, actor, message) {
  validateFiles(files);
  const numberResult = await client.query(
    `select coalesce(max(revision_number), 0) + 1 as next
     from creative_project_revisions where project_id = $1`,
    [project.id],
  );
  const revisionId = randomUUID();
  const revisionNumber = Number(numberResult.rows[0].next);
  await client.query(
    `insert into creative_project_revisions
      (id, project_id, revision_number, parent_revision_id, actor_type,
       actor_user_id, actor_api_key_id, message, source_hash, runtime_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      revisionId,
      project.id,
      revisionNumber,
      project.current_revision_id,
      actor.type,
      actor.userId,
      actor.apiKeyId,
      message ?? null,
      sourceHash(files),
      RUNTIME_VERSION,
    ],
  );
  for (const [path, content] of Object.entries(files)) {
    await client.query(
      `insert into creative_project_revision_files
        (revision_id, path, content, content_hash, language, size_bytes)
       values ($1, $2, $3, $4, $5, $6)`,
      [revisionId, path, content, sha256(content), languageFor(path), Buffer.byteLength(content)],
    );
  }
  await client.query(
    `update creative_projects
     set current_revision_id = $2, updated_at = now(), last_opened_at = now()
     where id = $1`,
    [project.id, revisionId],
  );
  return { id: revisionId, number: revisionNumber };
}

async function compileRevision(postgres, projectId, revisionId) {
  await postgres.query(
    `update creative_project_revisions set compile_status = 'compiling' where id = $1 and project_id = $2`,
    [revisionId, projectId],
  );
  const projectResult = await postgres.query(
    `select entry_path from creative_projects where id = $1`,
    [projectId],
  );
  const files = await loadRevisionFiles(postgres, revisionId);
  const result = await compileVirtualProject(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    projectResult.rows[0]?.entry_path ?? "index.tsx",
  );
  await postgres.query(
    `update creative_project_revisions
     set compile_status = $2, compile_diagnostics = $3::jsonb
     where id = $1`,
    [revisionId, result.ok ? "succeeded" : "failed", JSON.stringify(result.diagnostics)],
  );
  if (result.ok) {
    await postgres.query(
      `update creative_projects
       set last_good_revision_id = $2, status = 'ready', updated_at = now()
       where id = $1`,
      [projectId, revisionId],
    );
  }
  return result;
}

export function registerCreativeRoutes(
  app,
  { postgres, requireScope, requiredWorkspace, r2, r2Bucket, signedUrlTtlSeconds = 3_600 },
) {
  const requireCreativeRead = requireScope("creative:read");
  const requireCreativeWrite = requireScope("creative:write");

  app.get("/v1/creative-projects", { preHandler: requireCreativeRead }, async (request) => {
    const result = await postgres.query(
      `select * from creative_projects
       where workspace_id = $1 and deleted_at is null
       order by updated_at desc`,
      [requiredWorkspace(request)],
    );
    return { projects: result.rows.map(publicProject) };
  });

  app.post("/v1/creative-projects", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const workspaceId = requiredWorkspace(request);
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 160) : "Untitled project";
    const actor = actorFrom(request);
    const client = await postgres.connect();
    let project;
    let revision;
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into creative_projects
          (workspace_id, title, created_by_user_id, created_by_api_key_id)
         values ($1, $2, $3, $4) returning *`,
        [workspaceId, title || "Untitled project", actor.userId, actor.apiKeyId],
      );
      project = inserted.rows[0];
      const files = { "index.tsx": POSTERRACT_STARTER_SOURCE };
      await stampProject({ files });
      revision = await createRevision(client, project, files, actor, "Created project");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const compilation = await compileRevision(postgres, project.id, revision.id);
    return reply.code(201).send({ project: { ...publicProject({ ...project, current_revision_id: revision.id }), currentRevisionId: revision.id }, revision, compilation });
  });

  app.get("/v1/creative-projects/:projectId", { preHandler: requireCreativeRead }, async (request, reply) => {
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const files = project.current_revision_id ? await loadRevisionFiles(postgres, project.current_revision_id) : {};
    return { project: publicProject(project), files };
  });

  app.patch("/v1/creative-projects/:projectId", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 160) : "";
    if (!title) return reply.code(400).send({ error: "creative_project_title_required" });
    const result = await postgres.query(
      `update creative_projects set title = $3, updated_at = now()
       where id = $1 and workspace_id = $2 and deleted_at is null returning *`,
      [request.params.projectId, requiredWorkspace(request), title],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "creative_project_not_found" });
    return { project: publicProject(result.rows[0]) };
  });

  app.post("/v1/creative-projects/:projectId/compile", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const revisionId = request.body?.revisionId ?? project.current_revision_id;
    if (!revisionId) return reply.code(409).send({ error: "creative_project_has_no_revision" });
    const compilation = await compileRevision(postgres, project.id, revisionId);
    return reply.code(compilation.ok ? 200 : 422).send({ revisionId, ...compilation });
  });

  app.put("/v1/creative-projects/:projectId/files", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const { path, content, expectedRevisionId, message } = request.body ?? {};
    if (!validPath(path) || typeof content !== "string" || typeof expectedRevisionId !== "string") {
      return reply.code(400).send({ error: "invalid_creative_file_write" });
    }
    const workspaceId = requiredWorkspace(request);
    const actor = actorFrom(request);
    const client = await postgres.connect();
    let revision;
    try {
      await client.query("begin");
      const project = await loadProject(client, workspaceId, request.params.projectId, true);
      if (!project) {
        await client.query("rollback");
        return reply.code(404).send({ error: "creative_project_not_found" });
      }
      if (project.current_revision_id !== expectedRevisionId) {
        await client.query("rollback");
        return reply.code(409).send({ error: "revision_conflict", detail: { expectedRevisionId, currentRevisionId: project.current_revision_id } });
      }
      const files = await loadRevisionFiles(client, project.current_revision_id);
      files[path] = content;
      await stampProject({ files });
      revision = await createRevision(client, project, files, actor, message ?? `Updated ${path}`);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const compilation = await compileRevision(postgres, request.params.projectId, revision.id);
    return reply.code(compilation.ok ? 200 : 422).send({ revision, compilation });
  });

  app.post("/v1/creative-projects/:projectId/operations", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const { baseRevisionId, batchId, idempotencyKey, operations } = request.body ?? {};
    if (!baseRevisionId || !batchId || !idempotencyKey || !Array.isArray(operations) || !operations.length) {
      return reply.code(400).send({ error: "invalid_creative_operations" });
    }
    const workspaceId = requiredWorkspace(request);
    const actor = actorFrom(request);
    const client = await postgres.connect();
    let revision;
    let writeResult;
    try {
      await client.query("begin");
      const existing = await client.query(
        `select committed_revision_id from creative_operations
         where project_id = $1 and idempotency_key = $2`,
        [request.params.projectId, idempotencyKey],
      );
      if (existing.rows[0]?.committed_revision_id) {
        await client.query("rollback");
        return { revision: { id: existing.rows[0].committed_revision_id }, replayed: true };
      }
      const project = await loadProject(client, workspaceId, request.params.projectId, true);
      if (!project) {
        await client.query("rollback");
        return reply.code(404).send({ error: "creative_project_not_found" });
      }
      if (project.current_revision_id !== baseRevisionId) {
        await client.query("rollback");
        return reply.code(409).send({ error: "revision_conflict", detail: { expectedRevisionId: baseRevisionId, currentRevisionId: project.current_revision_id } });
      }
      const files = await loadRevisionFiles(client, baseRevisionId);
      writeResult = await applyEdits({ files }, operations);
      revision = await createRevision(client, project, files, actor, "Visual edit");
      const operationId = randomUUID();
      await client.query(
        `insert into creative_operations
          (id, project_id, base_revision_id, committed_revision_id, batch_id,
           idempotency_key, actor_type, actor_user_id, actor_api_key_id,
           operations, status, committed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'committed', now())`,
        [operationId, project.id, baseRevisionId, revision.id, batchId, idempotencyKey, actor.type, actor.userId, actor.apiKeyId, JSON.stringify(operations)],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const compilation = await compileRevision(postgres, request.params.projectId, revision.id);
    const files = await loadRevisionFiles(postgres, revision.id);
    return reply.code(compilation.ok ? 200 : 422).send({ revision, writeResult, files, compilation });
  });

  app.get("/v1/creative-projects/:projectId/assets/manifest", { preHandler: requireCreativeRead }, async (request, reply) => {
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const result = await postgres.query(
      `select manifest from creative_project_asset_manifests where project_id = $1`,
      [project.id],
    );
    return { manifest: result.rows[0]?.manifest ?? { version: 1, folders: [], assets: [] } };
  });

  app.put("/v1/creative-projects/:projectId/assets/manifest", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const manifest = request.body?.manifest;
    if (!validManifest(manifest) || Buffer.byteLength(JSON.stringify(manifest)) > 1_048_576) {
      return reply.code(400).send({ error: "invalid_creative_asset_manifest" });
    }
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    await postgres.query(
      `insert into creative_project_asset_manifests (project_id, manifest)
       values ($1, $2::jsonb)
       on conflict (project_id) do update
       set manifest = excluded.manifest, updated_at = now()`,
      [project.id, JSON.stringify(manifest)],
    );
    return { saved: true };
  });

  app.get("/v1/creative-projects/:projectId/assets/list", { preHandler: requireCreativeRead }, async (request, reply) => {
    const source = String(request.query?.source ?? "").replace(/^\/+|\/+$/g, "");
    if (source && !validAssetPath(source)) return reply.code(400).send({ error: "invalid_creative_asset_path" });
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const result = await postgres.query(
      `select path, size_bytes, mime_type, modified_at
       from creative_project_assets where project_id = $1 order by path`,
      [project.id],
    );
    const prefix = source ? `${source}/` : "";
    const entries = new Map();
    for (const row of result.rows) {
      if (!row.path.startsWith(prefix)) continue;
      const remainder = row.path.slice(prefix.length);
      if (!remainder) continue;
      const slash = remainder.indexOf("/");
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      if (slash !== -1) {
        if (!entries.has(name)) entries.set(name, { name, kind: "directory", size: 0, mtime: new Date(row.modified_at).getTime() });
      } else {
        entries.set(name, { name, kind: "file", size: Number(row.size_bytes), mtime: new Date(row.modified_at).getTime(), mimeType: row.mime_type });
      }
    }
    return { entries: [...entries.values()] };
  });

  app.get("/v1/creative-projects/:projectId/assets/file", { preHandler: requireCreativeRead }, async (request, reply) => {
    const path = String(request.query?.path ?? "");
    if (!validAssetPath(path)) return reply.code(400).send({ error: "invalid_creative_asset_path" });
    if (!r2 || !r2Bucket) return reply.code(503).send({ error: "r2_not_configured" });
    const result = await postgres.query(
      `select a.path, a.size_bytes, a.mime_type, a.modified_at,
              m.original_filename, m.r2_key
       from creative_project_assets a
       join creative_projects p on p.id = a.project_id
       join media_assets m on m.id = a.media_asset_id
       where a.project_id = $1 and a.path = $2 and p.workspace_id = $3
         and p.deleted_at is null and m.status in ('ready', 'attached', 'scheduled', 'publishing')`,
      [request.params.projectId, path, requiredWorkspace(request)],
    );
    const asset = result.rows[0];
    if (!asset) return reply.code(404).send({ error: "creative_asset_not_found" });
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: r2Bucket, Key: asset.r2_key }),
      { expiresIn: signedUrlTtlSeconds },
    );
    return {
      path: asset.path,
      name: asset.original_filename,
      mimeType: asset.mime_type,
      size: Number(asset.size_bytes),
      mtime: new Date(asset.modified_at).getTime(),
      url,
    };
  });

  app.delete("/v1/creative-projects/:projectId/assets/file", { preHandler: requireCreativeWrite }, async (request, reply) => {
    const path = String(request.query?.path ?? "");
    if (!validAssetPath(path)) return reply.code(400).send({ error: "invalid_creative_asset_path" });
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const removed = await client.query(
        `delete from creative_project_assets
         where project_id = $1 and (path = $2 or path like $2 || '/%')
         returning media_asset_id`,
        [project.id, path],
      );
      for (const row of removed.rows) {
        await client.query(
          `update media_assets set status = 'ready', purge_after = now(), updated_at = now()
           where id = $1`,
          [row.media_asset_id],
        );
      }
      await client.query("commit");
      return { removed: removed.rowCount };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/v1/creative-projects/:projectId/revisions", { preHandler: requireCreativeRead }, async (request, reply) => {
    const project = await loadProject(postgres, requiredWorkspace(request), request.params.projectId);
    if (!project) return reply.code(404).send({ error: "creative_project_not_found" });
    const result = await postgres.query(
      `select id, revision_number, parent_revision_id, actor_type, message,
              source_hash, compile_status, compile_diagnostics, created_at
       from creative_project_revisions where project_id = $1
       order by revision_number desc limit 100`,
      [project.id],
    );
    return { revisions: result.rows };
  });
}

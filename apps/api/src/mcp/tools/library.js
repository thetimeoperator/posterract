/**
 * The video library (Assets in the app): list videos, upload a new one, or
 * import one from a link. Uploads go straight to storage through the same
 * multipart upload the app uses; nothing streams through the agent's chat.
 */

import { ToolError, UUID } from "../context.js";
import { openDownload } from "../safe-download.js";

const VIDEO_TYPES = { "video/mp4": ".mp4", "video/quicktime": ".mov" };
const TYPE_BY_EXTENSION = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime" };
const PART_BYTES = 16 * 1024 * 1024;
const IMPORT_MAX_BYTES = 1_000_000_000;
const IMPORT_DEADLINE_MS = 4 * 60_000;
const UNATTACHED_NOTE = "Post it within 24 hours: videos that aren't used in a post are cleaned up after a day.";

const describeVideo = (row) => ({
  id: row.id,
  name: row.original_filename,
  status: ["ready", "attached", "scheduled", "publishing"].includes(row.status) ? "ready" : row.status,
  ...(row.duration_ms ? { seconds: Math.round(Number(row.duration_ms) / 100) / 10 } : {}),
  ...(row.width && row.height ? { size: `${row.width}×${row.height}` } : {}),
  megabytes: Math.round(Number(row.size_bytes ?? 0) / 100_000) / 10,
  added: new Date(row.created_at).toISOString(),
});

export const listVideos = {
  name: "list_videos",
  title: "List videos in the library",
  description: "Lists the videos in the user's Posterract library, newest first. Use a video's id with create_post.",
  scopes: ["posts:read", "posts:write", "media:write"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, description: "How many to list. Defaults to 20." },
      search: { type: "string", maxLength: 200, description: "Only videos whose file name contains this text." },
    },
    additionalProperties: false,
  },
  async run(context, args) {
    const result = await context.postgres.query(
      `select id, original_filename, status, duration_ms, width, height, size_bytes, created_at
       from media_assets
       where workspace_id = $1 and purged_at is null
         and status not in ('purged', 'aborted', 'failed', 'uploading')
         and mime_type like 'video/%'
         and ($2::text is null or original_filename ilike '%' || $2 || '%')
       order by created_at desc
       limit $3`,
      [context.workspaceId, args.search ?? null, args.limit ?? 20],
    );
    return { count: result.rows.length, videos: result.rows.map(describeVideo) };
  },
};

function uploadType(fileName, contentType) {
  if (contentType && VIDEO_TYPES[contentType]) return contentType;
  const extension = fileName.split(".").pop()?.toLowerCase();
  const type = TYPE_BY_EXTENSION[extension];
  if (!type) throw new ToolError("Only MP4 and MOV videos can be posted to Instagram, TikTok, Facebook and Threads.");
  return type;
}

export const startVideoUpload = {
  name: "start_video_upload",
  title: "Start uploading a video",
  description:
    "Starts uploading a video file (MP4 or MOV, up to 5 GB) into the library. Returns an upload_url: send the " +
    "whole file to it with one HTTP PUT (no Authorization header), read the ETag header from the response, then " +
    "call finish_video_upload with the upload_id and that ETag.",
  scopes: ["media:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      file_name: { type: "string", minLength: 1, maxLength: 255, description: "e.g. launch-reel.mp4" },
      size_bytes: { type: "integer", minimum: 1, maximum: 5_000_000_000, description: "The file's exact size in bytes." },
      content_type: { type: "string", enum: Object.keys(VIDEO_TYPES), description: "video/mp4 or video/quicktime." },
      duration_seconds: { type: "number", minimum: 0.1, maximum: 7200, description: "The video's length, if known." },
    },
    required: ["file_name", "size_bytes"],
    additionalProperties: false,
  },
  async run(context, args) {
    const contentType = uploadType(args.file_name, args.content_type);
    const started = await context.api("POST", "/v1/uploads/multipart", {
      body: {
        fileName: args.file_name,
        contentType,
        sizeBytes: args.size_bytes,
        ...(args.duration_seconds ? { durationMs: Math.round(args.duration_seconds * 1000) } : {}),
      },
    });
    const { url } = await context.api("POST", `/v1/uploads/multipart/${started.uploadId}/parts/1`);
    return {
      video_id: started.mediaId,
      upload_id: started.uploadId,
      upload_url: url,
      method: "PUT",
      next_step: "PUT the whole file to upload_url within 15 minutes, then call finish_video_upload with upload_id and the ETag response header.",
    };
  },
};

export const finishVideoUpload = {
  name: "finish_video_upload",
  title: "Finish a video upload",
  description: "Finishes an upload started with start_video_upload, once the file has been PUT to its upload_url. Returns the video id to post.",
  scopes: ["media:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      upload_id: { type: "string", minLength: 1, maxLength: 1024 },
      etag: { type: "string", minLength: 1, maxLength: 200, description: "The ETag header returned by the PUT, quotes included." },
    },
    required: ["upload_id", "etag"],
    additionalProperties: false,
  },
  async run(context, args) {
    const done = await context.api("POST", `/v1/uploads/multipart/${encodeURIComponent(args.upload_id)}/complete`, {
      body: { parts: [{ PartNumber: 1, ETag: args.etag }] },
    });
    return { video_id: done.mediaId, status: "ready", note: UNATTACHED_NOTE };
  },
};

export const importVideoFromUrl = {
  name: "import_video_from_url",
  title: "Import a video from a link",
  description:
    "Downloads a video from a public https link (MP4 or MOV, up to 1 GB) into the library and returns its id. " +
    "The link must lead straight to the file. For bigger files, use start_video_upload.",
  scopes: ["media:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", minLength: 8, maxLength: 2048, description: "A direct https link to the video file." },
      file_name: { type: "string", minLength: 1, maxLength: 255, description: "A name for it in the library." },
      duration_seconds: { type: "number", minimum: 0.1, maximum: 7200, description: "The video's length, if known." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async run(context, args) {
    const deadline = Date.now() + IMPORT_DEADLINE_MS;
    const download = await openDownload(args.url, { maxBytes: IMPORT_MAX_BYTES });
    const linkName = decodeURIComponent(download.url.pathname.split("/").pop() || "").slice(0, 200);
    const fileName = (args.file_name ?? linkName) || "imported-video.mp4";
    let contentType;
    try {
      contentType = uploadType(fileName, download.contentType);
    } catch (error) {
      download.response.destroy();
      throw error;
    }
    const started = await context.api("POST", "/v1/uploads/multipart", {
      body: {
        fileName,
        contentType,
        sizeBytes: download.size,
        ...(args.duration_seconds ? { durationMs: Math.round(args.duration_seconds * 1000) } : {}),
      },
    });
    const parts = [];
    try {
      let pending = [];
      let pendingBytes = 0;
      let received = 0;
      const sendPart = async () => {
        const partNumber = parts.length + 1;
        const { url } = await context.api("POST", `/v1/uploads/multipart/${started.uploadId}/parts/${partNumber}`);
        const response = await fetch(url, { method: "PUT", body: Buffer.concat(pending, pendingBytes) });
        const etag = response.headers.get("etag");
        if (!response.ok || !etag) throw new ToolError("Storing the video failed. Try again.");
        parts.push({ PartNumber: partNumber, ETag: etag });
        pending = [];
        pendingBytes = 0;
      };
      for await (const chunk of download.response) {
        if (Date.now() > deadline) throw new ToolError("The download took too long. Use start_video_upload instead.");
        received += chunk.length;
        if (received > download.size) throw new ToolError("The link sent more data than it said it would.");
        pending.push(chunk);
        pendingBytes += chunk.length;
        if (pendingBytes >= PART_BYTES) await sendPart();
      }
      if (pendingBytes > 0) await sendPart();
      if (received !== download.size) throw new ToolError("The download stopped before the whole file arrived.");
      const done = await context.api("POST", `/v1/uploads/multipart/${started.uploadId}/complete`, { body: { parts } });
      return {
        video_id: done.mediaId,
        name: fileName,
        megabytes: Math.round(download.size / 100_000) / 10,
        status: "ready",
        note: UNATTACHED_NOTE,
      };
    } catch (error) {
      download.response.destroy();
      await context.api("DELETE", `/v1/uploads/multipart/${started.uploadId}`).catch(() => undefined);
      throw error instanceof ToolError ? error : new ToolError("Importing the video failed. Try again.");
    }
  },
};

export const LIBRARY_TOOLS = [listVideos, startVideoUpload, finishVideoUpload, importVideoFromUrl];

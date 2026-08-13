import { Uppy } from "@uppy/core";
import AwsS3, { type AwsS3Part } from "@uppy/aws-s3";

export type R2MultipartUploadResult = {
  mediaId: string;
  key: string;
  status: "ready";
};

type UploadOptions = {
  file: File;
  accessToken?: string;
  workspaceId?: string;
  apiBaseUrl?: string;
  meta?: { durationMs?: number; width?: number; height?: number };
  onProgress?: (fraction: number) => void;
};

type MultipartSession = {
  uploadId: string;
  mediaId: string;
  key: string;
};

type UploadBody = Partial<R2MultipartUploadResult> & {
  location?: string;
};

function requiredUploadId(uploadId: string | undefined): string {
  if (!uploadId) throw new Error("Upload session is missing an ID");
  return encodeURIComponent(uploadId);
}

async function apiRequest<T>(
  apiBaseUrl: string,
  accessToken: string | undefined,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { error?: string }
      | undefined;
    throw new Error(payload?.error ?? `Upload API failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Uploads one video directly from the browser to R2. Posterract's API only
 * creates the multipart session and signs each part; video bytes never pass
 * through the VPS.
 */
export async function uploadVideoToR2({
  file,
  accessToken,
  workspaceId,
  apiBaseUrl = "/api",
  meta,
  onProgress,
}: UploadOptions): Promise<R2MultipartUploadResult> {
  let completedUpload: R2MultipartUploadResult | undefined;
  const uppy = new Uppy<Record<string, never>, UploadBody>({
    autoProceed: false,
    allowMultipleUploadBatches: false,
    restrictions: {
      maxNumberOfFiles: 1,
      maxFileSize: 5_000_000_000,
      allowedFileTypes: ["video/mp4", "video/quicktime", "video/webm"],
    },
  });

  uppy.use(AwsS3, {
    shouldUseMultipart: true,
    limit: 4,
    retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
    createMultipartUpload: async (uppyFile) =>
      apiRequest<MultipartSession>(
        apiBaseUrl,
        accessToken,
        "/v1/uploads/multipart",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            fileName: uppyFile.name,
            contentType: uppyFile.type,
            sizeBytes: uppyFile.size,
            durationMs: meta?.durationMs,
            width: meta?.width,
            height: meta?.height,
          }),
        },
      ),
    listParts: async (_uppyFile, { uploadId, signal }) => {
      const result = await apiRequest<{ parts: AwsS3Part[] }>(
        apiBaseUrl,
        accessToken,
        `/v1/uploads/multipart/${requiredUploadId(uploadId)}/parts`,
        { method: "GET", signal },
      );
      return result.parts;
    },
    signPart: async (
      _uppyFile,
      { uploadId, partNumber, signal },
    ) => {
      const result = await apiRequest<{ url: string }>(
        apiBaseUrl,
        accessToken,
        `/v1/uploads/multipart/${requiredUploadId(uploadId)}/parts/${partNumber}`,
        { method: "POST", signal },
      );
      return { method: "PUT" as const, url: result.url };
    },
    abortMultipartUpload: async (_uppyFile, { uploadId, signal }) => {
      await apiRequest<void>(
        apiBaseUrl,
        accessToken,
        `/v1/uploads/multipart/${requiredUploadId(uploadId)}`,
        { method: "DELETE", signal },
      );
    },
    completeMultipartUpload: async (
      _uppyFile,
      { uploadId, parts, signal },
    ) => {
      const normalizedParts = parts.map((part) => ({
        PartNumber: part.PartNumber,
        ETag: part.ETag,
      }));
      completedUpload = await apiRequest<R2MultipartUploadResult>(
        apiBaseUrl,
        accessToken,
        `/v1/uploads/multipart/${requiredUploadId(uploadId)}/complete`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ parts: normalizedParts }),
        },
      );
      return {
        ...completedUpload,
        location: completedUpload.key,
      };
    },
  });

  uppy.on("upload-progress", (_uppyFile, progress) => {
    if (progress.bytesTotal !== null && progress.bytesTotal > 0) {
      onProgress?.(progress.bytesUploaded / progress.bytesTotal);
    }
  });

  try {
    uppy.addFile({
      name: file.name,
      type: file.type,
      data: file,
      source: "posterract-dropzone",
    });
    const result = await uppy.upload();
    if (result?.failed?.length) {
      throw result.failed[0]?.error ?? new Error("Upload failed");
    }
    if (!completedUpload) {
      throw new Error("Upload completed without a media result");
    }
    onProgress?.(1);
    return completedUpload;
  } finally {
    uppy.destroy();
  }
}

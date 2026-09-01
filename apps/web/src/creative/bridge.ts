import { POSTERRACT_STARTER_SOURCE } from "@posterract/video-compiler/starter";
import { uploadCreativeAssetToR2 } from "@/lib/r2MultipartUpload";
import { cloudFetch } from "@/lib/cloudRequest";

type SourceFiles = Record<string, string>;

export type CreativeProject = {
  id: string;
  title: string;
  revisionId: string;
  files: SourceFiles;
  manifest?: unknown;
  createdAt: string;
  updatedAt: string;
};

type BridgeEvent = (channel: string, payload: unknown) => void;

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const LOCAL_KEY = "posterract.creative.projects-v1";
const localAssetFiles = new Map<
  string,
  { blob: Blob; name: string; mimeType: string; mtime: number }
>();

function assetKey(projectId: string, path: string) {
  return `${projectId}:${path}`;
}

function normalizedAssetPath(value: unknown): string {
  const path = String(value ?? "").replace(/^\/+/, "");
  if (!path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid creative asset path");
  }
  return path;
}

function mimeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    json: "application/json", txt: "text/plain", vtt: "text/vtt",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function localAssetEntries(projectId: string, source: string) {
  const prefix = source ? `${source.replace(/^\/+|\/+$/g, "")}/` : "";
  const entries = new Map<string, { name: string; kind: "file" | "directory"; size: number; mtime: number }>();
  for (const [key, file] of localAssetFiles) {
    const path = key.slice(projectId.length + 1);
    if (!key.startsWith(`${projectId}:`) || !path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    const slash = remainder.indexOf("/");
    const name = slash === -1 ? remainder : remainder.slice(0, slash);
    if (slash === -1) entries.set(name, { name, kind: "file", size: file.blob.size, mtime: file.mtime });
    else if (!entries.has(name)) entries.set(name, { name, kind: "directory", size: 0, mtime: file.mtime });
  }
  return [...entries.values()];
}

function projectInfo(project: CreativeProject) {
  return {
    id: project.id,
    name: project.id,
    displayName: project.title,
    dir: project.id,
    entry: "index.tsx",
    modifiedAt: project.updatedAt,
    createdAt: project.createdAt,
  };
}

function readLocalProjects(): CreativeProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as CreativeProject[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeLocalProjects(projects: CreativeProject[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(projects));
}

function createLocalProject(title = "Untitled project"): CreativeProject {
  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    title,
    revisionId: crypto.randomUUID(),
    files: { "index.tsx": POSTERRACT_STARTER_SOURCE },
    createdAt: now,
    updatedAt: now,
  };
  const projects = readLocalProjects();
  writeLocalProjects([project, ...projects]);
  return project;
}

async function apiRequest<T>(path: string, init: RequestInit = {}, accepted = [200]): Promise<T> {
  if (!API_BASE) throw new Error("Posterract API is not configured");
  const response = await cloudFetch(API_BASE, path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!accepted.includes(response.status)) throw new Error(payload.error ?? `Creative API failed (${response.status})`);
  return payload;
}

async function localCompile(files: SourceFiles) {
  const response = await fetch("/__posterract/creative/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files, entryPath: "index.tsx" }),
  });
  const payload = await response.json();
  if (!response.ok && !payload.compilation) throw new Error(payload.error ?? "Local compiler failed");
  return payload as { files: SourceFiles; compilation: { ok: boolean; code?: string; diagnostics: Array<{ message: string; line?: number; column?: number }> } };
}

async function localApply(files: SourceFiles, operations: unknown[]) {
  const response = await fetch("/__posterract/creative/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files, operations, entryPath: "index.tsx" }),
  });
  const payload = await response.json();
  if (!response.ok && !payload.compilation) throw new Error(payload.error ?? "Local source writer failed");
  return payload as {
    files: SourceFiles;
    writeResult: { skipped: string[]; ids?: Record<string, string>; unrolled?: string[]; error?: string };
    compilation: { ok: boolean; code?: string; diagnostics: Array<{ message: string; line?: number; column?: number }> };
  };
}

async function listProjects(): Promise<CreativeProject[]> {
  if (!API_BASE) return readLocalProjects();
  const result = await apiRequest<{ projects: Array<Record<string, unknown>> }>("/v1/creative-projects");
  return result.projects.map((project) => ({
    id: String(project.id),
    title: String(project.title),
    revisionId: String(project.currentRevisionId),
    files: {},
    createdAt: String(project.createdAt),
    updatedAt: String(project.updatedAt),
  }));
}

async function getProject(id: string): Promise<CreativeProject | null> {
  if (!API_BASE) return readLocalProjects().find((project) => project.id === id) ?? null;
  try {
    const result = await apiRequest<{ project: Record<string, unknown>; files: SourceFiles }>(`/v1/creative-projects/${id}`);
    return {
      id: String(result.project.id),
      title: String(result.project.title),
      revisionId: String(result.project.currentRevisionId),
      files: result.files,
      createdAt: String(result.project.createdAt),
      updatedAt: String(result.project.updatedAt),
    };
  } catch {
    return null;
  }
}

async function createProject(title = "Untitled project"): Promise<CreativeProject> {
  if (!API_BASE) return createLocalProject(title);
  const result = await apiRequest<{
    project: Record<string, unknown>;
    revision: { id: string };
  }>("/v1/creative-projects", { method: "POST", body: JSON.stringify({ title }) }, [201]);
  return (await getProject(String(result.project.id)))!;
}

function saveLocalProject(next: CreativeProject) {
  writeLocalProjects([next, ...readLocalProjects().filter((project) => project.id !== next.id)]);
}

export async function ensureCreativeProject(preferredId?: string): Promise<CreativeProject> {
  if (preferredId) {
    const preferred = await getProject(preferredId);
    if (preferred) return preferred;
  }
  const existing = await listProjects();
  if (existing[0]) return (await getProject(existing[0].id)) ?? existing[0];
  return createProject("Posterract creative");
}

export async function handleCreativeBridgeRequest(
  channel: string,
  data: Record<string, unknown> | undefined,
  emit: BridgeEvent,
): Promise<unknown> {
  const dir = String(data?.dir ?? data?.ref ?? "");

  if (channel === "window:is-fullscreen") return false;
  if (channel === "headless:get-mode") return false;
  if (channel === "logs:get") return [];
  if (channel === "projects:default-root" || channel === "projects:pick-root") return "/posterract";
  if (channel === "projects:watch" || channel === "projects:unwatch") return undefined;
  if (channel === "projects:config-write") return undefined;
  if (channel === "projects:config-read") return null;

  if (channel === "projects:list") return (await listProjects()).map(projectInfo);
  if (channel === "projects:create") return projectInfo(await createProject(String(data?.displayName ?? "Untitled project")));
  if (channel === "projects:get" || channel === "projects:resolve") {
    const project = await getProject(dir);
    return project ? projectInfo(project) : null;
  }
  if (channel === "projects:rename") {
    const project = await getProject(dir);
    if (!project) throw new Error("Project not found");
    const title = String(data?.displayName ?? "").trim();
    if (API_BASE) {
      await apiRequest(`/v1/creative-projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    } else {
      saveLocalProject({ ...project, title, updatedAt: new Date().toISOString() });
    }
    return projectInfo((await getProject(project.id))!);
  }

  const project = await getProject(dir);
  if (!project) throw new Error("Project not found");

  if (channel === "projects:manifest-read") {
    if (!API_BASE) return project.manifest ?? { version: 1, folders: [], assets: [] };
    const result = await apiRequest<{ manifest: unknown }>(`/v1/creative-projects/${project.id}/assets/manifest`);
    return result.manifest;
  }

  if (channel === "projects:manifest-write") {
    const manifest = data?.manifest;
    if (API_BASE) {
      await apiRequest(`/v1/creative-projects/${project.id}/assets/manifest`, {
        method: "PUT",
        body: JSON.stringify({ manifest }),
      });
    } else {
      saveLocalProject({ ...project, manifest, updatedAt: new Date().toISOString() });
    }
    return undefined;
  }

  if (channel === "projects:fs-list") {
    const source = String(data?.source ?? "").replace(/^\/+|\/+$/g, "");
    if (!API_BASE) return localAssetEntries(project.id, source);
    const result = await apiRequest<{ entries: unknown[] }>(
      `/v1/creative-projects/${project.id}/assets/list?source=${encodeURIComponent(source)}`,
    );
    return result.entries;
  }

  if (channel === "projects:fs-stat") {
    const path = normalizedAssetPath(data?.source);
    if (!API_BASE) {
      const file = localAssetFiles.get(assetKey(project.id, path));
      return file ? { size: file.blob.size, mtime: file.mtime } : null;
    }
    const result = await apiRequest<{ entries: Array<{ name: string; kind: string; size: number; mtime: number }> }>(
      `/v1/creative-projects/${project.id}/assets/list?source=${encodeURIComponent(path.slice(0, path.lastIndexOf("/")))}`,
    );
    const name = path.split("/").pop();
    const file = result.entries.find((entry) => entry.kind === "file" && entry.name === name);
    return file ? { size: file.size, mtime: file.mtime } : null;
  }

  if (channel === "projects:fs-file") {
    const path = normalizedAssetPath(data?.source);
    if (!API_BASE) {
      const file = localAssetFiles.get(assetKey(project.id, path));
      if (!file) throw new Error("Creative asset not found");
      return { ...file, blob: file.blob };
    }
    return apiRequest(`/v1/creative-projects/${project.id}/assets/file?path=${encodeURIComponent(path)}`);
  }

  if (channel === "projects:fs-write") {
    const path = normalizedAssetPath(data?.path);
    const blob = data?.blob;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Creative asset is empty");
    const name = path.split("/").pop() ?? "asset";
    const mimeType = blob.type || mimeFromPath(path);
    if (!API_BASE) {
      localAssetFiles.set(assetKey(project.id, path), { blob, name, mimeType, mtime: Date.now() });
    } else {
      await uploadCreativeAssetToR2({
        file: new File([blob], name, { type: mimeType }),
        projectId: project.id,
        path,
        apiBaseUrl: API_BASE,
      });
    }
    return undefined;
  }

  if (channel === "projects:fs-remove") {
    const path = normalizedAssetPath(data?.path);
    if (API_BASE) {
      await apiRequest(`/v1/creative-projects/${project.id}/assets/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    } else {
      for (const key of [...localAssetFiles.keys()]) {
        if (key === assetKey(project.id, path) || key.startsWith(`${assetKey(project.id, path)}/`)) localAssetFiles.delete(key);
      }
    }
    return undefined;
  }

  if (channel === "projects:fs-real-path") return String(data?.source ?? "");

  if (channel === "projects:compile") {
    const result = API_BASE
      ? await apiRequest<{ ok: boolean; code?: string; diagnostics: Array<{ message: string }> }>(
          `/v1/creative-projects/${project.id}/compile`,
          { method: "POST", body: JSON.stringify({ revisionId: project.revisionId }) },
          [200, 422],
        )
      : (await localCompile(project.files)).compilation;
    return result.ok ? { ok: true, code: result.code } : { ok: false, error: result.diagnostics.map((item) => item.message).join("\n") };
  }

  if (channel === "projects:write") {
    const operations = (data?.edits as unknown[]) ?? [];
    if (API_BASE) {
      const result = await apiRequest<{
        revision: { id: string };
        writeResult: { skipped: string[]; ids?: Record<string, string>; unrolled?: string[]; error?: string };
        files: SourceFiles;
      }>(
        `/v1/creative-projects/${project.id}/operations`,
        {
          method: "POST",
          body: JSON.stringify({
            baseRevisionId: project.revisionId,
            batchId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            operations,
          }),
        },
        [200, 422],
      );
      emit("projects:source-changed", { dir: project.id, path: "index.tsx", revisionId: result.revision.id });
      return result.writeResult;
    }
    const result = await localApply(project.files, operations);
    const next = { ...project, files: result.files, revisionId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    saveLocalProject(next);
    emit("projects:source-changed", { dir: project.id, path: "index.tsx", revisionId: next.revisionId });
    return result.writeResult;
  }

  if (channel === "projects:source-read") {
    const path = String(data?.path ?? "index.tsx");
    return { path, content: project.files[path] ?? "", revisionId: project.revisionId };
  }

  if (channel === "projects:source-write") {
    const path = String(data?.path ?? "index.tsx");
    const content = String(data?.content ?? "");
    const expectedRevisionId = String(data?.expectedRevisionId ?? "");
    if (expectedRevisionId !== project.revisionId) throw new Error("Project changed while this source file was open");
    if (API_BASE) {
      const result = await apiRequest<{
        revision: { id: string };
        compilation: { diagnostics: Array<{ message: string; line?: number; column?: number }> };
      }>(
        `/v1/creative-projects/${project.id}/files`,
        { method: "PUT", body: JSON.stringify({ path, content, expectedRevisionId }) },
        [200, 422],
      );
      emit("projects:changed", { dir: project.id, path });
      return { revisionId: result.revision.id, content, diagnostics: result.compilation.diagnostics };
    }
    const compiled = await localCompile({ ...project.files, [path]: content });
    const next = {
      ...project,
      files: compiled.files,
      revisionId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    saveLocalProject(next);
    emit("projects:changed", { dir: project.id, path });
    return {
      revisionId: next.revisionId,
      content: next.files[path] ?? content,
      diagnostics: compiled.compilation.diagnostics,
    };
  }

  throw new Error(`Unsupported editor bridge channel: ${channel}`);
}

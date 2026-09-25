/**
 * Where the author is looking, kept beside the project instead of inside it.
 *
 * Selection, the active scene, the workspace camera and the timeline's row
 * state used to be attributes in the project's TSX. That made every click a
 * revision of the document: the file was rewritten, its revision id moved, and
 * the source history filled with snapshots that differed by one `selected`.
 * With a second author on the same file — an agent — that is worse than noise:
 * a conflict check keyed on the revision fires because someone looked around.
 *
 * So the TSX holds the video and this file holds the view. It lives under
 * `.posterract/`, which the project watcher ignores, so writing it never
 * reloads the canvas; and it is plain JSON, so an agent can read what the
 * author is pointing at without a bridge. Elements are named by their source
 * stamp (`file:id`), the same name the undo history uses.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const VIEW_STATE_FILE = ".posterract/view.json";
const VIEW_STATE_VERSION = 1;
const MAX_VIEW_STATE_BYTES = 1_000_000;
const MAX_SOURCES = 5_000;
const MAX_SOURCE_LENGTH = 512;

export type ViewState = {
  version: 1;
  /** The workspace camera as a 2D affine matrix, or null for "fit". */
  camera: number[] | null;
  /** The scene the timeline is pointed at. */
  active: string | null;
  selected: string[];
  /** Timeline rows showing their keyframe rows. */
  expanded: string[];
  /** Timeline row heights, px, for rows that are not the common height. */
  clipHeight: Record<string, number>;
  /** Commands typed or said to the voice bar, newest last: what ↑ walks back through. */
  voice?: string[];
};

/** How much of the voice bar's history is kept, and how long one command may be. */
const MAX_VOICE_ENTRIES = 50;
const MAX_VOICE_LENGTH = 300;

/** What a source may still carry (see the writer's `SourceViewState`). */
export type LiftedViewState = {
  camera?: number[];
  active?: string;
  selected: string[];
  expanded: string[];
  clipHeight: Record<string, number>;
};

const isSource = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_SOURCE_LENGTH;

function sources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSource))].slice(0, MAX_SOURCES);
}

/**
 * The view state in `value`, or null when it is not one. Lenient about what is
 * missing and strict about what is present: this file is written by the app
 * but lives in a folder an agent can write to, and whatever it says is applied
 * to the canvas.
 */
export function sanitizeViewState(value: unknown): ViewState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  const camera = Array.isArray(input.camera)
    && input.camera.length === 6
    && input.camera.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? (input.camera as number[])
    : null;

  const clipHeight: Record<string, number> = {};
  if (input.clipHeight && typeof input.clipHeight === "object" && !Array.isArray(input.clipHeight)) {
    for (const [source, height] of Object.entries(input.clipHeight as Record<string, unknown>).slice(0, MAX_SOURCES)) {
      if (isSource(source) && typeof height === "number" && Number.isFinite(height) && height > 0) {
        clipHeight[source] = height;
      }
    }
  }

  const voice = Array.isArray(input.voice)
    ? input.voice
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= MAX_VOICE_LENGTH)
      .slice(-MAX_VOICE_ENTRIES)
    : [];

  return {
    version: VIEW_STATE_VERSION,
    camera,
    active: isSource(input.active) ? input.active : null,
    selected: sources(input.selected),
    expanded: sources(input.expanded),
    clipHeight,
    ...(voice.length ? { voice } : {}),
  };
}

export async function readViewStateFile(projectDir: string): Promise<ViewState | null> {
  try {
    const path = join(projectDir, VIEW_STATE_FILE);
    if ((await stat(path)).size > MAX_VIEW_STATE_BYTES) return null;
    return sanitizeViewState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

export async function writeViewStateFile(projectDir: string, value: unknown): Promise<void> {
  const view = sanitizeViewState(value);
  if (!view) throw new Error("Not a view state");
  const path = join(projectDir, VIEW_STATE_FILE);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(view, null, 2)}\n`);
  await rename(temporary, path);
}

/**
 * Carries the view state an older source held over to the sidecar, once. A
 * project that already has a sidecar keeps it: what the file said was written
 * before the sidecar existed and is older than anything in it.
 */
export async function seedViewStateFile(projectDir: string, lifted: LiftedViewState): Promise<boolean> {
  try {
    await stat(join(projectDir, VIEW_STATE_FILE));
    return false;
  } catch {
    // No sidecar yet: this is the first open since the view left the source.
  }
  await writeViewStateFile(projectDir, {
    camera: lifted.camera ?? null,
    active: lifted.active ?? null,
    selected: lifted.selected,
    expanded: lifted.expanded,
    clipHeight: lifted.clipHeight,
  });
  return true;
}

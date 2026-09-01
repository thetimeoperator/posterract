# Posterract Agent-Native Video Editor Master Plan

> Superseded for the Create/editor hosting architecture on 2026-08-29 by
> `docs/posterract-desktop-cloud-master-plan.md`. This document remains the
> historical browser-first plan and a reference for the compiler, runtime,
> rendering, storage, and agent research that is still reusable. New Create
> implementation decisions must follow the desktop-local/cloud-control-plane
> plan.

Status: architecture and implementation plan  
Date: 2026-08-28  
Scope: Posterract Create page, agent editing, browser preview/export, VPS rendering, PostgreSQL, Cloudflare R2, Redis, Temporal, and Composer handoff

## 1. Executive decision

Posterract should build a cloud-hosted, agent-native video editor using this combined model:

- Take Diffusion Studio's defining idea: the project source code is the editable document. A human visual edit writes back into the source, and an agent source edit redraws the visual editor.
- Take MakeAIUGCVids' best operating model: browser rendering for immediate human exports, temporary VPS workspaces for hosted agent renders, Cloudflare R2 for durable media, and a metadata database for durable application state.
- Replace Diffusion Studio's local filesystem project folder with a Posterract virtual project filesystem stored in PostgreSQL.
- Replace MakeAIUGCVids' Convex metadata database with Posterract's existing PostgreSQL database.
- Keep Cloudflare R2 as the binary object store. PostgreSQL must never contain video, audio, image, thumbnail, waveform, proxy, or rendered-output bytes.
- Keep the current Posterract Composer and publishing pipeline. The Create editor produces a render; the user or agent sends that render to Composer; Composer handles captions, destinations, scheduling, publishing, and post-publish cleanup.
- Expose the editor to external user agents through Posterract's authenticated HTTP API and a hosted MCP server. Posterract does not need to host an LLM to make the editing workflow durable.
- Run authored project code only inside an isolated editor sandbox and an isolated render worker. It must never execute in the authenticated Posterract application page or API process.

The canonical source of truth for a creative project will be versioned TSX files. PostgreSQL will also store derived operation records, compile diagnostics, asset references, and immutable revisions. The visual document tree and compiled JavaScript bundle are derived data, not competing sources of truth.

## 2. What was learned from the two source products

### 2.1 Diffusion Studio: the behavior to reproduce

Diffusion Studio's essential round trip is:

```text
TSX project files
    -> source stamping and compilation
    -> compiled bundle
    -> Solid universal reconciler
    -> Koota ECS entities
    -> Canvas preview, timeline, inspector
    -> semantic visual edit
    -> TSX AST writer
    -> updated TSX project files
```

Important implementation characteristics:

1. A project is a folder containing an entry TSX file, package metadata, an asset manifest, generated assets, and disposable caches.
2. Every composition element receives a durable `id`.
3. The compiler injects a source locator into every composition node before the Solid transform replaces the JSX tree.
4. The compiled project mounts into a headless ECS runtime. Video nodes, text nodes, images, shapes, timing, transforms, animation, and relationships become first-class engine entities.
5. Visual edits emit semantic operations such as `set`, `insert`, `move`, `remove`, `text`, and `unroll`.
6. Edits are debounced so a drag becomes one source write instead of hundreds.
7. A TypeScript AST writer changes the JSX that authored the selected entity.
8. When hand-edited code fails to compile, the last successfully mounted render remains visible.
9. Export remounts the project into a fresh capture world and renders it frame by frame. It does not record the interactive preview canvas.
10. The agent edits files directly and uses the `dapi` CLI for context, media inspection, validation, frame capture, screenshots, and logs.

Relevant upstream sources:

- Repository and composition model: https://github.com/diffusionstudio/editor
- Desktop compiler and project host: `apps/desktop/src/projects.ts`
- Source locator transform: `apps/desktop/src/source.ts`
- TSX source writer: `apps/desktop/src/edit.ts`
- Editor mount and write-back: `apps/web/src/pages/editor.tsx`
- Semantic edit batching: `apps/web/src/projects/edits.ts`
- Runtime and ECS: `packages/runtime`
- JSX-to-runtime reconciliation: `packages/reconciler`
- Asset manifest and cache: `packages/assets`
- Offline encoder: `packages/encoder`
- Agent-facing CLI: `apps/cli`

### 2.2 Diffusion Studio: what cannot be copied literally

Its canonical project storage is local disk. That is appropriate for a desktop editor but not for a hosted Posterract Create page.

- The desktop Electron process performs file discovery, compilation, AST writes, file watching, local imports, and folder operations.
- Local media can be referenced by absolute path without being copied.
- Generated media is stored inside the project folder.
- IndexedDB remembers project roots and the last good compiled bundle; it is not the canonical project store.
- The browser project host in the examined source explicitly depends on the Electron bridge for normal project operations.
- The bundle evaluator uses dynamic JavaScript execution. That cannot share an origin or privilege boundary with authenticated Posterract application code.

Posterract therefore needs cloud equivalents for the project filesystem, watcher, compiler, asset resolver, and agent CLI.

### 2.3 MakeAIUGCVids: the storage and rendering model to preserve

MakeAIUGCVids used four storage layers:

1. Convex Cloud held users, credits, avatars, brands, prompts, generation metadata, reusable content records, agent flow definitions, durable agent jobs, export metadata, URLs, and R2 keys.
2. Cloudflare R2 held generated avatar images, generated clip blocks, uploaded product photos, uploaded avatar photos, static preset media, and hosted-agent finished MP4 files.
3. Browser state held the active editor draft, local file objects, object URLs, playback state, and client render state.
4. A temporary VPS workspace held intermediate agent-render files. The worker uploaded the final MP4 to R2 and deleted the temporary workspace.

The browser-created UGC export path rendered with browser media technology, downloaded the final MP4 to the user's device, and recorded only export metadata/statistics in Convex. It deliberately did not upload the browser-created finished MP4.

The hosted-agent path rendered on the VPS, uploaded the result to an R2 key such as:

```text
users/{userId}/agent-videos/{runId}.mp4
```

and stored the result URL and key in Convex.

Important defect to avoid: the finished-video expiry job removed the Convex export record after 30 days but did not delete the matching R2 object. Posterract's cleanup must be an object-deletion workflow with retryable tombstones, not a database-only expiry.

### 2.4 Current Posterract capabilities to reuse

Posterract already has most of the infrastructure needed around the editor:

- React 19 and TanStack Router web application.
- Fastify API.
- PostgreSQL 17 as product source of truth.
- Cloudflare R2 private bucket support.
- Uppy direct multipart browser-to-R2 uploads.
- Redis for temporary upload sessions and operational state.
- Temporal for durable asynchronous workflows.
- A Temporal worker already responsible for social publishing.
- An API-key system with hashed bearer keys and granular scopes.
- A documented external agent API.
- A `media_assets` publishing model.
- A Composer route that attaches media to captions, destinations, and schedules.
- A working post-publish media retention mechanism.
- Elasticsearch, which can later index transcripts and creative assets but is not required for the editor's correctness.

The editor should extend those primitives instead of creating a second backend.

## 3. Product definition

### 3.1 User promise

A Posterract user can:

1. Start from an empty project, a Posterract content format, an uploaded video, a Google Drive item, a previous project, or an agent-created project.
2. Edit visually through a canvas, asset library, layer tree, inspector, and timeline.
3. Open the project's code and see the same composition represented as TSX.
4. Change the TSX and see the visual editor redraw.
5. Drag, trim, type, resize, animate, or reorder visually and see the TSX update.
6. Give a Posterract API key to their agent and ask the agent to create or edit the same project.
7. Watch agent revisions appear inside the open editor without refreshing.
8. Let the agent inspect source footage, transcripts, filmstrips, waveforms, and rendered preview frames.
9. Render locally for immediate download or render durably on Posterract for agent and scheduled workflows.
10. Send the finished video to the existing Composer and publish it through Posterract.

### 3.2 Non-goals for the first release

The first release should not attempt all of these simultaneously:

- Full Adobe Premiere or DaVinci Resolve feature parity.
- Arbitrary npm installation by customers.
- Unrestricted browser or Node.js code execution.
- Multi-user real-time cursor collaboration.
- Unlimited project storage.
- GPU render-farm orchestration.
- Every possible video codec as an editing source.
- A hosted autonomous LLM owned by Posterract.
- A general-purpose 3D game engine.

The first release should be outstanding for short-form social video: 9:16, 1:1, 4:5, and 16:9 compositions; video, image, audio, text, captions, shapes, animation, transitions, effects, and template-driven editing.

## 4. Target system architecture

```text
                                  +-----------------------------+
                                  | User's external agent       |
                                  | Codex / Claude / ChatGPT    |
                                  +--------------+--------------+
                                                 |
                                      API key / hosted MCP
                                                 |
+-----------------------+             +----------v-----------+
| Posterract React app  | REST + SSE  | Posterract API       |
| /create/:projectId    +------------>+ projects / files     |
| canvas / timeline     |             | assets / renders     |
| inspector / code      |             | compiler coordinator |
+-----------+-----------+             +----+----------+-------+
            |                              |          |
   postMessage/capability                  |          |
            |                              |          |
+-----------v-----------+            +-----v---+  +---v----------------+
| Isolated preview      |            | Redis   |  | PostgreSQL         |
| sandbox origin        |            | cache   |  | source/revisions   |
| compiled bundle       |            | locks   |  | metadata/jobs      |
| ECS runtime/canvas    |            +---------+  +--------------------+
+-----------+-----------+
            |
     signed asset URLs                  +------------------------------+
            +-------------------------->+ Cloudflare R2 private bucket |
                                       | originals/proxies/renders    |
                                       +---------------+--------------+
                                                       |
                                               Temporal workflows
                                                       |
                                       +---------------v--------------+
                                       | Isolated render worker        |
                                       | Chromium + encoder + ffmpeg   |
                                       | temporary workspace only      |
                                       +---------------+--------------+
                                                       |
                                           final publishing artifact
                                                       |
                                       +---------------v--------------+
                                       | Existing Posterract Composer  |
                                       | schedule/publish/analytics    |
                                       +------------------------------+
```

### 4.1 Storage responsibility matrix

| Data | Canonical location | Cached/derived location | Retention owner |
|---|---|---|---|
| Project TSX/JSON/Markdown | PostgreSQL revisions | Browser IndexedDB | Creative project service |
| Current compiled bundle | R2 by source hash + PostgreSQL pointer | Redis and IndexedDB | Compiler/creative cleanup |
| Original uploaded media | Private R2 | None | Creative asset service |
| Editor proxy | Private R2 | Browser Cache/IndexedDB | Creative asset service |
| Thumbnail/filmstrip/waveform | Private R2 | Browser Cache/IndexedDB | Creative asset service |
| External Drive locator | PostgreSQL, encrypted where sensitive | None | External-source connector |
| Temporary external materialization | Private R2 | Render temp directory | Creative asset cleanup |
| Browser-only final export | User's device | Browser memory during export | User/browser |
| Hosted preview/capture | Private R2 | Browser cache | Preview cleanup |
| Hosted final render | Private R2 | Render temp directory until upload | Creative output service |
| Composer/publishing artifact | Existing `media_assets` + R2 key | Provider upload session | Publishing pipeline |
| Multipart session | Redis | R2 incomplete parts | Upload service/lifecycle rule |
| Render/compile workflow history | PostgreSQL + Temporal history | Redis progress projection | Workflow/domain service |

PostgreSQL stores text and metadata. R2 stores bytes. Redis stores disposable operational state. Temporal stores durable execution history. The browser stores disposable acceleration data and any intentionally local-only export.

### 4.2 Human visual-edit and local-export sequence

```text
1. User opens /create/:projectId.
2. Web app fetches current revision, last-good bundle, and asset metadata.
3. Browser cache supplies any still-valid proxies/derived data.
4. Sandbox mounts the bundle and resolves asset IDs to short-lived URLs.
5. User drags/trims/types.
6. Sandbox updates live ECS immediately and emits one semantic operation batch.
7. API applies that batch to TSX and commits a PostgreSQL revision.
8. Compiler produces a new bundle and last-good pointer.
9. SSE confirms revision to the web app.
10. User selects Export to device.
11. Browser remounts the committed revision into a fresh capture world.
12. Browser encoder downloads required source assets/proxies and creates the MP4.
13. Browser downloads the MP4 to the user's device.
14. No final MP4 is written to R2 unless the user explicitly asks to save or publish it.
```

This preserves MakeAIUGCVids' lowest-cost export behavior.

### 4.3 Human cloud-render and Composer sequence

```text
1. User selects Render for Posterract.
2. API creates a render job pinned to an immutable revision.
3. Temporal resolves every referenced asset and starts the isolated render worker.
4. Worker renders into a temporary workspace.
5. Worker uploads final MP4 to a scoped R2 output key.
6. API verifies the result and creates a creative output record.
7. Worker deletes its temporary workspace.
8. User selects Send to Composer.
9. Posterract creates/links an existing media_assets publishing artifact.
10. Composer handles caption, destinations, schedule, and platform options.
11. Publishing pipeline keeps the object while any projection needs it.
12. Terminal post state starts the existing safety-window cleanup.
```

### 4.4 External-agent sequence

```text
1. User gives their agent a scoped Posterract API key or connects hosted MCP.
2. Agent creates or opens a project and reads its revision/source context.
3. Agent uploads local media through the multipart helper or chooses existing assets.
4. Agent probes/transcribes/grabs frames from source media.
5. Agent edits TSX with expectedRevisionId.
6. Posterract commits and compiles the revision.
7. Agent reads diagnostics and captures representative frames.
8. Agent iterates until validation succeeds.
9. Agent starts a hosted render and may disconnect.
10. Temporal and the render worker complete independently.
11. Agent later reads render status and output ID.
12. If its key includes posts:write, it may create a Composer/post handoff; otherwise the user reviews it.
```

### 4.5 Reopen-after-publish sequence

The result depends on the project's declared retention policy:

- `persistent`: source and media reopen normally.
- `external_backed`: Posterract refreshes the provider locator and rematerializes missing media/proxies.
- `temporary` inside its safety window: source and media reopen normally.
- `temporary` after cleanup: source code/history reopen, missing asset nodes are clearly marked, and the user is offered relink/import actions. Posterract must never pretend the project is fully editable after its source bytes were intentionally deleted.

## 5. Canonical project model: code is the document

### 5.1 Virtual project filesystem

Every creative project exposes a virtual folder to humans and agents:

```text
project/
├── index.tsx
├── components/
│   ├── Hook.tsx
│   └── CaptionStyle.tsx
├── data/
│   └── script.json
├── project.json
└── README.md
```

These are not literal files on the API container's persistent disk. They are versioned text records in PostgreSQL. A render worker materializes an immutable revision into a temporary workspace only for compilation/rendering and deletes the workspace afterward.

Recommended v1 rules:

- Entry file is `index.tsx`.
- File names are normalized project-relative POSIX paths.
- No `..`, absolute paths, symlinks, executable files, or hidden secrets.
- Maximum 100 source files per project for v1.
- Maximum 1 MiB per text file and 5 MiB total source text per project.
- JSON and Markdown files are allowed as non-executable project resources.
- Binary assets never enter the virtual source filesystem. They are referenced by immutable Posterract asset IDs.

### 5.2 Composition vocabulary

The v1 authoring API should include:

```text
stage
scene
sequence
group
video
audio
image
text
captions
shape
rect
ellipse
line
gradient
transition
animation
keyframes
effect
mask
```

Each editable element requires a stable `id`:

```tsx
export default function Project() {
  return (
    <stage id="stage" width={1080} height={1920} fps={30}>
      <scene id="main" start={0} end={15} fill="#000000">
        <video
          id="hero-video"
          asset="asset_01J..."
          start={0}
          end={15}
          width={1080}
          height={1920}
          fit="cover"
        />
        <text
          id="hook"
          start={0}
          end={3}
          x={80}
          y={140}
          width={920}
          fontSize={88}
          color="#FFFFFF"
        >
          Stop wasting your best content.
        </text>
      </scene>
    </stage>
  );
}
```

IDs must remain stable across source rewrites, visual edits, agent edits, browser remounts, and server renders.

### 5.3 Allowed imports

V1 should use an explicit module allowlist:

- `@posterract/video`
- `@posterract/video/motion`
- A controlled subset of `solid-js` if the Diffusion reconciler is retained
- Approved Posterract effect packages
- Approved Posterract template packages

Do not permit arbitrary package installation or network imports in customer projects. New packages enter the allowlist only after compatibility and security testing.

### 5.4 Source stamping

The compiler must attach an internal source locator to every editable composition element. The locator should contain:

- Project file path
- Stable element ID
- Optional loop/template origin
- Compiler/runtime schema version

The stable ID is the primary address. Source position is diagnostic fallback, not the durable identity, because line numbers and AST indexes move.

### 5.5 Visual edit operation contract

Use one operation language everywhere:

```ts
type CreativeOperation =
  | { op: "set"; nodeId: string; props: Record<string, PropValue> }
  | { op: "setText"; nodeId: string; text: string }
  | { op: "insert"; parentId: string; beforeId?: string; node: CreativeNodeInput }
  | { op: "move"; nodeId: string; parentId: string; beforeId?: string }
  | { op: "remove"; nodeId: string }
  | { op: "split"; nodeId: string; at: number }
  | { op: "trim"; nodeId: string; start?: number; end?: number; sourceIn?: number; sourceOut?: number }
  | { op: "replaceAsset"; nodeId: string; assetId: string }
  | { op: "unroll"; sourceId: string; iterationIds: string[] };
```

Rules:

- A visual drag updates the live ECS immediately for responsive interaction.
- The UI groups intermediate pointer updates into one final semantic operation.
- Operations are sent with `baseRevisionId`, `batchId`, and an idempotency key.
- The source writer applies operations to an in-memory TypeScript AST.
- The writer formats only affected nodes or uses a stable project formatter.
- A successful transaction creates a new immutable source revision.
- The server returns the committed revision, changed files, canonical source, and diagnostics.
- If the operation cannot be written safely, the server rejects it and the UI reconciles to the last committed revision.

### 5.6 Hand-written code changes

The code editor workflow differs from a visual operation:

1. User edits one or more virtual files.
2. The browser saves a draft revision after a short debounce or explicit save.
3. Compiler validates imports, syntax, composition root, IDs, asset references, and resource limits.
4. If compilation succeeds, `last_good_revision_id` advances and the sandbox mounts the new bundle.
5. If compilation fails, `current_revision_id` still points to the user's latest source, but the canvas keeps displaying `last_good_revision_id`.
6. Diagnostics identify file, line, column, severity, error code, and suggested correction.

This preserves the user's code instead of discarding an invalid edit while keeping the visual editor usable.

### 5.7 Loops and dynamic elements

Dynamic JSX is powerful but complicates write-back. V1 policy:

- Permit deterministic arrays, maps, conditionals, and approved reactive helpers.
- Require each rendered editable node to have a stable ID.
- When one visually rendered iteration must diverge from its source loop, use an explicit `unroll` operation that replaces the loop with literal JSX nodes.
- Refuse visual edits to nodes that do not have a stable writable source origin.
- Display a clear UI state: `Generated by loop — detach this item to edit individually`.

### 5.8 Revision and concurrency model

Every write uses optimistic concurrency:

```text
client base revision 41
server current revision 41 -> accept -> revision 42
server current revision 43 -> return 409 with current revision and changed files
```

For v1:

- Do not silently merge simultaneous edits to the same source file.
- Auto-rebase disjoint visual operations only when the addressed node IDs and properties did not change.
- Code edits that conflict require the human or agent to fetch the latest revision and reapply.
- An open editor receives project revision events over SSE.
- Undo creates a new revision that restores the selected prior state; it does not mutate history.
- Every revision records whether the actor was a user, API key, MCP client, template, migration, or system process.

## 6. PostgreSQL data model

The final SQL must follow the repository's versioned migration conventions. The following is the target logical schema.

### 6.1 `creative_projects`

```text
id                         uuid primary key
workspace_id               uuid not null -> workspaces
title                      text not null
description                text
status                     draft | rendering | ready | archived | deleting | deleted
entry_path                 text not null default 'index.tsx'
width                      integer not null
height                     integer not null
frame_rate                 numeric not null
default_duration_ms        integer
retention_policy           temporary | external_backed | persistent
current_revision_id        uuid nullable
last_good_revision_id      uuid nullable
latest_output_id           uuid nullable
created_by_user_id         text/uuid nullable
created_by_api_key_id      uuid nullable
created_at                 timestamptz not null
updated_at                 timestamptz not null
last_opened_at             timestamptz
archived_at                timestamptz
deleted_at                 timestamptz
purge_after                timestamptz
```

Indexes:

- `(workspace_id, updated_at desc)`
- `(workspace_id, status)`
- `(purge_after) where purge_after is not null and deleted_at is null`

### 6.2 `creative_project_revisions`

```text
id                         uuid primary key
project_id                 uuid not null -> creative_projects
revision_number            bigint not null
parent_revision_id         uuid nullable
actor_type                 user | agent_api_key | mcp | template | system
actor_user_id              text/uuid nullable
actor_api_key_id           uuid nullable
message                    text
source_hash                text not null
compile_status             pending | compiling | succeeded | failed
compile_diagnostics        jsonb not null default '[]'
runtime_version            text not null
compiled_bundle_r2_key     text nullable
compiled_bundle_hash       text nullable
document_summary           jsonb nullable
created_at                 timestamptz not null
```

Constraints and indexes:

- Unique `(project_id, revision_number)`
- Index `(project_id, created_at desc)`
- Index `(project_id, compile_status)`
- `source_hash` covers ordered file paths and contents

### 6.3 `creative_project_revision_files`

```text
revision_id                uuid not null -> creative_project_revisions
path                       text not null
content                    text not null
content_hash               text not null
language                   tsx | ts | json | md
size_bytes                 integer not null
primary key (revision_id, path)
```

V1 stores complete text snapshots because composition source is small and snapshot reads are reliable. Content-addressed source-blob deduplication can be introduced later if revision volume justifies it.

### 6.4 `creative_operations`

```text
id                         uuid primary key
project_id                 uuid not null
base_revision_id           uuid not null
committed_revision_id      uuid nullable
batch_id                   uuid not null
idempotency_key            text not null
actor_type                 user | agent_api_key | mcp | system
actor_user_id              text/uuid nullable
actor_api_key_id           uuid nullable
operations                 jsonb not null
status                     accepted | committed | conflicted | rejected
error_code                 text nullable
error_detail               jsonb nullable
created_at                 timestamptz not null
committed_at               timestamptz nullable
```

Unique `(project_id, idempotency_key)` prevents replay from duplicating changes.

### 6.5 `creative_assets`

```text
id                         uuid primary key
workspace_id               uuid not null
source_kind                upload | agent_upload | drive | generation | template | premium
status                     uploading | uploaded | processing | ready | failed | purge_pending | purged
original_filename          text
mime_type                  text not null
size_bytes                 bigint
duration_ms                integer
width                      integer
height                     integer
frame_rate                 numeric
audio_channels             integer
content_hash               text nullable
r2_original_key            text nullable
r2_proxy_key               text nullable
r2_thumbnail_key           text nullable
r2_filmstrip_key           text nullable
r2_waveform_key            text nullable
external_provider          text nullable
external_locator_ciphertext bytea nullable
external_version           text nullable
retention_class            temporary | project | persistent | external_cache | system
purge_after                timestamptz nullable
purged_at                  timestamptz nullable
error_code                 text nullable
error_detail               jsonb nullable
created_by_user_id         text/uuid nullable
created_by_api_key_id      uuid nullable
created_at                 timestamptz not null
updated_at                 timestamptz not null
```

Indexes:

- `(workspace_id, created_at desc)`
- `(workspace_id, content_hash) where content_hash is not null and purged_at is null`
- `(purge_after) where purge_after is not null and purged_at is null`
- `(workspace_id, status)`

### 6.6 `creative_project_assets`

```text
project_id                 uuid not null
asset_id                   uuid not null
role                       source | audio | image | font | generated | output
linked_at_revision_id      uuid not null
unlinked_at_revision_id    uuid nullable
created_at                 timestamptz not null
primary key (project_id, asset_id, linked_at_revision_id)
```

An asset is considered live while it has a live project link, belongs to a scheduled/publishing artifact, is explicitly persistent, or is externally backed and needed by an active job.

### 6.7 `creative_revision_assets`

```text
revision_id                uuid not null
asset_id                   uuid not null
node_ids                   text[] not null default '{}'
primary key (revision_id, asset_id)
```

This immutable dependency list is produced by successful compilation. A render therefore uses exactly the assets referenced by the selected revision, even when the project changes later.

### 6.8 `creative_render_jobs`

```text
id                         uuid primary key
workspace_id               uuid not null
project_id                 uuid not null
revision_id                uuid not null
status                     queued | validating | materializing | rendering | uploading | succeeded | failed | canceled
render_kind                preview_frame | preview_video | final_video | audio_only | image
render_config              jsonb not null
render_config_hash         text not null
temporal_workflow_id       text unique
progress_current           integer
progress_total             integer
progress_stage             text
attempt_count              integer not null default 0
output_id                  uuid nullable
error_code                 text nullable
error_summary              text nullable
error_detail               jsonb nullable
requested_by_type          user | agent_api_key | mcp | system
requested_by_user_id       text/uuid nullable
requested_by_api_key_id    uuid nullable
created_at                 timestamptz not null
started_at                 timestamptz nullable
completed_at               timestamptz nullable
canceled_at                timestamptz nullable
```

Unique `(revision_id, render_kind, render_config_hash)` may be used for reusable completed renders, with an explicit `force` flag to bypass reuse.

### 6.9 `creative_outputs`

```text
id                         uuid primary key
workspace_id               uuid not null
project_id                 uuid not null
revision_id                uuid not null
render_job_id              uuid not null
kind                       final_video | preview_video | preview_frame | audio | image
mime_type                  text not null
size_bytes                 bigint not null
duration_ms                integer
width                      integer
height                     integer
r2_key                     text not null unique
content_hash               text nullable
media_asset_id             uuid nullable -> existing media_assets
retention_class            preview | temporary_final | composer | persistent
purge_after                timestamptz nullable
purged_at                  timestamptz nullable
created_at                 timestamptz not null
```

### 6.10 `creative_templates` and `creative_template_versions`

Templates must be versioned because existing projects must not change when a template is updated.

```text
creative_templates:
  id, slug, name, description, status, visibility, owner, latest_version_id

creative_template_versions:
  id, template_id, version, source_files jsonb, required_slots jsonb,
  default_dimensions, preview_asset_id, runtime_version, created_at
```

Content formats such as UGC, slideshow, talking head, listicle, product demo, Reddit story, podcast clip, and gameplay overlay become versioned creative templates rather than separate incompatible editors.

### 6.11 Storage accounting

Add a storage ledger or materialized usage table:

```text
workspace_storage_usage
  workspace_id
  original_bytes
  derived_bytes
  output_bytes
  persistent_bytes
  temporary_bytes
  updated_at
```

Never trust a client-provided storage total. Update usage from committed asset/output state transitions or reconcile it periodically from PostgreSQL and R2 inventory.

## 7. Cloudflare R2 design

### 7.1 Bucket strategy

Use the existing private Posterract R2 bucket for v1. Separate prefixes provide lifecycle and permission boundaries. A separate public bucket can be introduced later for globally public template previews, but user assets stay private.

Recommended key layout:

```text
creative/workspaces/{workspaceId}/assets/{assetId}/original/{filename}
creative/workspaces/{workspaceId}/assets/{assetId}/proxy/editor-720p.mp4
creative/workspaces/{workspaceId}/assets/{assetId}/proxy/audio-preview.m4a
creative/workspaces/{workspaceId}/assets/{assetId}/derived/thumbnail.webp
creative/workspaces/{workspaceId}/assets/{assetId}/derived/filmstrip.webp
creative/workspaces/{workspaceId}/assets/{assetId}/derived/waveform.bin
creative/workspaces/{workspaceId}/assets/{assetId}/derived/transcript.json

creative/workspaces/{workspaceId}/projects/{projectId}/bundles/{sourceHash}.js
creative/workspaces/{workspaceId}/projects/{projectId}/captures/{renderJobId}/{timecode}.png
creative/workspaces/{workspaceId}/projects/{projectId}/renders/{renderJobId}/final.mp4
creative/workspaces/{workspaceId}/projects/{projectId}/covers/{revisionId}.webp

creative/temp/uploads/{uploadSessionId}/...
creative/temp/renders/{renderJobId}/...

system/templates/{templateId}/{version}/preview.mp4
system/assets/{assetId}/...
```

Do not put raw user-provided filenames directly into structural path segments without normalization. Asset IDs are the security boundary; filenames are display metadata.

### 7.2 Direct multipart upload

Reuse the current Uppy + signed multipart architecture:

1. Client requests a creative-asset upload session.
2. API validates workspace, quota, content type, declared size, project permission, and API-key scope.
3. API creates the R2 multipart session and `creative_assets` row in `uploading` state.
4. Redis stores the short-lived multipart session; PostgreSQL stores durable asset intent.
5. Uppy uploads parts directly from browser to R2. Video bytes never pass through the API or gateway.
6. Completion endpoint verifies R2 object size with `HeadObject`.
7. Asset moves to `uploaded`; a Temporal asset-processing workflow starts.
8. Redis session is removed.
9. Failure or cancellation aborts multipart upload and tombstones the asset.

Create a shared internal upload module, but expose a separate creative endpoint so publishing-media and creative-source retention are never confused:

```text
POST   /v1/creative-assets/multipart
POST   /v1/creative-assets/multipart/:uploadId/parts/:partNumber
GET    /v1/creative-assets/multipart/:uploadId/parts
POST   /v1/creative-assets/multipart/:uploadId/complete
DELETE /v1/creative-assets/multipart/:uploadId
```

### 7.3 Asset processing

After upload, a dedicated activity should:

1. Verify MIME type from file bytes rather than extension.
2. Run `ffprobe`/media probe.
3. Reject malformed, encrypted, unsupported, or dangerous files.
4. Record codec, container, dimensions, frame rate, duration, channels, and sample rate.
5. Normalize rotation metadata.
6. Generate a browser-friendly editor proxy when needed.
7. Generate thumbnail, filmstrip, and waveform.
8. Calculate a streaming content hash.
9. Optionally deduplicate within the workspace.
10. Mark the asset `ready` only when a usable preview or original is available.

Recommended editor proxy:

- MP4 container
- H.264 video
- AAC audio
- Constant or normalized frame rate
- Maximum 720p long edge for v1
- Fast-start metadata
- Moderate bitrate appropriate for scrubbing

Final renders should use originals, not proxies.

### 7.4 Signed playback

- R2 remains private.
- API issues short-lived signed GET URLs per asset variant.
- Default URL lifetime: 15 minutes for interactive previews; one hour for render activities.
- The editor refreshes expiring URLs without changing the asset ID.
- Never persist a signed URL in project source or PostgreSQL as the durable locator.
- Project code references `asset="uuid"`; the resolver supplies a current URL.

### 7.5 CORS

R2 CORS must allow only the deployed Posterract application origin and the isolated editor sandbox origin. Required methods are `GET`, `HEAD`, and signed multipart `PUT`. Expose `ETag` for multipart completion. Do not enable public bucket access.

### 7.6 Deduplication

Use workspace-scoped deduplication so two unrelated customers do not gain information about each other's uploads.

V1 can ship without blocking uploads on hashing. The processor computes a content hash after upload. If an identical live asset exists in the same workspace:

- Keep one immutable original object.
- Point a new logical asset record to the same physical object or merge references transactionally.
- Maintain a physical-object reference table if shared R2 keys are introduced.
- Never delete a physical object until no live logical asset references it.

### 7.7 Retention classes

#### Unattached upload

- Upload completed but never attached to a project: delete after 24 hours.
- Incomplete multipart data: Cloudflare lifecycle abort after seven days as a final safety net; API should abort sooner when possible.

#### Temporary project

- Keep source assets while project is active, rendering, or has scheduled outputs.
- When its last output becomes live, start a seven-day editing safety window.
- After the window, delete originals, proxies, derived media, and renders.
- Keep tiny source revisions and metadata unless the user deletes the project.
- Reopening later shows missing assets and offers relink/rehydration.

#### Externally backed project

- Persist the Drive/provider locator and exact external version.
- Materialize originals into R2 only for active editing/rendering.
- Delete materialized originals 48 hours after the last render/publish unless another active job needs them.
- Keep low-resolution proxies for a configurable cache window, then regenerate on demand.

#### Persistent project

- Keep originals until user deletion or storage-plan enforcement.
- Count every retained original and durable output against workspace storage.
- Derived caches may still be purged and regenerated.

#### Preview output

- Captured frames: 24 hours.
- Preview videos: 72 hours.
- Covers: keep while project exists, but only retain latest few versions.

#### Final output

- Local browser download: never uploaded unless user selects `Send to Composer` or `Save to cloud`.
- Composer output: follow existing `media_assets` lifecycle.
- Successfully published output: existing 48-hour safety buffer, then delete when no other active transmission references it.
- Failed/partial output: seven days for retry unless user deletes sooner.

### 7.8 Correct deletion transaction

Do not repeat MakeAIUGCVids' database-only expiry defect.

Use this deletion state machine:

```text
live
 -> purge_pending in PostgreSQL
 -> enqueue durable delete-object activity
 -> delete R2 keys
 -> verify missing or accept idempotent NoSuchKey
 -> set purged_at and status=purged
 -> release storage usage
```

If R2 deletion fails, leave the tombstone and retry with backoff. Database rows should not disappear before object cleanup is confirmed. User-facing deletion can hide a record immediately with `deleted_at`, while physical cleanup remains durable.

## 8. Browser editor architecture

### 8.1 Routes

```text
/create                         project/template dashboard
/create/new                     new-project flow
/create/:projectId              editor
/create/:projectId/history      revision history
/create/:projectId/render/:id   render detail
```

The current `/compose` route remains the publishing page.

### 8.2 Editor layout

Desktop layout:

```text
+----------------+-------------------------------+-------------------+
| Asset library  | Canvas viewport               | Inspector         |
| Upload         | selection box / guides        | Transform         |
| Drive          | play controls / timecode      | Timing            |
| Generated      | safe zones                    | Typography        |
| Templates      |                               | Motion/effects    |
+----------------+-------------------------------+-------------------+
| Layer tree     | Multi-track timeline / waveform / keyframes       |
+----------------+---------------------------------------------------+
| Agent activity / prompt handoff      | Code / diagnostics / logs   |
+--------------------------------------------------------------------+
```

Mobile should initially support reviewing, text changes, asset replacement, agent instructions, and publishing handoff—not the entire desktop timeline.

### 8.3 React host versus engine sandbox

Posterract's application remains React. The composition runtime does not need to be rewritten into React immediately.

Recommended split:

- React owns application chrome, project list, asset library, inspector, timeline controls, code editor, dialogs, notifications, and API state.
- An isolated sandbox document owns compilation/mounting of the approved bundle, ECS runtime, Canvas preview, hit testing, selection overlays, and optional browser export.
- Host and sandbox communicate through a versioned `postMessage` protocol and capability token.

Example messages:

```text
HOST -> SANDBOX  mountBundle
HOST -> SANDBOX  setAssetManifest
HOST -> SANDBOX  seek
HOST -> SANDBOX  play
HOST -> SANDBOX  applyCommittedOperations
HOST -> SANDBOX  requestSnapshot

SANDBOX -> HOST  ready
SANDBOX -> HOST  documentSummary
SANDBOX -> HOST  selectionChanged
SANDBOX -> HOST  visualOperation
SANDBOX -> HOST  playbackState
SANDBOX -> HOST  runtimeError
SANDBOX -> HOST  exportProgress
```

Every message must validate origin, protocol version, capability token, project ID, revision ID, and payload schema.

### 8.4 Editor runtime packages

Recommended Posterract workspace packages:

```text
packages/video-jsx             composition types and authoring API
packages/video-runtime         ECS traits, systems, media playback, canvas render
packages/video-reconciler      compiled JSX -> runtime entities
packages/video-assets          asset manifest/resolution abstractions
packages/video-encoder         browser offline encoding
packages/video-source          source stamping and AST write-back
packages/video-protocol        host/sandbox/API/MCP shared contracts
apps/editor-sandbox            isolated browser runtime build
apps/render-worker             hosted capture and final rendering
```

The runtime packages should be pinned to explicit versions in every project revision/render manifest so an old project can be reproduced after engine upgrades.

### 8.5 Timeline model

The timeline is a view of ECS/source state, not a separate persisted timeline database.

V1 tracks:

- Video
- Audio
- Images
- Text/captions
- Shapes/effects
- Groups/sequences
- Keyframes

Timeline operations emit the same semantic operations used by canvas and inspector.

Performance requirements:

- Virtualize off-screen tracks and clips.
- Render waveforms from derived data rather than decoding audio repeatedly.
- Use proxies for scrubbing.
- Coalesce pointer movement; commit on release.
- Keep playback state outside React's high-frequency component tree.
- Use requestAnimationFrame and engine state for playhead updates.

### 8.6 Inspector

Inspector sections are generated from node schemas:

- Identity/name
- Source asset
- Position and size
- Anchor/offset
- Scale/rotation/skew
- Start/end/source in/out
- Opacity/blend mode
- Fill/stroke/corner radius
- Typography
- Audio volume/fades
- Animation/easing
- Transition
- Effect parameters
- Accessibility/caption settings

Schema-driven inspector controls let new premium effects expose editable parameters without hard-coding a bespoke React form for each one.

### 8.7 Code editor

Use a lazy-loaded code editor so normal editor startup is not blocked by its bundle. Monaco provides the closest IDE experience; CodeMirror is lighter. Recommended starting point: Monaco loaded only when the Code panel opens.

Provide:

- Virtual file tree
- TSX syntax highlighting
- Diagnostics with click-to-location
- Read-only generated type definitions for `@posterract/video`
- Asset-ID autocomplete with thumbnail/name metadata
- Template/effect autocomplete
- Format-on-save
- Diff current revision against prior revision
- `Revert file`, `Revert revision`, and `Restore last compiling version`

### 8.8 Browser cache and offline behavior

IndexedDB is a cache, not source of truth. Store:

- Last opened source revision
- Last good bundle
- Proxy/thumbnail/waveform cache subject to quota
- Pending unsent visual operations
- Code drafts not yet acknowledged by server
- Recent document summaries

On reconnect:

1. Fetch server current revision.
2. If base revision still matches, replay pending idempotent operations.
3. If it diverged, show a conflict review instead of silently overwriting agent work.

### 8.9 Undo and redo

- During an active drag, maintain ephemeral engine state.
- On pointer release, commit one operation batch.
- Local undo before server acknowledgment cancels/reverses the pending batch.
- Committed undo creates a new inverse revision.
- Agent revisions appear as named history entries and can be reverted as a unit.

## 9. Compilation architecture

### 9.1 Compiler inputs

An immutable compile request contains:

- Project ID
- Revision ID
- Ordered source files and hashes
- Entry path
- Runtime version
- Allowed module manifest
- Asset metadata manifest
- Template/effect version manifest
- Compile limits

### 9.2 Compiler steps

1. Normalize and validate virtual paths.
2. Parse TS/TSX/JSON.
3. Reject forbidden imports and constructs.
4. Stamp composition elements with source locators.
5. Ensure or insert durable element IDs where safe.
6. Canonicalize composition tag imports.
7. Compile TypeScript and JSX with esbuild/Babel.
8. Bundle only approved modules.
9. Extract a static document summary and referenced asset IDs where possible.
10. Run structural validation.
11. Store diagnostics.
12. Store the successful compiled bundle in R2 by source hash.
13. Update `last_good_revision_id` transactionally.
14. Broadcast an SSE revision/compile event.

### 9.3 Compile placement

The durable compiler should be server-side. The browser may later run a Web Worker compiler for low-latency speculative feedback, but the server result is authoritative for agent operations and renders.

Run compilation in a dedicated process/service rather than the API request thread. Small compile jobs may be executed as Temporal activities or a bounded worker queue. The API returns `202` when compilation is asynchronous and exposes status endpoints.

### 9.4 Compiler cache

Cache key:

```text
sha256(
  ordered source file hashes
  + runtime version
  + compiler version
  + allowed module versions
  + template/effect versions
)
```

Redis can map cache key to successful bundle metadata for a short period. R2 holds the durable derived bundle. PostgreSQL records which bundle belongs to the revision.

### 9.5 Resource limits

Initial limits:

- 100 source files
- 5 MiB total source
- 10,000 composition nodes
- 100 scenes
- 120-minute maximum composition duration, with lower plan limits initially
- 60 fps maximum
- 4096 x 4096 maximum canvas for standard plans
- Compile wall time 15 seconds
- Compile memory 512 MiB
- Maximum compiled bundle 20 MiB

Limits should be configurable and reported as structured diagnostics.

## 10. Preview and rendering

### 10.1 Three output paths

#### Interactive preview

- Runs in the isolated browser sandbox.
- Uses proxies and current ECS state.
- Prioritizes responsiveness over final fidelity.
- Never creates a durable final output.

#### Browser export

- Remounts the committed revision in a fresh capture world.
- Encodes using browser Canvas/WebCodecs/Web Audio/MediaBunny.
- Downloads directly to the user's device by default.
- Does not consume R2 storage unless user chooses `Save to cloud` or `Send to Composer`.

#### Hosted render

- Required for external agents, automations, and durable server-side workflows.
- Temporal pins revision and assets.
- Isolated render worker materializes source and inputs.
- Headless Chromium runs the same runtime/encoder.
- Final file is uploaded to R2.
- Temporary workspace is deleted.

### 10.2 Hosted render workflow

```text
requestRender
 -> claim idempotency key
 -> verify project/revision ownership
 -> verify successful compilation
 -> resolve immutable asset dependencies
 -> materialize external assets if required
 -> generate missing normalized inputs
 -> reserve workspace render quota
 -> issue render manifest and short-lived asset capabilities
 -> launch isolated renderer
 -> report frame/progress heartbeats
 -> encode output
 -> upload output to R2 multipart
 -> verify output with ffprobe and HeadObject
 -> insert creative_output
 -> update creative_render_job succeeded
 -> release quota
 -> delete temporary workspace
 -> emit render.completed event
```

### 10.3 Render manifest

Each job receives an immutable manifest:

```json
{
  "jobId": "...",
  "projectId": "...",
  "revisionId": "...",
  "sourceHash": "...",
  "bundleHash": "...",
  "runtimeVersion": "...",
  "sceneId": "main",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "startFrame": 0,
  "endFrame": 450,
  "format": "mp4",
  "videoCodec": "h264",
  "audioCodec": "aac",
  "assets": [
    {
      "assetId": "...",
      "contentHash": "...",
      "inputCapability": "short-lived-signed-url"
    }
  ],
  "outputCapability": "short-lived-multipart-upload-contract"
}
```

The renderer should not receive the database connection string, general R2 credentials, user cookies, social OAuth tokens, or Posterract master API credentials.

### 10.4 Render worker container

Add a separate Compose service rather than adding Chromium/ffmpeg to the API container.

Responsibilities:

- Headless Chromium
- Approved editor runtime build
- ffmpeg/ffprobe for normalization and verification
- Temporary work directory
- Progress/heartbeat client
- Multipart output uploader or scoped output endpoint

Recommended defaults:

- Concurrency: 1 on the current VPS until measured
- Per-job memory limit: begin around 2 GiB and tune after the spike
- Per-job temporary disk limit
- Per-job wall-time limit based on output duration/resolution
- `/dev/shm` sized for Chromium
- No host filesystem mounts except a dedicated temporary volume
- Automatic workspace cleanup on success, failure, timeout, or cancellation

Do not run it until a VPS capacity check confirms sufficient free RAM, disk, CPU, and swap. If capacity is insufficient, the same worker image can run on a separate render VPS without changing product APIs.

### 10.5 Render determinism

- Render immutable revision IDs, never `latest`.
- Resolve immutable asset IDs/versions.
- Pin runtime, compiler, fonts, templates, and effect versions.
- Use a deterministic frame clock; do not use wall time.
- Seed randomness from the render manifest.
- Disallow uncontrolled network requests.
- Await media readiness before frame zero.
- Use a fresh capture world.
- Compare representative frames in regression tests.

### 10.6 Progress and cancellation

Progress stages:

```text
queued
validating
materializing assets
starting renderer
rendering frame X/Y
encoding audio
finalizing
uploading
verifying
complete
```

Cancellation must propagate through Temporal to the render worker. The worker cancels the encoder, aborts multipart upload, deletes temporary files, and marks the job canceled. A retry creates a new attempt under the same durable job or a new job linked to the original.

### 10.7 Preview capture for agents

Support cheap targeted captures before full render:

- Single frame at a timecode
- Multiple frames as a labelled contact sheet
- Short low-resolution preview segment
- Scene cover
- Transparent PNG for individual elements where supported

Capture results use the preview retention class and signed URLs.

## 11. Agent and MCP architecture

### 11.1 Principle

The user's agent owns reasoning; Posterract owns projects, media, tools, rendering, and publishing. Once an agent requests a compile or render, the durable operation continues even if the agent disconnects or the user's computer sleeps.

### 11.2 New API-key scopes

Extend the existing scope set with:

```text
creative:read
creative:write
creative-assets:read
creative-assets:write
creative-renders:read
creative-renders:write
```

Keep `posts:write` separate. A user can allow an agent to edit/render without allowing it to publish.

Suggested key profiles:

- Editor assistant: creative read/write, assets read, renders read/write; no publishing.
- Creator agent: creative read/write, assets read/write, renders read/write; no publishing.
- Full publishing agent: creator scopes plus accounts read, posts read/write, analytics read.
- Read-only reviewer: creative read, assets read, renders read.

### 11.3 Hosted MCP transport

Expose a hosted Streamable HTTP MCP endpoint under the Posterract API domain. It authenticates with the same bearer API key and maps tools to normal domain services. The MCP layer must not implement a second persistence path.

The MCP server also exposes resources:

```text
posterract://editor/reference
posterract://editor/jsx-elements
posterract://editor/effects
posterract://editor/templates
posterract://editor/project/{projectId}/context
```

This means the user does not have to manually distribute a large skill folder. An optional thin skill can teach an agent when to call the MCP tools, but the authoritative reference is served by Posterract.

### 11.4 MCP tools

#### Project tools

```text
creative_project_create
creative_project_list
creative_project_get
creative_project_get_context
creative_project_archive
creative_project_delete
```

#### Source tools

```text
creative_source_list_files
creative_source_read_file
creative_source_write_file
creative_source_apply_patch
creative_source_apply_operations
creative_source_get_diff
creative_source_list_revisions
creative_source_restore_revision
```

Every write requires `expectedRevisionId` and `idempotencyKey`.

#### Asset tools

```text
creative_asset_list
creative_asset_get
creative_asset_create_upload
creative_asset_complete_upload
creative_asset_attach
creative_asset_detach
creative_asset_delete
creative_asset_import_external
```

For a local agent file, provide a companion uploader/CLI that implements multipart R2 upload. MCP itself should not force giant video bytes through JSON tool calls.

#### Media-understanding tools

Mirror the useful Diffusion CLI capabilities:

```text
creative_media_probe
creative_media_grab_frames
creative_media_filmstrip
creative_media_waveform
creative_media_transcribe
creative_media_analyze
```

Separate local/no-credit processing from paid model analysis in tool descriptions and billing.

#### Validation and capture tools

```text
creative_project_compile
creative_project_validate
creative_project_capture_frames
creative_project_preview_segment
creative_project_get_diagnostics
```

Validation should report:

- Compile errors
- Duplicate or missing node IDs
- Missing assets
- Unsupported media
- Black-frame gaps
- Invisible/zero-duration elements
- Out-of-bounds elements
- Text safe-zone warnings
- Platform aspect/duration warnings
- Excessive node/resource limits

#### Render and handoff tools

```text
creative_project_render
creative_render_get
creative_render_cancel
creative_render_retry
creative_output_send_to_composer
creative_output_create_post
```

`creative_output_create_post` requires `posts:write`; `send_to_composer` may only create a draft/handoff accessible to the user.

### 11.5 Agent editing loop

Recommended agent loop:

```text
1. Read editor reference and template catalog.
2. Create/open project.
3. List and inspect available assets.
4. Upload/import required assets.
5. Read current source and revision.
6. Write or patch TSX.
7. Compile.
8. Fix diagnostics.
9. Validate structure.
10. Capture 3-6 representative frames.
11. Inspect frames and media feedback.
12. Iterate source.
13. Render final revision.
14. Poll durable render status.
15. Send output to Composer or create a post if authorized.
```

### 11.6 Open editor while agent edits

Project SSE event types:

```text
project.revision.created
project.compile.started
project.compile.succeeded
project.compile.failed
asset.processing.updated
render.progress
render.completed
render.failed
project.deleted
```

When an agent commits a revision:

- API publishes the event through Redis pub/sub.
- The open browser fetches the new revision and bundle.
- If the human has no uncommitted local changes, mount automatically.
- If the human has local changes, show `Agent created revision 42 — review or merge`.
- Revision history identifies the API-key name and agent actor.

### 11.7 No hosted agent required

Posterract can support this product without operating an LLM:

- The customer's agent calls MCP/API.
- Posterract compiles, captures, renders, stores, and publishes.
- Long jobs continue in Temporal.
- The agent returns later and reads status.

A Posterract-hosted agent can be added later as a separate product choice, not a prerequisite for the pipeline.

## 12. HTTP API plan

### 12.1 Projects

```text
GET    /v1/creative-projects
POST   /v1/creative-projects
GET    /v1/creative-projects/:projectId
PATCH  /v1/creative-projects/:projectId
DELETE /v1/creative-projects/:projectId
POST   /v1/creative-projects/:projectId/restore
GET    /v1/creative-projects/:projectId/events
```

### 12.2 Source and revisions

```text
GET    /v1/creative-projects/:projectId/files
GET    /v1/creative-projects/:projectId/files/*path
PUT    /v1/creative-projects/:projectId/files/*path
POST   /v1/creative-projects/:projectId/source/patch
POST   /v1/creative-projects/:projectId/operations
GET    /v1/creative-projects/:projectId/revisions
GET    /v1/creative-projects/:projectId/revisions/:revisionId
POST   /v1/creative-projects/:projectId/revisions/:revisionId/restore
POST   /v1/creative-projects/:projectId/compile
GET    /v1/creative-projects/:projectId/diagnostics
```

### 12.3 Assets

```text
GET    /v1/creative-assets
POST   /v1/creative-assets/multipart
POST   /v1/creative-assets/multipart/:uploadId/parts/:partNumber
GET    /v1/creative-assets/multipart/:uploadId/parts
POST   /v1/creative-assets/multipart/:uploadId/complete
DELETE /v1/creative-assets/multipart/:uploadId
GET    /v1/creative-assets/:assetId
GET    /v1/creative-assets/:assetId/url?variant=proxy
DELETE /v1/creative-assets/:assetId
POST   /v1/creative-projects/:projectId/assets/:assetId
DELETE /v1/creative-projects/:projectId/assets/:assetId
```

### 12.4 Media understanding

```text
POST /v1/creative-assets/:assetId/probe
POST /v1/creative-assets/:assetId/frames
POST /v1/creative-assets/:assetId/filmstrip
POST /v1/creative-assets/:assetId/waveform
POST /v1/creative-assets/:assetId/transcribe
```

Return existing result when the same derived job already succeeded.

### 12.5 Capture and render

```text
POST   /v1/creative-projects/:projectId/captures
POST   /v1/creative-projects/:projectId/renders
GET    /v1/creative-renders/:renderId
POST   /v1/creative-renders/:renderId/cancel
POST   /v1/creative-renders/:renderId/retry
GET    /v1/creative-outputs/:outputId
POST   /v1/creative-outputs/:outputId/send-to-composer
```

### 12.6 Error contract

Every domain error should include:

```json
{
  "error": "revision_conflict",
  "message": "Project changed after the supplied base revision.",
  "requestId": "...",
  "detail": {
    "expectedRevisionId": "...",
    "currentRevisionId": "...",
    "changedFiles": ["index.tsx"]
  }
}
```

Agents need stable error codes, not only human prose.

## 13. Temporal workflows

Use separate task queues so publishing latency is not blocked by video processing.

Recommended queues:

```text
posterract-publishing          existing social publishing
posterract-creative-assets     probe/proxy/thumbnail/waveform/transcript
posterract-creative-render     capture/final render
posterract-creative-cleanup    R2 deletion and reconciliation
```

### 13.1 Asset-processing workflow

```text
CreativeAssetWorkflow(assetId)
  validateUpload
  probeMedia
  normalizeMetadata
  generateProxyIfNeeded
  generateThumbnail
  generateFilmstrip
  generateWaveform
  calculateHash
  markReady
```

Activities must be idempotent by asset ID + derived profile version.

### 13.2 Compile workflow

```text
CreativeCompileWorkflow(revisionId)
  validateRevision
  compileBundle
  validateDocument
  extractAssetDependencies
  persistBundle
  markRevisionResult
  publishProjectEvent
```

For low latency, compile can also use a dedicated bounded worker outside Temporal while the durable job record remains in PostgreSQL. Choose one implementation during the technical spike and keep the API contract unchanged.

### 13.3 Render workflow

```text
CreativeRenderWorkflow(renderJobId)
  claimJob
  ensureCompilation
  resolveAssets
  materializeExternalAssets
  reserveCapacity
  startRenderer
  monitorHeartbeat
  verifyOutput
  persistOutput
  releaseCapacity
  cleanupWorkspace
  publishRenderEvent
```

### 13.4 Cleanup workflow

```text
CreativeCleanupWorkflow(entityType, entityId)
  lockTombstone
  enumerateR2Keys
  deleteKeys
  verifyDeletion
  markPurged
  releaseStorageUsage
```

### 13.5 Scheduling and renderer isolation

Do not add creative activities to the existing high-concurrency publishing worker process. Add dedicated worker services so a slow 1080p render cannot delay a scheduled post.

## 14. Composer and publishing integration

### 14.1 Handoff contract

`Send to Composer` should:

1. Verify output belongs to workspace and is not purged.
2. Create an existing `media_assets` record pointing to the output R2 object, or safely transfer/alias the object into the publishing prefix.
3. Mark output as linked to that `media_assets` row.
4. Clear premature purge timers while attached to an active Composer draft/transmission.
5. Navigate to:

```text
/compose?artifact={mediaAssetId}
```

6. Prepopulate title and optional template-provided caption draft.

### 14.2 Avoiding duplicate R2 objects

Prefer an alias/reference when existing publishing code can safely read the creative output key. If publishing requires the current `uploads/{workspaceId}/{mediaId}/source.ext` layout, use an R2 server-side copy and make lifecycle ownership explicit.

Do not let both `creative_outputs` and `media_assets` independently delete the same physical key. Introduce physical object ownership or a single canonical deletion owner.

### 14.3 Publishing retention

The publishing state machine always overrides a creative purge deadline while the media is scheduled, uploading, publishing, processing, or retryable. After every terminal projection state is resolved, the existing transmission logic chooses the final safety window.

## 15. Security model

### 15.1 Threat model

Assume project code may be malicious because:

- An external agent may be prompt-injected.
- A user may paste untrusted code.
- A shared template may contain a defect.
- An asset URL may be malicious.
- A compiler/runtime dependency may have a vulnerability.

### 15.2 Browser isolation

- Serve the editor runtime from a dedicated origin with no Posterract auth cookies.
- Use a sandboxed iframe with the minimum capabilities required.
- Do not use `allow-same-origin` with untrusted authored code unless the sandbox origin itself contains no secrets and the tradeoff is explicitly tested.
- Validate every `postMessage` origin and capability.
- Use a restrictive CSP.
- Prevent top navigation, popups, downloads without host mediation, clipboard access, and arbitrary form submission.
- Do not expose API keys, OAuth tokens, user cookies, or raw R2 credentials to the sandbox.
- Supply assets through short-lived capabilities.

### 15.3 Compiler restrictions

- Explicit module allowlist.
- Ban dynamic imports outside approved modules.
- Ban Node built-ins.
- Ban eval-like constructs in authored source where practical.
- Enforce source size and AST complexity limits.
- Enforce unique IDs.
- Validate URLs and asset references.
- Record compiler/runtime versions.

### 15.4 Server render isolation

- Dedicated container/process user.
- Read-only root filesystem where possible.
- Dedicated temporary directory with quota.
- No Docker socket.
- No Postgres credentials.
- No general R2 credentials.
- No social OAuth credentials.
- Network egress denied or strictly allowlisted.
- CPU, RAM, process, output-size, and wall-time limits.
- Kill and clean up hung Chromium trees.

### 15.5 Remote URL ingestion

Do not let the renderer fetch arbitrary authored URLs. Remote imports go through an ingestion service that:

- Allows HTTP/HTTPS only.
- Blocks localhost, RFC1918, link-local, metadata, Tailscale, and internal service addresses.
- Revalidates DNS after redirects.
- Limits redirects, size, duration, and content type.
- Downloads into R2 and creates an immutable asset record.
- Scans/probes before making it available to projects.

### 15.6 Authorization

Every project, revision, asset, capture, render, output, and signed URL is workspace-scoped. Use ownership checks at the domain layer, not only UI filters. Return 404 rather than leaking cross-workspace existence where appropriate.

### 15.7 Auditability

Log:

- Actor/API-key ID, never plaintext key
- Project and revision ID
- Operation type and affected node IDs
- Compile/render status
- Request and workflow IDs
- Storage deletion results

Do not log project secrets, signed URLs, bearer tokens, OAuth tokens, or entire media payloads.

## 16. Quotas, pricing hooks, and cost controls

Track independently:

- Persistent original storage
- Derived/cache storage
- Rendered output storage
- Monthly render minutes
- Maximum concurrent renders
- Maximum source resolution/duration
- AI generation credits
- Transcription/model-analysis usage

Recommended product behavior:

- Browser preview/editing does not consume render minutes.
- Browser local export is free or minimally metered because compute runs on the user's machine.
- Hosted agent/server render consumes render minutes.
- Persistent creative storage counts against a storage allowance.
- Temporary projects are automatically cleaned and can have a generous allowance.
- Paid premium effects/assets can be authorized at render time.

Enforcement happens before upload/render reservation and is reconciled after actual output size/duration is known.

## 17. Search and indexing

Elasticsearch is optional for v1 correctness. Add it later for:

- Transcript search
- Search across project titles and source text
- Asset semantic labels
- Template discovery
- Scene/quote search
- Analytics-to-creative knowledge graph features

PostgreSQL remains authoritative. Elasticsearch documents contain entity IDs and searchable projections only.

## 18. Observability

### 18.1 Metrics

Collect:

- Project create/open/save counts
- Visual edit commit latency
- Compile p50/p95/p99 and failure rate
- Bundle sizes
- Preview mount time
- Playback dropped-frame rate
- Multipart success/retry/abort rate
- Asset-processing duration by stage
- Proxy generation failure rate
- Render queue wait
- Render frames per second
- Render real-time factor
- Render success/failure/cancellation
- Temporary workspace cleanup failures
- R2 bytes by retention class
- R2 orphan reconciliation count
- Agent tool calls and conflict rate
- Composer handoff success rate

### 18.2 Structured logs

Use correlation IDs across:

```text
HTTP request
 -> project revision
 -> compile job/workflow
 -> capture/render job
 -> output
 -> Composer media asset
 -> transmission
```

### 18.3 Health checks

Add readiness components for:

- Compiler worker
- Creative asset worker
- Render worker capacity
- R2 access
- Temporal creative task queues
- Required runtime bundle version

The main API can remain ready for publishing even if rendering is degraded; expose component status instead of taking the entire application offline.

### 18.4 Reconciliation jobs

Periodic reconciliation should detect:

- PostgreSQL assets whose R2 object is missing
- R2 objects with no live PostgreSQL owner
- Stuck multipart sessions
- Render jobs with expired worker heartbeat
- Outputs whose `media_assets` handoff is inconsistent
- Storage usage drift
- Revisions pointing to missing bundles

## 19. Failure recovery

### 19.1 Upload interruption

- Redis session supports Uppy resume while valid.
- R2 list-parts endpoint reconstructs completed parts.
- Expired session can be aborted and restarted.
- PostgreSQL asset remains tombstoned for diagnostic/audit.

### 19.2 Asset processing failure

- Original remains temporarily available.
- User sees exact probe/transcode error.
- Retry uses the same immutable original.
- Unsupported codec can offer normalization.

### 19.3 Compile failure

- Preserve invalid source revision.
- Keep last good preview.
- Return diagnostics.
- Agent can fetch diagnostics and patch.

### 19.4 Browser crash

- Last server-acknowledged revision remains safe.
- IndexedDB restores unacknowledged operations/draft.
- Conflict resolution protects agent changes made while browser was down.

### 19.5 Render worker crash

- Temporal observes heartbeat timeout.
- Activity retry uses a fresh temporary workspace.
- Multipart output is aborted or garbage-collected.
- Completed immutable inputs make retry deterministic.

### 19.6 R2 outage

- API refuses new upload sessions with explicit dependency status.
- Existing project metadata remains accessible.
- Render waits/retries according to bounded workflow policy.
- Publishing health reports R2 separately, as current readiness already does.

### 19.7 Deletion failure

- Record stays `purge_pending`.
- Cleanup workflow retries.
- Storage usage remains charged until confirmed deletion, or is marked pending according to billing policy.

## 20. Testing strategy

### 20.1 Unit tests

- TSX source locator stability
- ID stamping
- Every semantic source operation
- Formatting preservation
- Loop unroll behavior
- Revision conflict detection
- Idempotency replay
- Asset resolver
- R2 key validation
- Retention calculations
- Storage ledger transitions
- Render-manifest hashing
- MCP input/output validation
- Scope enforcement

### 20.2 Compiler fixtures

Create fixtures for:

- Minimal project
- Multi-file project
- Video + text + audio
- Keyframes and transitions
- Captions
- Missing asset
- Duplicate ID
- Invalid import
- Syntax error
- Infinite/oversized structure attempt
- Loop with stable IDs
- Loop requiring unroll
- Template/premium effect

Each successful fixture has a stable document summary and representative frame snapshots.

### 20.3 Source round-trip tests

For every supported visual operation:

1. Compile fixture.
2. Address a node by source ID.
3. Apply operation.
4. Parse resulting TSX.
5. Recompile.
6. Assert semantic result.
7. Assert unrelated code remains unchanged.

### 20.4 Browser integration tests

- Open project and mount last good bundle.
- Upload media directly to R2 test double.
- Drag canvas element and verify TSX update.
- Trim timeline clip and verify TSX update.
- Edit TSX and verify canvas update.
- Introduce compile error and verify last good canvas remains.
- Receive agent SSE revision and remount.
- Detect local/agent conflict.
- Browser export and download.
- Send rendered output to Composer.

### 20.5 Render tests

- Exact duration/frame count
- Audio/video synchronization
- Workarea start/end
- Fonts
- Captions
- Transparency where supported
- Variable-frame-rate input normalization
- Rotation metadata
- Missing/corrupt asset failure
- Cancellation
- Worker crash and retry
- 9:16, 1:1, 4:5, and 16:9
- 720p and 1080p
- Deterministic frame snapshot comparison

### 20.6 Storage lifecycle tests

- Unattached upload purges after 24 hours.
- Active project asset does not purge.
- Scheduled output does not purge.
- Live output purges after safety window.
- External cache purges while locator survives.
- Persistent asset survives age-based cleanup.
- R2 deletion failure retries and does not delete database tombstone.
- Orphan scanner finds unowned object.
- Shared/deduplicated object is not deleted while referenced.

### 20.7 Security tests

- Cross-workspace access denied.
- Signed URL expires.
- Sandbox cannot read Posterract cookies/storage.
- Authored code cannot navigate parent.
- Forbidden imports rejected.
- SSRF targets rejected.
- Oversized source/node graph rejected.
- Render worker cannot reach internal services.
- API logs redact credentials.

### 20.8 Load tests

- Concurrent multipart uploads
- Project autosave bursts
- Agent + human simultaneous writes
- Compile queue saturation
- One/two concurrent 1080p renders
- Temporal retry storm containment
- SSE connection count
- R2 signed URL issuance

## 21. Docker and VPS topology

### 21.1 Existing services retained

```text
gateway
web
api
orchestrator publishing worker
migrations
postgres
redis
elasticsearch
temporal-postgres
temporal
temporal-ui/tools
```

### 21.2 New services

```text
creative-compiler
creative-asset-worker
creative-render-worker
editor-sandbox static build/origin
```

For the MVP, compiler and asset activities may share one creative worker image/process if resource limits remain isolated. The Chromium render worker must remain separate.

### 21.3 Dockerfile targets

Add targets conceptually:

```text
creative-worker-runtime
creative-render-runtime
editor-sandbox-build
editor-sandbox-runtime
```

The render target includes Chromium and ffmpeg; the normal backend target stays small.

### 21.4 Networks

- API accesses PostgreSQL, Redis, Temporal, Elasticsearch, and R2.
- Compiler accesses PostgreSQL/R2 through domain services or scoped jobs; it does not need social credentials.
- Asset worker accesses R2, PostgreSQL, Redis/Temporal.
- Render worker should not join networks exposing PostgreSQL, Redis, Elasticsearch, or social services if capability-based job delivery can be used.
- Public traffic still enters only through Cloudflare Tunnel -> loopback gateway.
- Temporal UI remains Tailscale-only.

### 21.5 Resource planning gate

Before enabling hosted rendering on the existing VPS, record:

- Total/free RAM
- Current container working sets
- Swap availability and pressure
- Free disk and inode count
- CPU cores/load
- Chromium render memory for 15s, 30s, and 60s 1080x1920 projects
- Render real-time factor
- Concurrent upload and publishing impact

If one render threatens publishing reliability, move `creative-render-worker` to a second VPS and retain the same Temporal queue/API.

## 22. Implementation phases and exit gates

### Phase 0: technical proof

Deliverables:

- Mount a simple TSX composition in an isolated browser sandbox.
- Play an R2-hosted proxy through the runtime.
- Select and drag a text node.
- Convert the drag to a semantic operation.
- Apply the operation to TSX using an in-memory source writer.
- Recompile and remount.
- Render one 10-second composition in browser.
- Render the same composition in headless Chromium on a development machine/container.
- Compare representative frames.

Exit gate:

- Bidirectional source/UI round trip works.
- R2 media resolves.
- Headless render produces valid MP4 with synchronized audio.
- Sandbox cannot access host auth state.
- We have measured memory and render speed.

Do not build the full UI before this gate passes.

### Phase 1: project and revision foundation

Deliverables:

- PostgreSQL migrations for projects, revisions, revision files, operations, events.
- Contract types and validation.
- Project CRUD.
- Virtual file CRUD.
- Optimistic revision writes.
- Revision history/restore.
- API-key creative scopes.
- Basic project dashboard.

Exit gate:

- Human and API-key client can create a project, edit TSX, list history, and restore a revision without media.

### Phase 2: creative asset pipeline

Deliverables:

- `creative_assets` tables and project links.
- Uppy direct multipart creative upload.
- Redis session handling.
- R2 creative prefixes.
- Probe and metadata extraction.
- Editor proxy, thumbnail, filmstrip, waveform.
- Signed variant URLs.
- Asset library UI.
- Cleanup/tombstone workflow.

Exit gate:

- A large upload bypasses VPS, resumes, processes, previews, attaches to a project, and deletes correctly.

### Phase 3: compiler and runtime

Deliverables:

- Video JSX package.
- Runtime/reconciler integration.
- Source stamping.
- Server compiler with virtual filesystem.
- Bundle cache.
- Compile diagnostics.
- Last-good revision behavior.
- Asset dependency extraction.
- Isolated sandbox host protocol.

Exit gate:

- Code edits reliably redraw video compositions and invalid code does not destroy the last good preview.

### Phase 4: visual editor MVP

Deliverables:

- `/create/:projectId` editor.
- Canvas selection, move, resize, rotate, guides, safe zones.
- Layer tree.
- Timeline with seek/play, trim, split, reorder.
- Inspector for core nodes.
- Text editing.
- Undo/redo.
- Autosave and IndexedDB pending operation queue.
- Revision conflict UX.

Exit gate:

- A user can build and edit a polished short-form video without opening code, and every supported edit updates source.

### Phase 5: code editor and full round trip

Deliverables:

- Virtual file tree.
- Monaco/CodeMirror panel.
- Type definitions and autocomplete.
- Diagnostics.
- Code diff/history.
- Agent revision activity.
- Loop detach/unroll behavior.

Exit gate:

- A user can alternate between code and visual editing without source corruption.

### Phase 6: capture and hosted rendering

Deliverables:

- Capture-frame API.
- Browser local export.
- Dedicated render-worker image/service.
- Temporal render workflow/task queue.
- Progress, cancellation, retry.
- Output verification.
- R2 output retention.
- Capacity and admission control.

Exit gate:

- A committed revision renders identically enough in browser and server paths, survives worker retry, and never leaves temporary workspaces behind.

### Phase 7: agent and MCP editing

Deliverables:

- Hosted MCP endpoint.
- Editor resources/reference.
- Project/source/asset/inspect/capture/render tools.
- Companion local upload helper.
- Structured error contracts.
- API-key presets.
- SSE agent revision updates.
- Agent workflow examples and tests.

Exit gate:

- An external agent can create a project, upload footage, inspect it, write TSX, compile, capture, iterate, render, and return the output without human file manipulation.

### Phase 8: Composer integration

Deliverables:

- Output-to-media handoff.
- Composer navigation.
- Correct shared-object ownership.
- Publishing retention integration.
- API/MCP optional post creation.
- End-to-end status correlation.

Exit gate:

- Human and authorized agent can move a render into the existing Posterract publishing flow without re-uploading from a local computer.

### Phase 9: content formats and premium engine

Deliverables:

- Versioned template system.
- Required asset/text slots.
- UGC/slideshow/talking-head/listicle/product-demo templates.
- Premium effect manifests.
- Backend-only effect authorization.
- Template previews and discovery.

Exit gate:

- The existing MakeAIUGCVids content workflows can be expressed as templates within one editor rather than separate page-specific stores.

### Phase 10: hardening and beta

Deliverables:

- Quotas and billing hooks.
- Storage dashboard.
- Full security tests.
- Orphan reconciliation.
- Load/capacity tests.
- Operational runbooks.
- Beta flags and workspace allowlist.
- Migration/backout plan.

Exit gate:

- Rendering cannot destabilize publishing.
- Cleanup is proven.
- Cross-workspace isolation is proven.
- Failure states are recoverable and visible.

## 23. Exact build order inside the repository

Recommended order of repository changes:

1. Add `packages/video-protocol` with source, operation, asset, compile, render, and sandbox message schemas.
2. Add PostgreSQL migration for creative project/revision tables.
3. Add creative project domain module to API rather than expanding `server.js` indefinitely.
4. Add creative routes and scope checks.
5. Add revision/idempotency tests using existing API test patterns.
6. Add creative R2 upload domain module by extracting reusable pieces from current multipart implementation.
7. Add asset migrations/routes/tests.
8. Add creative asset Temporal workflows and dedicated worker entry.
9. Add proxy/thumbnail/waveform toolchain.
10. Add `packages/video-jsx`, runtime adapter, reconciler adapter, and source writer.
11. Add virtual filesystem compiler service.
12. Add editor sandbox build and strict host protocol.
13. Add `/create` dashboard and editor route.
14. Add asset library and upload.
15. Add canvas/layers/inspector.
16. Add timeline/transport.
17. Add visual operation persistence.
18. Add code editor/diagnostics/history.
19. Add SSE project events.
20. Add capture endpoints.
21. Add browser export.
22. Add render-worker Docker target and Compose service.
23. Add Temporal render workflow and admission control.
24. Add creative output model.
25. Add Composer handoff.
26. Add creative MCP/API surface.
27. Add templates and premium manifests.
28. Add quotas/storage reporting.
29. Add reconciliation/security/load suites.
30. Enable beta workspace flag.

## 24. Decisions to lock before implementation

Recommended defaults are already selected here, but these should be written as architecture decisions during Phase 0:

1. Canonical project representation: TSX source files, not a separate JSON timeline.
2. Runtime: adapt the Diffusion-style JSX/reconciler/runtime architecture.
3. UI framework: keep Posterract React; isolate runtime instead of converting the whole application to Solid.
4. Source writer location: authoritative server-side in-memory AST writer.
5. Preview: browser sandbox using proxies.
6. Human export: browser-first.
7. Agent/automation export: hosted render worker.
8. Binary store: private Cloudflare R2.
9. Source/metadata store: PostgreSQL.
10. Temporary operational state: Redis.
11. Durable jobs: Temporal with separate creative task queues.
12. Agent interface: hosted MCP + normal HTTP API using existing hashed API keys.
13. Publishing: existing Composer and `media_assets` pipeline.
14. Default asset policy: temporary project with explicit persistent/external-backed alternatives.
15. Code execution: separate origin/container with capability-based asset/output access.

## 25. Major risks and mitigations

### Risk: bidirectional code editing corrupts hand-written source

Mitigation:

- Stable IDs
- AST operations, not string replacement
- Round-trip fixture suite
- Visual edits limited to writable nodes
- Invalid source preserved with last-good preview
- Revision history and one-click restore

### Risk: arbitrary authored code compromises user accounts

Mitigation:

- Dedicated sandbox origin
- No auth cookies/secrets
- Module allowlist
- CSP and capability protocol
- Isolated render container
- No direct internal network access

### Risk: hosted rendering overwhelms the VPS

Mitigation:

- Separate worker and queue
- Concurrency 1 initially
- Admission control and quotas
- Browser local export
- Capacity spike before deployment
- Move worker to second VPS without API redesign

### Risk: R2 costs grow from forgotten projects

Mitigation:

- Temporary default
- Storage accounting
- Persistent quota
- Derived-cache expiry
- Durable deletion workflow
- Orphan reconciliation
- Browser local export

### Risk: agent overwrites a human edit

Mitigation:

- Expected revision IDs
- 409 conflict response
- SSE activity
- Actor-labelled revisions
- No silent same-file merge

### Risk: client and server renders differ

Mitigation:

- Same runtime and bundle
- Immutable render manifest
- Pinned versions/fonts/assets
- Fresh capture world
- Representative frame regression tests

### Risk: source media disappears after cleanup

Mitigation:

- Explicit retention mode shown in UI
- External-backed sources
- Relink workflow
- Seven-day post-publish safety window for temporary project inputs
- Persistent option with storage accounting

### Risk: one giant all-purpose API file becomes unmaintainable

Mitigation:

- Domain modules for projects, source, assets, compiler, renders, MCP
- Shared contracts package
- Separate worker entries
- Route registration functions

## 26. Definition of the first production-ready release

The first production release is complete when all of the following are true:

- User creates a project from a template or blank source.
- User uploads a large video directly to R2 with resumable multipart upload.
- Posterract generates a playable proxy and metadata.
- Project TSX mounts in an isolated preview.
- User can add/edit video, audio, image, text, captions, shapes, timing, and basic motion.
- Visual edits create valid source revisions.
- Code edits redraw the visual editor.
- Compile failures preserve source and last good render.
- Revision history identifies human and agent actors.
- External API-key agent can read/write source and assets.
- Agent can inspect footage, compile, validate, and capture frames.
- Agent can request a durable hosted render and disconnect.
- Renderer uploads final output to R2 and removes temporary files.
- User can locally export without uploading the final file.
- User or authorized agent can send hosted output to Composer.
- Existing social publishing continues unaffected under editor/render load.
- R2 retention deletes unattached and expired media correctly.
- No cleanup path removes a database row while silently leaving an unowned R2 object.
- Storage usage and render usage are measurable per workspace.
- Cross-workspace, sandbox, SSRF, and credential-isolation tests pass.
- Render worker failures retry without duplicating outputs or charges.
- Operational dashboards and runbooks exist.

## 27. Immediate next action

The next implementation action should be Phase 0 only: create an isolated technical spike proving the complete narrow vertical slice:

```text
PostgreSQL-backed index.tsx
 -> compile
 -> mount in isolated browser sandbox
 -> play one R2 video proxy
 -> visually move one text node
 -> write the move back to TSX
 -> compile again
 -> capture frames
 -> render a 10-second MP4 in headless Chromium
 -> upload result to an R2 test prefix
 -> delete the render workspace
```

That spike validates the hardest architectural assumptions before the team commits to the full Create-page UI.

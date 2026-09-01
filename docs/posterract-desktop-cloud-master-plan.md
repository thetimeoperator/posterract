# Posterract Desktop + Cloud Master Plan

Status: architecture decision and phased implementation plan
Date: 2026-08-29
Scope: Posterract desktop application, local creative projects, external code editors, local agents, local export, cloud authentication, billing, social connections, uploads, immediate publishing, scheduling, analytics, API keys, VPS compatibility, rollout, and rollback

## 1. Executive decision

Posterract will become a desktop-first product with a local-first creative editor and an unchanged cloud publishing control plane.

The authenticated desktop application will present the same Posterract product experience and visual system as the current web application. It will include Create, Compose, Calendar, Analytics, connected social accounts, API keys, billing, settings, and the remaining authenticated product routes.

The responsibility split is firm:

- Posterract Desktop owns creative project files, source footage, local assets, the visual canvas, the timeline, local compilation, local previews, local caches, local rendering, and local exports.
- The user's existing code editor owns the code-editing interface. VS Code, Cursor, Claude Code, Codex, or another editor opens the same local project folder that Posterract Desktop is watching.
- Posterract Cloud owns accounts, workspaces, subscription entitlements, social OAuth connections, encrypted platform tokens, publishing API keys, upload sessions, scheduled posts, immediate posts, Temporal workflows, provider publishing, retries, cleanup, analytics collection, and normalized analytics responses.
- Cloudflare R2 receives a finished export only after the user explicitly chooses **Post now** or **Schedule**. A normal local export does not upload anything.
- A successfully exported local file is never moved or deleted when it is uploaded. Posting and scheduling upload a copy of its bytes while the local export remains under the user's control.

This replaces the browser-first Create architecture selected in `docs/posterract-agent-video-editor-master-plan.md`. It does not replace or redesign the existing Posterract cloud publishing architecture.

## 2. Product contract

### 2.1 What the user experiences

Posterract opens as one desktop application with the existing Posterract navigation and styling.

The application contains:

- Home/dashboard
- Create and the video editor
- Compose
- Calendar and scheduled-post management
- Transmissions and per-platform publishing status
- Analytics
- Connected social accounts
- API keys and agent access
- Billing and settings

Create works locally. All cloud-backed screens call the existing Posterract API on the VPS.

### 2.2 Export choices

Every completed render first produces a normal file on the user's computer.

After a successful export, the application presents three actions:

1. **Done**
   - Keep the exported file locally.
   - Do not create an R2 upload.
   - Do not create a `media_assets` record.
   - Do not create a transmission.

2. **Post now**
   - Keep the local file.
   - Open Compose with the local export selected and publishing mode set to **Now**.
   - After the user confirms platforms, captions, and options, upload the file through the existing publishing multipart-upload flow.
   - Submit `POST /v1/posts` with the literal `scheduledFor: "now"` after multipart completion returns the ready `mediaId`.

3. **Schedule**
   - Keep the local file.
   - Open Compose with the local export selected and publishing mode set to **Schedule**.
   - After the user confirms platforms, captions, options, and time, upload the file through the same publishing multipart-upload flow.
   - Submit `POST /v1/posts` with the selected ISO-8601 schedule timestamp after multipart completion returns the ready `mediaId`.
   - Once the server returns `202`, Temporal owns the job and the desktop may close.

The application must never display a post as scheduled before both of these are true:

- multipart completion has returned a ready `mediaId`; and
- `POST /v1/posts` has returned an accepted transmission.

### 2.3 No built-in code editor

Posterract Desktop will not ship Monaco as a second code editor.

It will instead provide:

- Open project in VS Code
- Open project in Cursor
- Open terminal in project
- Reveal project folder
- Copy project path
- Configure preferred editor

The filesystem is the canonical synchronization surface. An optional editor extension may be added later for conveniences such as reveal-in-code, but it is not required for the source/canvas round trip.

## 3. Non-negotiable compatibility boundaries

The desktop migration must not rewrite or bypass the existing publishing system.

### 3.1 Protected API behavior

The following contracts remain compatible:

- `GET /v1/bootstrap`
- `GET /v1/accounts`
- `POST /v1/oauth/:provider/start`
- `POST /v1/oauth/:provider/complete`
- `POST /v1/oauth/facebook/select-page`
- `DELETE /v1/accounts/:provider`
- `GET /v1/analytics`
- `GET /v1/schedule`
- `POST /v1/uploads/multipart`
- `POST /v1/uploads/multipart/:uploadId/parts/:partNumber`
- `GET /v1/uploads/multipart/:uploadId/parts`
- `POST /v1/uploads/multipart/:uploadId/complete`
- `DELETE /v1/uploads/multipart/:uploadId`
- `POST /v1/posts`
- `GET /v1/posts`
- `GET /v1/posts/:id`
- `GET /v1/posts/:id/events`
- `POST /v1/posts/:id/duplicate`
- `POST /v1/posts/:id/reschedule`
- `POST /v1/posts/:id/cancel`
- `POST /v1/projections/:id/retry`
- Existing billing, API-key, agent-run, points, and skill routes

Additive desktop-authentication and handoff routes may be introduced. Existing request and response bodies must not be changed incompatibly.

### 3.2 Protected publishing behavior

Do not change:

- `parseCreatePost` validation semantics
- platform caption limits
- required `artifactId`
- required `Idempotency-Key`
- connected-account validation
- transmission and projection creation
- outbox insertion
- Temporal workflow IDs
- the `publicationWorkflow`
- provider-specific publish activities
- token refresh and encryption behavior
- retry categorization
- cancellation and rescheduling signals
- analytics indexing after publication
- media cleanup after terminal publication states

Desktop-originated posts may continue to use transmission source `ui` in v1. This avoids a database constraint change solely for client labeling. A future additive migration may introduce `desktop`, but it must not be required for launch.

### 3.3 Protected R2 behavior

Desktop publishing uploads use:

```text
purpose: publishing
uploads/{workspaceId}/{mediaId}/source.{extension}
```

Do not use the current `purpose: creative` upload path for ordinary local project media.

Do not change:

- signed-part URL generation
- multipart session storage in Redis
- `media_assets` lifecycle values
- unattached-upload cleanup
- R2 object ownership
- scheduled-media retention holds
- provider signed-download behavior

### 3.4 Protected OAuth behavior

Social provider secrets and tokens remain exclusively on the VPS.

Do not put the following in the desktop package, local project, local preferences, or renderer process:

- Meta app secret
- Threads app secret
- TikTok client secret
- YouTube client secret
- provider access tokens
- provider refresh tokens
- token-encryption keys
- R2 access key or secret
- internal API key

Provider exchanges, page selection, token encryption, refresh, revocation, and analytics access continue in the backend.

Provider redirect URIs should remain the already-configured Posterract HTTPS callback URLs. The desktop return is a second Posterract handoff after the cloud callback completes; it is not a new provider redirect URI.

### 3.5 Protected deployment behavior

The production cloud remains the Docker Compose stack on the VPS.

Do not:

- move cloud services into the desktop application;
- expose PostgreSQL, Redis, Temporal, or Elasticsearch publicly;
- add a second publishing worker on client machines;
- deploy Posterract to Vercel;
- replace the existing Cloudflare Tunnel/gateway topology for the desktop launch;
- make the desktop binary directly access databases or provider APIs.

## 4. Current-state inventory

### 4.1 Cloud stack already built

The current VPS stack includes:

- Caddy gateway
- React/Vite web application served by Nginx
- Fastify API
- PostgreSQL
- Redis
- Temporal
- publishing orchestrator worker
- Elasticsearch used by the current topology
- private Cloudflare R2 integration

This cloud stack remains the system of record for product and publishing state.

### 4.2 Publishing implementation already built

The current API already provides:

- authenticated workspaces and scoped API keys;
- Stripe entitlement enforcement;
- direct multipart R2 upload sessions;
- upload resume through part listing;
- media readiness and purge scheduling;
- idempotent post creation;
- one transmission fanning out into provider projections;
- durable outbox dispatch;
- Temporal scheduling, cancellation, rescheduling, and retries;
- provider publishing through the orchestrator;
- account- and publication-level analytics snapshots;
- normalized analytics responses.

The desktop must become another trusted client of these contracts rather than a new publishing implementation.

### 4.3 Current Create implementation

The current Create work is browser-first:

- React hosts the editor sandbox in an iframe.
- `apps/web/src/creative/bridge.ts` translates editor IPC-shaped messages into HTTP calls.
- PostgreSQL stores immutable creative source revisions.
- R2 stores creative assets.
- Monaco is embedded inside the editor sandbox.
- The browser bridge pretends to be the desktop bridge expected by the copied Diffusion-style editor.

### 4.4 Desktop-ready foundation already present

Useful pieces already exist:

- an editor sandbox with canvas, timeline, inspector, runtime, reconciler, and encoder;
- a typed `window.desktop` bridge contract;
- desktop-shaped project-host calls;
- a local `ProjectFS` abstraction;
- source stamping and AST write-back;
- a compiler that preserves the last good render;
- a CLI package derived from the upstream agent interface;
- a `build:desktop` target for the editor sandbox.

Missing pieces include:

- the actual Posterract Electron main process;
- a secure preload bridge;
- local project discovery and persistence wired to Posterract;
- desktop account authentication;
- local export orchestration integrated with the Posterract shell;
- direct local-file-to-R2 publishing upload;
- signed installers, notarization, updates, and release channels;
- desktop-specific end-to-end testing.

## 5. Target topology

```text
┌──────────────────────────────── User computer ────────────────────────────────┐
│                                                                               │
│  VS Code / Cursor / Claude Code / Codex                                       │
│                       ↕ normal filesystem                                     │
│  Local project folder                                                        │
│  TSX + manifest + local media links + local assets + local caches             │
│                       ↕ watch / compile / semantic write-back                 │
│  Posterract Desktop                                                          │
│  React product shell + isolated editor sandbox + local render/export          │
│                       │                                                       │
│                       │ HTTPS through desktop cloud client                    │
└───────────────────────┼───────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────── Posterract cloud ─────────────────────────────────┐
│ Fastify API                                                                  │
│ Auth + billing + social accounts + analytics + API keys                      │
│ Multipart publishing upload + posts API                                      │
│        │                    │                         │                        │
│        ▼                    ▼                         ▼                        │
│ PostgreSQL                 R2                      Temporal                    │
│ metadata/state     scheduled media bytes     durable publication workflows   │
│                                                       │                       │
│                                                       ▼                       │
│                                            Provider publishing activities     │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 6. Source-of-truth rules

There must never be two silently writable canonical stores for the same creative project.

### 6.1 Local project source

For desktop-local projects:

- the local project folder is canonical;
- TSX/TS/JSON/Markdown source files live locally;
- canvas edits commit to those local files;
- code-editor edits commit to those local files;
- Git may be used by the user, but Posterract does not require it;
- PostgreSQL does not act as the live filesystem;
- cloud creative revisions are not updated on every local edit;
- local project paths are not uploaded to Posterract analytics or metadata.

### 6.2 Cloud product state

PostgreSQL remains canonical for:

- users and workspaces;
- membership and roles;
- billing state;
- connected accounts and encrypted tokens;
- API keys and API audit logs;
- media assets uploaded for publishing;
- transmissions, projections, events, and attempts;
- analytics snapshots;
- points;
- desktop devices and desktop login grants introduced by this plan.

### 6.3 Binary storage

Local source media stays local unless the user explicitly requests an operation that needs cloud bytes.

R2 stores:

- publishing uploads after Post now or Schedule;
- temporary cloud-generated media when a cloud service is used;
- optional future backup/sync objects after explicit opt-in.

R2 does not receive:

- every local import;
- every local source clip;
- local caches;
- local proxies;
- a normal local-only export.

### 6.4 Current cloud creative records

Do not drop `creative_projects`, `creative_project_revisions`, `creative_project_revision_files`, `creative_operations`, or creative-asset records during the desktop migration.

They remain available for:

- current testers;
- one-time cloud-project export/import;
- rollback during the desktop beta;
- a possible future explicit cloud workspace mode.

They are not the default store for new desktop-local projects.

## 7. Local project format

### 7.1 Default layout

```text
Posterract Projects/
└── Product Launch/
    ├── posterract.json
    ├── package.json
    ├── tsconfig.json
    ├── index.tsx
    ├── src/
    ├── assets/
    ├── exports/
    ├── AGENTS.md
    ├── .gitignore
    └── .posterract/
        ├── types/
        ├── cache/
        ├── proxies/
        ├── thumbnails/
        ├── waveforms/
        ├── autosave/
        └── logs/
```

### 7.2 `posterract.json`

The project record should contain only portable, non-secret metadata:

```json
{
  "schemaVersion": 1,
  "projectId": "uuid",
  "displayName": "Product Launch",
  "entry": "index.tsx",
  "runtimeVersion": "posterract-video-1",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp",
  "defaultExport": {
    "width": 1080,
    "height": 1920,
    "frameRate": 30,
    "container": "mp4"
  }
}
```

Never place account tokens, Posterract API keys, provider tokens, billing information, or absolute user identity in this file.

### 7.3 Posterract authoring package

User and agent source should import Posterract-branded types:

```tsx
import { Video, Sequence, Clip, Text } from "@posterract/video";
```

The public authoring contract must not require users to import `@diffusionstudio/*`.

The desktop package supplies:

- runtime implementation;
- TSX and JSX runtime;
- TypeScript declarations;
- hover documentation;
- schemas and examples;
- compiler version compatibility.

For external editor intelligence, scaffold a managed `.posterract/types` package and map `@posterract/video` to it in `tsconfig.json`. The app updates this generated type package during explicit project-runtime upgrades. Do not require a global npm installation just to receive autocomplete.

### 7.4 Asset manifest

TSX should refer to stable logical asset identifiers, not raw absolute paths.

The manifest maps identifiers to local sources:

```yaml
version: 1
assets:
  - id: hero-footage
    mode: linked
    source: /Users/example/Videos/hero.mov
  - id: logo
    mode: project
    source: assets/logo.png
```

Import choices:

- **Link in place**: no copy; fastest; requires relinking if the original moves.
- **Copy into project**: copies into `assets/`; portable project folder; uses local disk.

The UI must clearly display which mode is active.

### 7.5 Cache rules

Everything inside `.posterract/cache`, proxies, thumbnails, waveforms, and generated preview bundles is disposable.

The app must be able to:

- rebuild caches;
- report cache size;
- clear caches without deleting project source or originals;
- exclude caches from Git by default;
- avoid watching cache writes as source changes.

## 8. Electron application architecture

### 8.1 Workspace additions

Add:

```text
apps/desktop/
  src/main.ts
  src/preload.ts
  src/ipc/
  src/projects/
  src/auth/
  src/cloud/
  src/uploads/
  src/updates/
  src/security/
  assets/
  forge.config.ts
  package.json
```

The existing `apps/web` remains the shared React product shell. The desktop build packages the same route components and design system rather than cloning them.

The existing `apps/editor-sandbox` remains the isolated visual runtime. It is packaged with the desktop application and loaded locally.

### 8.2 Shared UI requirement

The web and desktop must share:

- route components where platform capabilities allow;
- `@posterract/hyperkit` components;
- brand tokens and CSS;
- DTOs from `@posterract/contract`;
- cloud data stores and validation;
- Compose, Calendar, Analytics, Accounts, API Keys, Billing, and Settings behavior.

Do not maintain a separate desktop copy of those screens.

Platform-specific behavior lives behind typed adapters:

```text
CloudApiClient
  BrowserCookieCloudClient
  DesktopIpcCloudClient

CreativeProjectHost
  BrowserLegacyCreativeHost
  DesktopLocalProjectHost

FileExportHost
  BrowserDownloadHost
  DesktopFilesystemExportHost
```

### 8.3 Renderer and process boundaries

Use these boundaries:

- Electron main process: native windows, project roots, filesystem access, watchers, atomic writes, process launching, secure token storage, desktop cloud HTTP client, large-file multipart reader, deep links, updates.
- Preload: small typed allowlist only.
- React renderer: trusted packaged Posterract UI with no direct Node access.
- Editor sandbox: isolated local iframe/runtime with no direct Node access, no cloud tokens, and no unrestricted main-process API.
- Compilation worker/utility process: compile untrusted project source with an allowlisted module graph.
- Render worker/utility context: frame rendering and encoding away from the main process.

### 8.4 Do not load the production website with filesystem privilege

Package the desktop UI locally. Do not simply load `https://posterract.app` into a privileged BrowserWindow.

Remote content must never receive Node integration or unrestricted IPC access.

### 8.5 Custom protocol

Register a unique protocol such as:

```text
posterract://
```

Allowed hosts should be enumerated:

- `posterract://auth/callback`
- `posterract://oauth/complete`
- `posterract://billing/complete`
- `posterract://open/project`

Reject unknown hosts, unexpected parameters, oversized values, and non-HTTPS nested URLs.

## 9. Desktop authentication

The existing web app uses Better Auth browser sessions. A packaged desktop renderer should not copy browser cookies or store the user's publishing API key as its login mechanism.

### 9.1 Device authorization flow

Implement an additive Posterract desktop-device login:

1. Desktop generates:
   - a cryptographically random `state`;
   - a PKCE verifier;
   - an S256 PKCE challenge;
   - a local device identifier.
2. Desktop opens the system browser at a Posterract HTTPS authorization page.
3. The user signs in with the existing Better Auth web flow.
4. The web page displays the requesting device and asks for approval.
5. The server creates a short-lived, single-use authorization grant bound to:
   - user;
   - workspace;
   - device identifier;
   - PKCE challenge;
   - state;
   - expiration.
6. The browser redirects to `posterract://auth/callback?code=...&state=...`.
7. The desktop validates state and exchanges the code plus verifier.
8. The server returns a short-lived access token and rotating refresh token.
9. The refresh token is stored through the operating system's protected credential storage.
10. The app retrieves entitlement and workspace state from the existing API.

### 9.2 Additive database records

Add migrations for records equivalent to:

- `desktop_devices`
- `desktop_authorization_grants`
- `desktop_refresh_tokens`

Store hashes of grants and refresh tokens, not raw values.

Track:

- user and workspace ownership;
- device display name;
- platform and architecture;
- app version;
- created, last-seen, and revoked timestamps;
- refresh-token family and rotation;
- optional compromise/reuse detection.

### 9.3 Token rules

- Access token lifetime: short, initially about 15 minutes.
- Refresh tokens rotate on every refresh.
- Reuse of an already-rotated refresh token revokes the token family.
- Device revocation is available from Settings.
- Sign-out revokes the local device refresh token.
- Password reset and account security events may revoke all desktop devices.
- Entitlement is checked server-side on protected product routes exactly as it is now.

Use a token prefix distinct from existing `pr_` API keys so authentication middleware cannot confuse a desktop session with a user-created API key.

### 9.4 Desktop principal

Extend authentication internally with a principal such as `desktop_session` containing:

- user ID;
- workspace ID;
- role;
- device ID.

It receives the same interactive user permissions as a normal authenticated session. It is not an API key and must not be exposed through API-key management.

Billing routes that currently require an interactive session should accept a validated desktop interactive principal without weakening browser behavior.

### 9.5 Offline behavior

Allow a bounded offline editing grace period based on a signed entitlement receipt cached in protected application storage.

Offline mode may allow:

- opening local projects;
- editing local source;
- local preview;
- local export, according to the selected product policy.

Offline mode cannot allow:

- connecting accounts;
- cloud generation;
- API-key management;
- posting;
- scheduling;
- analytics refresh;
- billing changes.

The local project files remain the user's files regardless of subscription state.

## 10. Desktop cloud client

### 10.1 Do not expose refresh tokens to the renderer

The Electron main process owns refresh tokens and access-token renewal.

The renderer calls a narrow, validated cloud-request IPC layer. It does not receive the refresh token.

### 10.2 Cloud request allowlist

The desktop cloud client must:

- permit only the configured Posterract HTTPS API origin;
- reject arbitrary destinations;
- permit only recognized methods;
- cap JSON body and response sizes;
- add the desktop authorization header in main;
- add an app-version header;
- propagate request IDs;
- redact authorization and sensitive bodies from logs;
- implement timeouts and cancellation;
- return typed errors to the renderer.

Do not expose a generic `fetch(any URL)` IPC capability.

### 10.3 Shared client semantics

Refactor the current web request logic behind `CloudApiClient` without changing route contracts.

- Web implementation: cookies with `credentials: include`.
- Desktop implementation: main-process bearer authentication through IPC.

All route consumers continue using the same DTOs and application stores.

## 11. Social OAuth in the desktop app

### 11.1 Provider flow

1. Desktop calls existing OAuth start behavior through its authenticated cloud client.
2. Backend creates the provider state bound to the desktop workspace and device handoff.
3. Desktop opens the returned provider URL in the system browser.
4. Provider returns to the existing Posterract HTTPS callback URL.
5. The Posterract callback completes the provider exchange on the VPS.
6. Facebook Page selection, when required, occurs on the trusted Posterract callback page.
7. Backend stores encrypted provider tokens exactly as it does now.
8. The callback page deep-links `posterract://oauth/complete`.
9. Desktop refreshes `GET /v1/accounts`.

### 11.2 Compatibility rule

Do not change provider client IDs, client secrets, scopes, exchange code, token encryption, or publishing clients just because the UI is in Electron.

If a desktop-specific completion endpoint is needed, make it additive and use the same provider exchange functions. The existing browser callback and web connection flow must keep working throughout rollout.

### 11.3 Embedded browser prohibition

Do not collect provider credentials inside a custom embedded login form. Use the system browser and the existing trusted HTTPS callback pages.

## 12. Billing in the desktop app

The desktop uses existing billing catalog and subscription endpoints.

Flow:

1. Desktop calls `GET /v1/billing/config` and `GET /v1/billing/subscription`.
2. Checkout or portal creation remains server-side.
3. Desktop opens Stripe-hosted Checkout or Billing Portal in the system browser.
4. Existing Stripe webhooks update PostgreSQL.
5. A Posterract web return page deep-links `posterract://billing/complete`.
6. Desktop refreshes subscription state.

Do not put Stripe secret keys in the desktop application. Do not trust the deep link itself as proof of payment; refresh authoritative subscription state from the VPS.

## 13. Local project host

### 13.1 Project roots

The desktop remembers one or more project roots.

Default to a normal video/projects location with a visible first-run explanation. Allow the user to choose another folder.

Persist root bookmarks in application preferences, not inside the cloud account by default.

### 13.2 Project operations

Implement:

- create;
- open arbitrary folder;
- list;
- resolve by durable project ID;
- rename;
- duplicate;
- archive or move to OS trash;
- reveal in file manager;
- open in preferred editor;
- validate and upgrade project schema.

Deletion must use the operating system trash when practical and must never recursively delete an unresolved or broad path.

### 13.3 Atomic source writes

Source writes should:

1. resolve and validate the target under the project root;
2. read the current source hash;
3. apply a semantic AST edit against the expected base;
4. write to a temporary sibling;
5. flush and atomically rename;
6. mark the write origin so the watcher does not create a redundant remount;
7. update project metadata only after success.

### 13.4 External-editor conflicts

Every visual edit batch carries the source hash it was based on.

If an external editor saved first:

- re-read the current source;
- attempt to replay the semantic operation using durable node IDs/source locators;
- commit if unambiguous;
- otherwise stop and show a conflict;
- never overwrite the external save silently.

Conflict choices:

- Reload latest
- Compare
- Retry visual change on latest
- Save a recovery copy

### 13.5 Watcher rules

Watch source and manifest files with debouncing.

Ignore:

- `.git`;
- `node_modules`;
- `.posterract/cache` and other derived folders;
- `exports` by default;
- temporary atomic-write files;
- writes explicitly marked as originating from the visual editor.

Handle rename, delete, partial save, and editor safe-write patterns.

### 13.6 Last-good preview

When code fails to compile:

- keep the last successfully mounted preview;
- display that source revision/hash is newer than the preview;
- report file, line, column, and diagnostic;
- never replace the canvas with an unexplained black screen;
- do not write broken generated source over a previously valid source file.

## 14. Compilation and runtime isolation

### 14.1 Compiler

Compile local projects with the existing Posterract video compiler adapted for local filesystem inputs.

Allow only:

- Posterract video authoring packages;
- an approved SolidJS subset required by the runtime;
- approved deterministic utility packages;
- project-relative modules inside the project root.

Reject or isolate:

- arbitrary Node built-ins;
- child processes;
- filesystem access from composition code;
- unrestricted network access;
- dynamic imports outside the project;
- native modules;
- package paths escaping the project/runtime roots.

### 14.2 Execution boundary

Compiled project code must not execute in:

- Electron main;
- preload;
- the authenticated React shell;
- the cloud API.

It executes only inside the isolated composition runtime/render context.

### 14.3 Runtime compatibility

Each project records its runtime version. Desktop supports an explicit upgrade workflow:

- inspect required migration;
- create a local backup or Git commit recommendation;
- apply codemods;
- compile and verify;
- allow recovery if upgrade fails.

Do not silently rewrite a project to a new incompatible runtime on application launch.

## 15. Canvas, videos, and timelines

The locked Posterract model is:

```text
Local project
└── Infinite workspace
    ├── Video board A → Timeline A → Export A
    ├── Video board B → Timeline B → Export B
    └── Video board C → Timeline C → Export C
```

Rules:

- one top-level video board is one independently exportable video;
- every video board owns one timeline and work area;
- hooks, body sections, CTAs, clips, layers, sequences, and transitions live inside that video's timeline;
- top-level video boards do not automatically concatenate;
- top-level video boards do not nest;
- combining videos is an explicit operation that creates a new video;
- clicking any descendant activates its parent video and switches the timeline;
- the timeline header always identifies the active video;
- the project navigator shows all videos and their durations/aspect ratios.

User-facing language should use **Video** or **Video Board**, not Diffusion Studio's ambiguous top-level **Scene** terminology.

## 16. Local rendering and export

### 16.1 Export is local-first

The default export target is a real file selected by the user.

Options:

- choose directory;
- choose file name;
- choose video board;
- choose resolution/aspect ratio;
- choose frame rate;
- choose quality/bitrate preset;
- choose supported container/codec;
- remember preferred export directory per project;
- export one selected video or batch selected videos.

### 16.2 Write safety

Exports should:

- write to a temporary `.partial` file;
- report progress and estimated completion;
- support cancellation;
- close encoders and handles on cancellation;
- rename to the final file only after successful finalization;
- never overwrite an existing file without confirmation;
- preserve a failed partial only when useful for diagnostics and clearly label it.

### 16.3 Export record

Store export history locally, including:

- export ID;
- project ID;
- video board ID;
- source hash;
- output path;
- byte size;
- duration;
- dimensions;
- frame rate;
- codec/container;
- creation time;
- upload state and cloud `mediaId`, if later uploaded.

Do not send the local output path to the cloud.

### 16.4 Post-export screen

After export:

```text
Export complete
[Reveal file] [Play]

[Done] [Post now] [Schedule]
```

Done closes the workflow without network upload.

Post now and Schedule open Compose with the export selected. The upload begins only after final confirmation, is explicitly labeled, and never removes the local file.

## 17. Desktop publishing-upload adapter

### 17.1 Reuse the existing API

Use the current multipart sequence:

1. User confirms Post now or Schedule in Compose.
2. `POST /v1/uploads/multipart` with `purpose: "publishing"`.
3. Split the local file into upload parts using the same safe part-size policy as the web uploader.
4. Request signed part URLs.
5. Upload parts directly to R2.
6. Persist ETags and progress locally.
7. Resume by listing already uploaded parts.
8. Complete the multipart upload.
9. Receive/retain `mediaId`.
10. Submit the existing posts request with that `mediaId` as `artifactId`.

### 17.2 Large-file implementation

Read the file from Electron main or a dedicated utility process. Do not marshal a multi-gigabyte Blob through React renderer IPC.

The renderer receives progress events only:

- bytes uploaded;
- total bytes;
- part counts;
- current rate;
- estimated remaining time;
- paused/resumed/failed/completed state.

### 17.3 Upload persistence

Persist non-secret resume state locally:

- export ID;
- upload ID;
- media ID;
- local file fingerprint;
- part size;
- completed part ETags;
- start time.

Before resume, verify that the local file size and fingerprint still match.

If the Redis upload session expired, abort/restart cleanly and let normal cleanup remove the abandoned object/record.

### 17.4 Failure between upload and post creation

If upload completes but post creation does not:

- keep the local export;
- retain the ready `mediaId` locally for retry;
- show **Finish posting**;
- rely on the current unattached-media purge deadline;
- warn before the upload expires;
- do not create duplicate uploads on every retry.

### 17.5 Post request

Continue using:

```json
{
  "artifactId": "media UUID",
  "title": "...",
  "caption": "...",
  "hashtags": [],
  "platforms": [],
  "perPlatform": {},
  "scheduledFor": "now"
}
```

For a scheduled post, `scheduledFor` contains the selected ISO-8601 timestamp instead of the literal `"now"`. The desktop must call the same shared serializer as the web Compose screen so both clients produce the same request body.

Continue generating a stable idempotency key for every logical submission. A UI retry of the same submission must reuse its key until a definitive response is known.

## 18. Compose, Calendar, Transmissions, and Analytics

### 18.1 Compose

Reuse the existing Compose UI and validation.

Add a desktop entry mode that accepts:

- a completed local export;
- an already uploaded `mediaId`;
- an arbitrary local video chosen by the user.

If the input is local and has not been uploaded, Compose shows that upload is required only when the user confirms Post or Schedule.

### 18.2 Calendar

Calendar remains cloud-backed and uses the existing schedule/post routes.

Dragging a scheduled post continues to call reschedule. Cancel, duplicate, status, and retry continue through existing endpoints.

Closing the desktop has no effect on accepted schedules.

### 18.3 Analytics

Analytics remains cloud-backed and uses the existing normalized dashboard endpoint.

The desktop must not separately call YouTube, TikTok, Meta, or other provider analytics APIs. The backend and Temporal analytics refresh workflow remain responsible.

### 18.4 Connected accounts

The desktop account screen consumes the same account DTOs and status. Disconnect continues to call the existing revocation path.

### 18.5 API keys

User-created Posterract API keys remain cloud resources with existing scopes, hashing, auditing, rate limiting, and revocation.

Do not save a displayed API-key secret into a local project automatically.

## 19. Local agent and MCP architecture

### 19.1 Local CLI

Rename and productize the inherited CLI as a Posterract command, for example:

```text
posterract open
posterract context
posterract inspect
posterract capture
posterract render
posterract export
posterract media probe
posterract media filmstrip
posterract media waveform
posterract media transcribe
posterract logs
```

Do not expose inherited Diffusion branding in the user-facing CLI contract.

### 19.2 Local MCP server

The desktop app or a companion local service may expose a local MCP server.

Security rules:

- bind only to loopback;
- require a per-install secret or authenticated local handshake;
- do not listen on the LAN;
- show which agent is connected;
- allow the user to disconnect/revoke;
- scope tools by project;
- validate every path under the approved project/media roots;
- audit destructive or cloud-publishing actions locally;
- require explicit user confirmation for Post now or Schedule unless the user has intentionally granted an automation policy.

### 19.3 Agent edit loop

1. Agent reads `AGENTS.md` and Posterract type definitions.
2. Agent inspects project structure and media metadata locally.
3. Agent edits local TSX or uses structured MCP tools.
4. Watcher detects the save.
5. Compiler updates the canvas or returns diagnostics.
6. Agent captures representative frames and checks the timeline.
7. Agent repeats until accepted.
8. User exports locally.
9. Posting/scheduling is a separate cloud action.

### 19.4 Offline truth

A hosted agent cannot read local files or render local media while the user's computer is off.

A cloud MCP server may queue a request, but execution waits for the local desktop connector to return online. Do not market queued work as completed work.

Scheduled posts and analytics continue in the cloud while the desktop is offline because they do not depend on local project files after submission.

## 20. Electron security requirements

### 20.1 BrowserWindow baseline

Require:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- renderer sandboxing enabled;
- restrictive Content Security Policy;
- no arbitrary navigation;
- a strict `setWindowOpenHandler`;
- external URLs opened only after scheme/host validation;
- packaged local application content;
- current supported Electron version;
- hardened Electron fuses before release.

### 20.2 Preload API

Expose one method per allowed capability. Never expose raw `ipcRenderer`, a generic shell command, generic filesystem access, or generic network access.

Validate every message in both preload and main.

### 20.3 Filesystem validation

- Resolve real paths before privileged operations.
- Validate containment under project roots for source writes.
- Treat linked media outside a project as explicit read grants.
- Prevent `..`, path separator confusion, null bytes, reserved device names, and symlink write escapes.
- Use explicit file paths rather than shell interpolation.
- Launch external editors using argument arrays, not constructed shell commands.

### 20.4 Composition isolation

Treat local project code as untrusted even though it is on the user's machine. A malicious downloaded project must not gain Electron main-process privileges.

### 20.5 Secrets

Use OS-protected storage for desktop refresh tokens. Keep access tokens short-lived and in main-process memory when possible.

Never log:

- authorization headers;
- refresh tokens;
- provider codes;
- social tokens;
- signed R2 URLs;
- Stripe session identifiers;
- local project file contents unless the user explicitly exports diagnostics.

## 21. Desktop release architecture

### 21.1 Framework

Use Electron because:

- the editor runtime already targets Chromium;
- the inherited project host is Electron-oriented;
- WebCodecs and media behavior need a consistent browser engine;
- the existing bridge contract maps naturally to Electron main/preload;
- external editor and filesystem integration are first-class requirements.

### 21.2 Initial platform sequence

Recommended rollout:

1. macOS Apple Silicon internal build
2. macOS Intel/universal validation
3. Windows x64
4. Linux AppImage/deb
5. Additional architectures after telemetry and demand

Do not claim a platform is supported until local render, file watching, OAuth handoff, upload resume, and auto-update have been tested on it.

### 21.3 Signing and notarization

Before public distribution:

- macOS Developer ID signing;
- macOS notarization;
- Windows code signing;
- signed update metadata;
- checksums for downloadable artifacts;
- reproducible version identifiers;
- secure CI/release credentials isolated from runtime secrets.

### 21.4 Distribution

Use a dedicated downloads/update origin such as:

```text
https://downloads.posterract.com/
```

Prefer a separate R2 bucket or strictly separated release prefix and credentials from private user media.

The application should check an authenticated or signed release manifest containing:

- latest stable version;
- minimum supported version;
- platform and architecture artifacts;
- hashes/signatures;
- release notes;
- mandatory/optional update flag.

### 21.5 Version compatibility

Desktop sends:

- app version;
- platform;
- architecture;
- runtime version;
- API contract version.

The API should provide an additive desktop configuration endpoint that can report:

- minimum supported desktop version;
- latest version;
- disabled features;
- maintenance messages;
- compatible video runtime versions.

Keep at least the current and previous stable desktop API contract compatible during normal releases.

## 22. Database migration plan

All production database changes must be additive and idempotent.

### 22.1 Add

Add tables for desktop authentication/device management as described above.

Optionally add non-sensitive client metadata to audit events, such as desktop device ID and app version, without changing the existing API-key audit semantics.

### 22.2 Do not drop

Do not drop or destructively rewrite:

- creative project tables;
- media assets;
- transmissions;
- projections;
- provider sessions;
- OAuth states;
- social accounts/tokens;
- analytics snapshots;
- API keys/audit logs;
- billing tables;
- outbox events.

### 22.3 Migrations and rollback

- Migration scripts must apply cleanly more than once.
- Old web containers must continue running against the expanded schema.
- New nullable/additive columns must have safe defaults.
- Rollback means disabling desktop auth/routes and reverting API code; additive tables may remain unused.
- Never require a destructive down migration to restore the current web/API deployment.

## 23. API evolution plan

### 23.1 Additive desktop endpoints

Exact naming can be finalized in an API ADR, but the capabilities required are:

- begin desktop authorization;
- approve a device in the authenticated browser;
- exchange a single-use authorization grant with PKCE;
- refresh/rotate a desktop session;
- revoke the current desktop device;
- list/revoke desktop devices;
- read desktop compatibility/configuration;
- complete browser-to-desktop OAuth and billing handoffs safely.

### 23.2 Existing endpoint matrix

| Existing endpoint group | Desktop behavior | Backend business-logic change |
|---|---|---|
| Bootstrap | Same data | None |
| Accounts | Same DTOs | None |
| Social OAuth | System browser; same exchange | Additive return target only |
| Billing | System browser; same Stripe state | Additive return target only |
| Analytics | Same normalized response | None |
| Schedule/posts | Same calls and state machine | None |
| Multipart upload | Read local export; same API | None |
| API keys | Same cloud management | None |
| Agent runs/skills | Same cloud behavior | None |
| Creative projects | Not canonical for new local projects | Retain during migration |

### 23.3 Contract tests before refactor

Before adding desktop authentication, freeze tests for:

- authentication and entitlement outcomes;
- OAuth start/complete/page selection;
- multipart create/part-list/complete/abort;
- post-create request validation and idempotency;
- schedule listing;
- reschedule/cancel/duplicate/retry;
- analytics payloads;
- billing access;
- API-key scopes and rate limiting.

These tests become regression gates for every desktop-related API change.

## 24. Migration of existing browser creative projects

### 24.1 Preserve current testers

Keep the current web application and web Create route working throughout the desktop alpha.

Do not remove their projects or creative assets.

### 24.2 Import into desktop

Provide an explicit **Download/Open in Desktop** migration:

1. User selects a cloud creative project.
2. Server creates or streams a project archive containing source files and manifest.
3. Assets are downloaded only after user confirmation.
4. Desktop creates a local project folder.
5. Desktop rewrites cloud asset references into local logical manifest entries.
6. Desktop compiles and verifies the imported project.
7. User confirms the local copy is correct.
8. Cloud project remains archived/readable until its existing retention policy or explicit deletion applies.

### 24.3 No automatic two-way sync

After import, the local project is canonical. Do not keep silently synchronizing it with the cloud revision tree.

A future backup/sync product must use an explicit Git-like revision protocol with conflict semantics; it is outside the desktop v1 scope.

## 25. Phased implementation plan

Each phase has a release gate. Do not begin destructive cleanup before the desktop path has passed the end-to-end gates.

### Phase 0: architecture lock and regression baseline

Tasks:

- Approve this document as the replacement Create architecture.
- Record ADRs for local canonical source, Electron, external code editor, local export, and cloud-only publishing.
- Inventory current cloud routes and responses.
- Add missing API contract tests.
- Record production health and current web smoke-test results.
- Record current database migration checksum/state.
- Add feature flags for desktop authentication and desktop download messaging.

Exit criteria:

- Existing API, orchestrator, web, compiler, and schema tests pass.
- No production behavior changes.
- Protected compatibility boundaries are encoded in tests.

Rollback:

- Documentation/feature flags only.

### Phase 1: shared cloud client boundary

Tasks:

- Extract current web API calls into typed service interfaces.
- Keep browser cookie behavior unchanged.
- Add a desktop IPC implementation behind the same interface.
- Centralize request IDs, timeouts, DTO parsing, and error mapping.
- Keep all route components consuming the shared interface.

Exit criteria:

- Current web E2E tests pass unchanged.
- No desktop binary required yet.
- Network recordings show identical existing API requests from the web build.

Rollback:

- Restore direct web request implementation; no backend changes.

### Phase 2: Electron shell and security baseline

Tasks:

- Create `apps/desktop`.
- Package the local React shell and editor sandbox.
- Implement secure preload and typed IPC.
- Enforce navigation and permission policies.
- Register `posterract://` deep links.
- Add application logging with redaction.
- Add development and packaged build commands.
- Add basic crash recovery and single-instance behavior.

Exit criteria:

- Packaged app opens without loading remote UI code.
- Renderer has no Node globals.
- Security tests cannot read arbitrary files from injected renderer code.
- Current product shell renders with Posterract styling.

Rollback:

- Desktop build remains unreleased; cloud untouched.

### Phase 3: local project host

Tasks:

- Port/adapt the inherited Electron project host.
- Replace Diffusion names with Posterract public contracts.
- Implement project roots, create/open/list/rename/duplicate/trash.
- Scaffold project format and types.
- Implement manifest and linked/copied asset modes.
- Implement safe filesystem access and watchers.
- Implement atomic source writes and conflict detection.
- Wire editor sandbox bridge to the real local project host.

Exit criteria:

- New project survives app restart.
- External text edit redraws canvas.
- Canvas move rewrites TSX visible in VS Code.
- Concurrent save cannot silently overwrite work.
- Broken TSX leaves last good canvas visible with diagnostics.

Rollback:

- No cloud dependency; local alpha data can be exported as folders.

### Phase 4: external editor and local agent tools

Tasks:

- Preferred editor detection/configuration.
- Open in VS Code/Cursor/terminal.
- Productize Posterract CLI.
- Add local MCP server with loopback authentication.
- Add context, inspect, media, capture, compile, and logs tools.
- Add clear agent connection UI and revocation.

Exit criteria:

- VS Code and Cursor can edit the same project without extension installation.
- Claude Code/Codex can use local project files and receive compile diagnostics.
- MCP cannot access unapproved paths or cloud-post without required authorization.

Rollback:

- Local projects still operate visually without agent tools.

### Phase 5: local render and export

Tasks:

- Wire selected video board to a fresh capture world.
- Implement deterministic local encoding.
- Add export dialog and progress.
- Add atomic output writing and cancellation.
- Add local export history.
- Add Done/Post now/Schedule completion screen.

Exit criteria:

- Exported file plays in an independent media player.
- Duration, dimensions, frame rate, audio, and last frame are correct.
- Done results in zero cloud upload/API publishing calls.
- Cancel leaves no falsely completed file.

Rollback:

- Local project source remains intact; feature flag export if encoder issue appears.

### Phase 6: desktop device authentication

Tasks:

- Add idempotent device-auth migrations.
- Add system-browser authorization page.
- Add PKCE exchange, refresh rotation, revocation, and protected storage.
- Extend API authentication with desktop principal.
- Extend entitlement checks without changing API-key or browser-session paths.
- Add device management in Settings.

Exit criteria:

- Desktop login works without copying browser cookies.
- Revoked device immediately loses cloud access.
- Refresh-token replay revokes token family.
- Unpaid desktop user cannot access protected cloud product routes.
- Existing browser login and API keys behave identically.

Rollback:

- Disable desktop auth feature flag; additive tables remain.

### Phase 7: cloud product screens in desktop

Tasks:

- Connect Bootstrap/dashboard.
- Connect Accounts and social OAuth handoff.
- Connect Billing handoff.
- Connect Compose.
- Connect Calendar and Transmissions.
- Connect Analytics.
- Connect API Keys, Skills, and Settings.
- Preserve common UI components and routes.

Exit criteria:

- Side-by-side desktop and web screenshots demonstrate the same Posterract product design.
- Same workspace data appears in desktop and web.
- OAuth-connected account created from desktop appears in web and vice versa.
- Billing state is consistent.

Rollback:

- Disable individual desktop cloud routes; web remains available.

### Phase 8: export-to-post and export-to-schedule

Tasks:

- Implement main-process local-file multipart uploader.
- Add resume/pause/cancel.
- Reuse existing publishing upload endpoints.
- Preserve local export after upload.
- Hand completed `mediaId` to existing Compose logic.
- Reuse existing post creation and idempotency.
- Add finish-posting recovery for upload-without-transmission.

Exit criteria:

- Post now publishes through the existing worker/provider path.
- Schedule publishes after desktop is closed.
- Reschedule and cancel work from desktop and web.
- Retry behavior remains unchanged.
- R2 key matches existing publishing layout.
- Local file still exists after upload, publish, cleanup, and app restart.

Rollback:

- Disable Post/Schedule buttons in desktop; local export still works; web posting remains.

### Phase 9: migration and private alpha

Tasks:

- Add cloud-project download/import.
- Invite internal testers.
- Test real approved Meta/TikTok/YouTube account flows without altering provider config.
- Test scheduled publication with desktop offline.
- Collect opt-in logs and performance measurements.
- Repair platform-specific file watching, codec, and deep-link defects.

Exit criteria:

- All critical E2E journeys pass repeatedly.
- No publishing regression in web production.
- Imported cloud projects compile locally.
- Security checklist passes.

Rollback:

- Stop distributing alpha build; web/cloud remain unchanged.

### Phase 10: signed beta and staged rollout

Tasks:

- Sign/notarize installers.
- Configure signed auto-updates.
- Publish stable download page.
- Roll out by workspace allowlist/percentage.
- Keep web Create available during beta.
- Add minimum-version policy only after an update path is proven.

Exit criteria:

- Installer and updater succeed on clean machines.
- Desktop crash-free and upload-success targets meet release thresholds.
- Support/rollback runbooks are rehearsed.

Rollback:

- Halt update manifest, revoke affected build if necessary, direct users to web product, keep local project folders untouched.

### Phase 11: retire browser Create as the primary editor

Only after stable desktop adoption:

- change web Create to explain/download/open Posterract Desktop;
- keep cloud project export available;
- remove Monaco from the desktop editor path;
- retain legacy creative APIs until migration and retention obligations are complete;
- do not remove Compose, Calendar, Analytics, Accounts, or Settings from the web product unless separately decided.

Exit criteria:

- No active user is stranded with a cloud-only creative project.
- Desktop is stable on supported platforms.
- Legacy data has an explicit retention/export path.

## 26. Test plan

### 26.1 Unit tests

Desktop main:

- project path normalization;
- symlink/path traversal rejection;
- project identity persistence;
- atomic writes;
- watcher self-write suppression;
- external safe-write patterns;
- source-hash conflict detection;
- project scaffold and upgrade;
- asset manifest resolution;
- local export record persistence;
- upload resume fingerprints;
- deep-link validation;
- IPC schema validation;
- token redaction.

Compiler/runtime:

- Posterract starter compilation;
- multi-file TSX imports;
- Posterract type contract;
- durable IDs and source locators;
- canvas edit to TSX;
- external TSX edit to canvas;
- last-good bundle;
- forbidden import rejection;
- one timeline per video board;
- no nested top-level videos;
- independent exports for multiple video boards.

Cloud:

- existing API tests unchanged;
- desktop grant PKCE validation;
- single-use grants;
- refresh rotation/replay;
- device revocation;
- entitlement enforcement;
- desktop OAuth handoff binding;
- desktop billing handoff binding.

### 26.2 Integration tests

- fixture project folder opened by desktop host;
- simulated external save triggers one compile;
- visual drag creates one semantic source commit;
- visual and external edits conflict safely;
- linked asset loads without copy;
- copied asset remains after original moves;
- missing linked asset presents relink UI;
- render from fresh capture world matches preview checkpoints;
- local file multipart upload resumes after process restart;
- completed upload is reused for a retried post submission.

### 26.3 End-to-end journeys

1. Sign in, create local project, edit visually, export, Done, verify no upload.
2. Open project in VS Code, change text, see canvas and timeline update.
3. Ask local agent to edit, inspect diagnostics, export.
4. Export, Post now, observe live projection.
5. Export, Schedule, close desktop, observe cloud publication at scheduled time.
6. Schedule, reschedule from web, observe desktop refresh.
7. Schedule, cancel from desktop, verify Temporal and media state.
8. Connect Instagram/Facebook/Threads from desktop through system browser.
9. Connect TikTok/YouTube from desktop through the unchanged provider backend.
10. Refresh Analytics in desktop and compare with web response.
11. Start upload, terminate app, restart, resume.
12. Complete upload, lose network before post creation, recover with Finish posting.
13. Revoke desktop device in web settings and verify immediate denial.
14. Import an existing cloud creative project and compile locally.

### 26.4 Security tests

- XSS in React renderer cannot read arbitrary files.
- Malicious project TSX cannot access Electron APIs.
- Malicious asset name cannot escape project root.
- Custom protocol rejects attacker-controlled external URLs.
- Renderer cannot call arbitrary API origins.
- Social tokens never appear in desktop storage/logs.
- R2 credentials never ship in desktop bundle.
- Refresh tokens are absent from renderer memory/devtools.
- MCP refuses LAN clients and unapproved roots.
- Auto-update rejects unsigned or hash-mismatched artifacts.

### 26.5 Platform matrix

For every supported OS/architecture test:

- installation;
- first launch;
- sign in/deep link;
- project folder permissions;
- file watching under common editors;
- media decoding;
- preview audio;
- local encoding;
- export path handling;
- multipart upload;
- sleep/wake;
- update;
- uninstall without deleting user projects.

## 27. Observability

### 27.1 Cloud metrics

Track desktop requests without collecting creative source:

- app version;
- platform/architecture;
- authentication success/failure category;
- upload start/resume/complete/abort;
- post acceptance and API error category;
- schedule acceptance;
- desktop OAuth handoff success/failure;
- desktop billing handoff success/failure.

### 27.2 Local metrics

Keep detailed project/compiler/render logs local by default.

Offer an explicit diagnostics export with:

- app/runtime version;
- platform information;
- sanitized logs;
- compiler diagnostics;
- render failure summary;
- no source/media unless separately and explicitly selected.

### 27.3 Health gates

Monitor existing cloud service health independently of desktop releases:

- API readiness;
- R2 connectivity;
- Redis;
- Temporal;
- orchestrator;
- PostgreSQL;
- analytics workflow;
- outbox backlog;
- multipart abandonment;
- publication failure categories.

## 28. Performance plan

Measure before setting final budgets.

Track:

- cold and warm app start;
- project scan time;
- external save to visible preview latency;
- visual edit to atomic source commit latency;
- timeline interaction frame rate;
- proxy generation time;
- render frames per second;
- peak memory during render;
- local disk cache growth;
- upload throughput and resume time.

Never trade source safety for lower latency. Pointer movement may update the in-memory canvas immediately while one semantic operation commits at interaction end.

## 29. Risk register

### Risk: desktop and web UI diverge

Mitigation:

- shared React routes/components/tokens;
- platform adapters only at capability boundaries;
- screenshot/visual regression tests.

### Risk: external editor overwrites canvas edit

Mitigation:

- base source hashes;
- semantic rebase;
- atomic writes;
- explicit conflict UI;
- recovery copies.

### Risk: local project code compromises desktop

Mitigation:

- no Node integration;
- isolated compiler/runtime;
- import allowlist;
- narrow IPC;
- path validation;
- security testing.

### Risk: OAuth approval is disturbed

Mitigation:

- keep provider credentials, redirects, exchange, scopes, tokens, and API calls on the VPS;
- use existing HTTPS callbacks;
- make desktop return an internal handoff only;
- update compliance materials before public desktop release.

### Risk: a scheduled post depends on a sleeping desktop

Mitigation:

- accept a schedule only after upload completion and server `202`;
- Temporal remains authoritative;
- desktop is not part of the publication workflow.

### Risk: local files are lost

Mitigation:

- visible normal folders;
- optional Git guidance;
- autosave/recovery copies;
- OS trash;
- future explicit backup, not silent cloud dependence.

### Risk: user expects hosted agent work while computer is off

Mitigation:

- honest product copy;
- queue remote requests;
- show waiting-for-device state;
- keep cloud schedules and analytics independent.

### Risk: local rendering differs by OS

Mitigation:

- Electron's consistent Chromium runtime;
- supported codec matrix;
- per-platform fixtures;
- fresh capture world;
- optional future hosted render, explicitly selected.

### Risk: local export upload duplicates bytes

Mitigation:

- persistent export/upload state;
- file fingerprint;
- multipart resume;
- reuse completed `mediaId`;
- idempotent post request.

### Risk: cancellation deletes local export

Mitigation:

- local export and cloud upload are separate records;
- cloud cleanup owns only R2 object;
- never link R2 deletion to local filesystem deletion.

## 30. Release and rollback runbook

### 30.1 Before each desktop release

- Run workspace typechecks/tests.
- Run API compatibility suite.
- Build signed installers.
- Verify signatures and hashes.
- Install on clean machines.
- Run local-only export test.
- Run real staging upload and schedule test.
- Close desktop before scheduled time.
- Verify Temporal publication.
- Verify analytics/cloud routes.
- Verify update from previous stable version.

### 30.2 Cloud deployment ordering

For additive desktop cloud support:

1. Back up PostgreSQL.
2. Apply additive migrations.
3. Deploy API with desktop endpoints disabled.
4. Run web/API regression suite.
5. Enable desktop auth for internal workspace.
6. Release internal desktop build.
7. Expand allowlist gradually.

Never make an unreleased desktop version mandatory for current web users.

### 30.3 Emergency rollback

If desktop authentication fails:

- disable desktop auth feature flag;
- keep browser sessions/API keys working;
- leave device tables intact.

If desktop upload fails:

- disable desktop Post/Schedule actions;
- keep local export enabled;
- direct users to existing web Compose if necessary;
- do not change backend upload logic under pressure without reproducing the failure.

If desktop release is unsafe:

- stop serving it in the update manifest;
- publish a signed rollback/fixed build;
- keep cloud services and web application running;
- never delete local project folders during rollback.

## 31. Definition of done

The desktop architecture is complete only when all of the following are true:

- The desktop app uses the same Posterract visual design and shared product screens as the web app.
- A project is a normal local folder.
- VS Code/Cursor/Claude Code/Codex edits redraw the canvas.
- Canvas/timeline edits safely rewrite local TSX.
- Monaco is not required.
- Multiple video boards each have their own timeline/export.
- A normal export creates a local file and makes no cloud upload.
- Post now uploads through the existing publishing multipart API and existing post API.
- Schedule uploads through the same API and publishes after the desktop is closed.
- The local export survives R2 cleanup and app uninstall.
- Existing web posting, scheduling, OAuth, analytics, billing, and API-key flows still pass regression tests.
- Provider secrets and social tokens never ship to the desktop.
- Desktop refresh tokens are protected and revocable.
- Current web testers and cloud creative projects have a safe transition path.
- Installers are signed, updates are verified, and rollback is rehearsed.

## 32. Immediate next implementation sequence

The first engineering sequence should be:

1. Freeze existing API behavior with missing contract tests.
2. Add the typed browser/desktop `CloudApiClient` boundary without changing web requests.
3. Create the secure Electron shell and package the existing Posterract UI.
4. Restore/adapt the local filesystem project host behind the existing editor bridge.
5. Remove Monaco from the planned desktop path and add Open in Editor actions.
6. Prove the bidirectional local TSX/canvas round trip.
7. Prove a deterministic local export that performs no network request.
8. Add desktop device authentication.
9. Place existing cloud screens inside the authenticated desktop shell.
10. Reuse the existing multipart publishing upload from a local file.
11. Reuse existing Compose and `POST /v1/posts` for Post now/Schedule.
12. Close the desktop and verify the existing Temporal workflow publishes the scheduled video.

That final test is the architecture's decisive proof: local creation and export, cloud-owned scheduling and publishing, with no duplicated social API implementation.

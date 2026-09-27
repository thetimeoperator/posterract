# The hero is the editor

Status: plan, Sep 13 2026. For the product mode of the landing page. Nothing built yet.

## The rule

No mini version. The hero embeds the real editor build — the same bundle the desktop app runs — playing a real project, edited live by a scripted agent session that goes through the same API real agents use. Three things in one frame: the agent's chat, the canvas changing, the source changing next to it.

## Why it is possible now (what the codebase already has)

| Fact | Where | What it gives us |
|---|---|---|
| The editor is a standalone Vite app that builds to a browser bundle: 2.2 MB JS, 115 KB CSS, its own fonts. CanvasKit (8 MB) is only for Lottie and can be left out. | `apps/editor-sandbox`, `dist/` | The real editor can be served as static files by the web app at `/editor-demo/`. |
| The web app already embeds the editor in an iframe and relays its bridge traffic over `postMessage` (`posterract-editor-bridge` main:request / main:response, `posterract-cli-request`). | `apps/web/src/routes/_app/create.tsx`, `apps/editor-sandbox/src/lib/ipc.ts` | The landing page can be the editor's host the same way, answering the handful of "desktop main" calls a project session needs, from memory instead of disk. |
| Agent edits are functions on the editor session: `canvasSetProperties`, `canvasCreate`, `canvasSetText`, `canvasSeek`, `canvasSelect`, `canvasBake`, `canvasMove`, undo/redo. The MCP tools are thin wrappers over them. | `apps/editor-sandbox/src/context/agent-api/canvas.ts` | The demo's chat can make real edits with the real code path. |
| Every world edit is reported back as JSX edits and written to the project's `index.tsx` by the editor itself (`getDocumentEditor` → `writeProjectSource`). | `apps/editor-sandbox/src/engine/editor.ts` | The code tab can show the actual source, changing as the agent works, without a compiler in the browser. |
| The compiler is Babel + esbuild (Node). The editor mounts a compiled bundle and only recompiles when the source is rewritten from outside. | `packages/video-compiler`, `apps/editor-sandbox/src/pages/editor.tsx` | The demo project is compiled at build time; the hero never compiles in the browser. |
| The runtime has real effects (brightness, contrast, saturate, hue, sepia, grayscale, blur, shadow) and real diagram elements (node, arrow, axis, plot, equation, callout, with draw-on reveal). | `packages/posterract-video-runtime/src/constants.ts`, `packages/posterract-composition/src/types.ts` | "Change the color grade" and "make a diagram of this" are edits the engine can actually perform. There is no 3D element; see the note at the end. |

## What the visitor sees

The hero copy stays as it is (kicker, title, lede, buttons). Under it, the full width of the container, a 760px-tall frame: the editor. Not a picture. The command bar, the floating assets and inspector panels, the infinite canvas on the green-and-black ground, the timeline dock, the HUD, and two panels that are new to the editor and real in the product:

- **Agent**, docked bottom-left: a chat. In the hero it plays a scripted session: a prompt is typed, the agent answers in one line, and its tool calls appear as chips (`set_properties`, `create_element`, `seek`). Each chip fires the real function.
- **Source**, a tab on the right: the project's `index.tsx`, syntax-lit, changed lines flashing as the writer updates them.

The session, about 40 seconds, then it loops:

1. "Warm up the color grade on the interview." → `set_properties` on the clip: brightness, contrast, saturation, a touch of sepia. The clip visibly changes; the effect lines appear in the source.
2. "Punch in on the speaker at the hook." → scale keyframes on the clip. The canvas zooms; the keyframe track appears.
3. "Title it 'The line that matters', bottom third." → `create_element` text. The title lands; the `<text>` element appears in the source.
4. "Make a diagram of the three numbers he mentions." → `create_element` axis + plot; the plot draws on.
5. "Make it 9:16 for TikTok." → the scene is resized and the camera refits.

The visitor can click into the editor and move things; nothing persists. Two suggested prompts sit under the chat as chips; typing a prompt of your own shows "Connect your agent to run this" with the launch CTA, because there is no model behind the landing page and we don't pretend there is.

Until the editor is ready the frame shows a still of the same scene; the iframe loads only when the hero is near the viewport. Under 900px wide the frame plays a screen recording of the same session (real footage of the real editor), because the full editor at phone width is not usable.

## The work

| # | Piece | Where | Size |
|---|---|---|---|
| 1 | **Embedded bridge.** When the editor runs without `window.desktop` inside an iframe, `mainBridge` and `cliBridge` speak `postMessage` to the parent (the protocol `create.tsx` already speaks). | `apps/editor-sandbox/src/lib/ipc.ts` | small |
| 2 | **Browser project host.** The landing page answers the project session's channels from memory: resolve/get project, source read/write/locate, compile (returns the prebuilt bundle), fs list/stat/file for the assets, manifest and config read, watch/unwatch, history, and harmless empties for skills, exports, keys, agent status. | `apps/web/src/marketing/hero-editor/host.ts` | medium |
| 3 | **Demo project.** One scene, one of the founder's clips, a title, packaged with its `index.tsx`, manifest and a bundle compiled at build time by the same script that builds the web app. | `apps/web/src/marketing/hero-editor/project/`, `apps/web/scripts/build-hero-project.mjs` | small |
| 4 | **Source panel.** A real editor panel: the open file, highlighted, live, changed lines flashing. Shown in the hero; available in the product. | `apps/editor-sandbox/src/components/sidebar-right/source-panel.tsx` | medium |
| 5 | **Agent chat + director.** A real editor instrument: the chat surface, tool-call chips, and in demo mode a director that runs the script above through the session functions on a timeline (time-based, so a background tab never falls behind). | `apps/editor-sandbox/src/components/shell/agent-chat.tsx`, `src/demo/director.ts` | medium |
| 6 | **Hero embed.** The frame, the poster, lazy loading, the mobile recording, the reduced-motion state. | `apps/web/src/marketing/HeroEditor.tsx`, styles in `landing-two-mode.css` | small |
| 7 | **Build.** The web build also builds the editor with `--base /editor-demo/` into `public/editor-demo/`, without CanvasKit; the Docker build does the same. In dev the hero points at the editor dev server on 5175. | `apps/web/package.json`, `apps/web/Dockerfile` | small |

Order: 1 → 2 → 3 → 6 (the editor appears in the hero, playing the project, no chat yet: first thing to look at), then 4 → 5 (the session), then 7 and the mobile recording.

## Honest notes

- **"3D diagram."** The runtime has no 3D element. What it has is the diagram family (nodes, arrows, axes, plots, equations, callouts) and WebGPU shader paints. The demo uses the diagram family. A 3D element is a runtime feature, a separate decision.
- **Weight.** About 3.5 MB for the editor plus one clip, loaded only when the hero is on screen, after the page has painted. The landing page's own bundle does not grow.
- **What it is not.** No model runs on the landing page. The chat plays a script through real tools. The page says so in one line under the chat.

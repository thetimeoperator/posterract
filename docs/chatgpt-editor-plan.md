# ChatGPT in the editor: replacing Jev

Research and build plan, September 30, 2026. Sources are OpenAI's own pages
unless marked otherwise:

- Help Center, "Using your ChatGPT plan in other apps and sites" (article 20001542)
- Sign in with ChatGPT developer docs at developers.openai.com/siwc (quickstart, request a client ID, open-source overview, registration and sign-in, accounts and sessions, models and inference, Codex app-server, token reference, errors and recovery, preview limitations, UI/UX guidelines)
- The OpenAI cookbook article on integrating Sign in with ChatGPT in an open-source app
- The GPT-6.1 Sol model page
- The interest form at openai.com/form/sign-in-with-chatgpt-interest

## 1. What OpenAI launched

On September 29, 2026, at DevDay, OpenAI launched **Sign in with ChatGPT**. It has two parts:

- **Identity.** A user signs in to an app with their ChatGPT account. The app gets their name, email and profile picture.
- **Plan usage** (OpenAI also calls it token sharing). A ChatGPT **Plus or Pro** user lets the app run AI requests on their ChatGPT plan. The requests count toward the ChatGPT Work and Codex usage in their plan. The app needs no OpenAI API key, and nobody pays the API bill.

What the user controls, in ChatGPT under Settings → Usage:
- A weekly cap per app, as a percentage of their plan.
- An opt-in that lets apps spend ChatGPT credits once the plan runs out. It is off by default.
- Disconnecting an app, under Settings → Security and login.

Limits by plan:
- **Plus:** one 5-hour usage window, shared across every app that uses the plan.
- **Pro:** no 5-hour limit.

The app never sees the user's conversations or memories.

### Who may offer it

This is the gate that matters for Posterract.

- **Plan usage today:** open-source projects, personal projects that run locally, and "selected private apps".
- **A paid or remotely hosted app** has to join a waitlist through the interest form before offering it to users. Commercial client IDs are handed out to a select group of partners in a limited trial.
- **Launch partners using plan usage:** Amp Code, Conductor, Dactyl, Devin, Hermes Agent, Hyperagent, Kilo Code, Notion, Vercel, Vorflux, Warp, with Lovable coming soon.
- **Sign-in only:** Airtable, Canva, GitLab, HubSpot, Supabase.
- **Open-source integrations:** OpenClaw, OpenCode, Pi, T3.

**Posterract is a paid app, so it needs OpenAI's approval before customers can use it.** The founder applies through the interest form. We can build and test now: a personal project running locally is allowed. It ships to users once OpenAI approves.

The interest form asks for:
- Work email, first and last name, company, website, job title.
- Capabilities: "Sign in only" or "Sign in and ChatGPT plan use for AI requests". Pick the second.
- A short description of each product that would use it.

## 2. How it works technically (open-source flow, public docs)

### Sign-in (OAuth with PKCE, system browser, loopback callback)

- Authorize at `https://auth.openai.com/api/accounts/authorize`.
- The first sign-in uses `client_id=dynamic_agent_client`, with:
  - `agent_name_hint=Posterract`
  - a persisted per-machine `ext_agent_host_id`, e.g. `urn:uuid:…`
- The callback returns an issued `client_id` (`oaiapp_…`). Save it and reuse it for every later sign-in.
- Scopes: `openid profile email`, plus `offline_access resource.invoke chatgpt.tokens.use.direct` for plan usage.
- Resource: `https://api.openai.com/v1`.
- Redirect: `http://127.0.0.1:<port>/auth/callback`. Only the port may vary; `localhost` is not accepted.
- Exchange the code at `https://auth.openai.com/api/accounts/oauth/token`. There is no client secret.
- Validate the ID token against OpenAI's JWKS (issuer, audience, nonce, expiry).
- Plan usage is on only if the granted scopes include `chatgpt.tokens.use.direct`.
- Tokens:
  - The access token lasts 1 hour.
  - The refresh token lasts 30 days and rotates on every refresh.
  - Serialize refreshes so two processes never race a rotating token.
- Sign-out revokes the refresh token at the endpoint listed in OpenAI's openid-configuration.
- Store credentials in owner-only local storage. Never put them in logs, URLs or browser storage.

### Inference

- **Endpoint:** `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access token>`.
  - Every request must set `store: false` and `stream: true`.
  - Only this public endpoint is allowed, never ChatGPT's backend endpoints.
- **Models:** `GET /v1/models` with the same token returns the models available to that account.
  - OpenAI's example uses `gpt-6.1-sol`.
  - Per its model page, GPT-6.1 Sol has a 1.05M-token context, text and image input, function calling, structured outputs, streaming, and reasoning effort from low to max.
- **Tools:** function and custom tools are supported. On this route they are grouped in `namespace` tools (or supplied through `additional_tools`).
- **Not supported on this route:**
  - Tools: image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, tool search.
  - Inputs: audio and video, the Files upload API, and the transcription API.
  - Request fields: `temperature`, `top_p`, `max_output_tokens`, `previous_response_id` (send the full history in `input` instead), `metadata`, `truncation`, `user`, `prompt`, `background`, `conversation`, and a few more. Put instructions in `instructions` or developer messages; system-role items are rejected.
- **Supported inputs:** text, images and files, when the model accepts them.
- **Errors:**
  - `subscription_sharing_usage_limit_exceeded` (429): show "Usage limit reached" with **Manage usage** as the main action.
  - `subscription_sharing_user_not_eligible` (403): the user is not on Plus or Pro, or policy blocks them.
  - `subscription_sharing_unsupported_capability` (400): remove what `error.param` names.
  - A request that fails is never quietly moved to another billing path.
- **Codex app-server:** OpenAI documents running `codex app-server` with this token as a Responses provider. We don't need it: Codex brings its own shell/MCP agent runtime, while a direct Responses loop keeps the canvas tools in our hands.

### Required UI (OpenAI's guidelines)

- The button reads **Continue with ChatGPT**, with OpenAI branding, next to our other sign-in options.
- A one-time welcome modal: "You're using your ChatGPT plan" with a "Got it" button.
- **"Using ChatGPT plan"** plus a **Manage usage** link near the command bar or model picker.
- A usage-limit modal whose main action is Manage usage.
- The pricing page must say which Posterract plans support "Use your ChatGPT plan".

## 3. How Jev runs in the editor today

- **The bar:** `VoiceBar` (`apps/editor-sandbox/src/components/shell/voice-bar.tsx`). ⌘K to type; hold Q (or ` or G) to talk.
- **Instant path, no model:** exact phrases (`EXACT_INTENTS`) and a fuzzy command-name match (`lib/command-match.ts`).
- **Everything else goes to Jev:** `resolveIntent` (`context/agent-api/intents/resolve.ts`) sends:
  - one "which areas" request;
  - up to three per-area requests;
  - an optional "which elements" request.

  Each request goes to OpenRouter's `api/alpha/decisions` (`typesafe/jev-1.13-20260917`). The call is made from Electron main by `decide()` in `apps/desktop/src/ai-local.ts`, with the `openrouter` key. Jev only picks from the options it is shown; code fills in the numbers, colours and times.
- **The catalog:** 139 intents in 10 areas, with 145 slots. Their run functions do the work, and each sentence is one undo step. The honesty check reports "nothing changed" instead of a false "done".
- **Voice to text:** a Groq Whisper (or xAI) key. This stays: the ChatGPT-plan route has no transcription.
- **Last Jev corpus run (Sep 19):** 146 sentences. 51 were right and 2 were wrong but applied without asking. 68 hit request errors when the OpenRouter credit ran out.

## 4. Can ChatGPT do everything on the canvas?

**Yes, and far more than Jev.** Jev can only pick from lists. ChatGPT (GPT-6.1 Sol on the user's plan) has function calling and image input, so it uses the editor through its tools the same way Claude and Codex do today. It can:

- **Take any sentence, including multi-step ones.** "Make a 15-second intro: title flies in, logo fades up at 3 s, lower third at 5 s" becomes a plan and a chain of tool calls.
- **Create and edit anything:**
  - shapes, text, scenes, media, masks, adjustment layers;
  - any property, keyframes, animations, effects, blend modes, timing (split, trim, move, slip, slide, speed), captions, audio.
- **Write and edit the TSX source directly** (`read_source` / `edit_source` / `write_source`). This covers what no intent can: html, shader and surface elements, diagrams, custom motion code.
- **Invent content:** titles, captions and copy. It also does the maths and layout that Jev had to leave to code.
- **See its work.** A render of the canvas goes back to it as an image: the live canvas via `engine.snapshot()`, shrunk to a ≤1536 px JPEG by `toReferenceImage`, or `capture` contact sheets. It then checks and fixes its own edit, the way Claude/Codex do now.
- **Use Posterract's own tools:** inspect, geometry, check, lint, media grab, filmstrip, waveform, beats, transcribe, and image/video/voice generation. Generation runs on the user's own keys.

What it can't do:
- **Through this route:** generate images itself, or hear audio or watch video directly. Our own tools cover these: the generate tools, filmstrip frames as images, and transcripts as text.
- **Things no tool reaches yet.** Nothing in the editor exposes these to any agent, so they need new tools:
  - restoring a specific version or a trashed scene;
  - asset folders, and importing a file by path without the picker;
  - export settings;
  - subtitle export (the `captions.export` intent is broken: `voiceUi()` has no `exportSubtitles`);
  - creating, opening or duplicating projects, and the exports library;
  - camera pan (no function exists);
  - publishing and scheduling.
- **Things not saved to the file at all:** flip, skew, anchor, constraints, clip contents, solo. They need vocabulary props first.
- **Pointer-only gestures:** marquee selection and freehand drawing.

## 5. Build plan (in order)

1. **Sign in with ChatGPT in Desktop main** (new `apps/desktop/src/chatgpt-auth.ts`):
   - PKCE, state and nonce.
   - The first loopback HTTP listener: `127.0.0.1:1455`, falling back to a free port, path `/auth/callback`.
   - Dynamic registration: `agent_name_hint=Posterract`, and a persisted `urn:uuid` host id.
   - Validate the ID token (JWKS) and check for the `chatgpt.tokens.use.direct` scope.
   - Rotating refresh, serialized; revoke on sign-out.
   - Tokens encrypted with `safeStorage` in userData, following `auth.ts`.
   - IPC: `chatgpt:state`, `chatgpt:sign-in`, `chatgpt:sign-out`, `chatgpt:models`.
2. **Responses client in main** (`apps/desktop/src/chatgpt-respond.ts`):
   - `POST /v1/responses` with `store:false` and `stream:true`; parse SSE and stream the events to the renderer.
   - Map errors: usage limit, not eligible, unsupported capability, disconnected.
   - `GET /v1/models` for the model list.
   - The same client also accepts an **OpenAI API key** (a BYO key like the others) for users without Plus/Pro.
   - Tokens never reach the renderer, so the renderer's CSP stays as it is.
3. **The agent loop in the editor** (`context/agent-api/chatgpt/`):
   - Instructions: Posterract's composition rules, the same guidance the MCP server gives agents.
   - A compact scene block (`look()` / the intent `Situation`), plus a snapshot image when it helps.
   - The model's tool calls run through the editor's router: export `createAppRouter`, or reuse `EditorApi`'s caller, so conflict checks, agent-edit marking and revision ids stay as they are.
   - Results go back as `function_call_output`, with images as input images, until `response.completed`.
   - One undo step per command, a Cancel button, and live status text in the bar.
4. **The tool list:** namespaces with every function sent up front, because tool search isn't allowed on this route. Keep it compact:
   - **`scene`:** context, look, state, inspect, geometry, check, capture, snapshot.
   - **`source`:** read, edit, write, validate, lint, outline, describe, changes. describe, outline, lint and changes currently run only in the MCP process (`packages/posterract-cli/src/offline.ts`), so they need a callable port.
   - **`edit`:** apply_edits, set_properties, set_text, create, move, duplicate, delete, group, ungroup, bake_keyframes, set_variable, select, seek, activate, show, undo, redo.
   - **`media`:** probe, grab, filmstrip, waveform, beats, transcribe, fetch.
   - **`generate`:** image, video, voice.
   - **`timeline`, `layout`, `captions`, `view`, `project`:** the catalog's existing run functions (split, trim, align, distribute, markers, panels, workspace, theme, export, rename, import, restore, …) as a few functions with typed parameters. The 139 intents' work becomes ChatGPT's hands; only the Jev reading is dropped.
5. **Replace Jev in the bar:**
   - Enter tries the exact/fuzzy instant path; everything else goes to ChatGPT.
   - Delete the Jev pieces: `decide()`, `ai:decide`, the reading code (`resolve.ts`, `read.ts`, and the parts of `scene.ts`/`words.ts` only it uses), the typing-time live reading, the OpenRouter key card for the bar, and the `@agent` note lane. ChatGPT writes things itself.
   - Voice stays: talk → Groq/xAI transcript → ChatGPT.
6. **Close the gaps above as tools:**
   - restore a chosen version or trashed scene;
   - asset folders and import-by-path;
   - export settings;
   - subtitle export (fix the missing hook);
   - project create/open/duplicate and the exports library;
   - a camera-pan function.
7. **OpenAI's required UI:**
   - "Continue with ChatGPT" in Settings and on first use of the bar;
   - the one-time "You're using your ChatGPT plan" modal;
   - "Using ChatGPT plan · Manage usage" by the bar;
   - the usage-limit modal;
   - "Use your ChatGPT plan" on the pricing page.
8. **Tests:**
   - A stub Responses stream, like `scripts/stub-decisions.mjs`, for unit and end-to-end tests: tool calls, errors, refresh, cancel, one undo.
   - Then the 146-sentence corpus against ChatGPT, on the founder's account, only when he approves the run.

## 6. Founder's part

- **Submit the interest form:** openai.com/form/sign-in-with-chatgpt-interest.
  - Capabilities: "Sign in and ChatGPT plan use for AI requests".
  - Product: *Posterract Desktop, an AI video editor for short-form creators. Its command bar and built-in agent edit the user's video on the canvas (create, animate, caption, cut) using the user's ChatGPT plan. It runs on the user's Mac.*
- **Allow one real sign-in and run on his own ChatGPT account** when the build is ready.
- Shipping to customers waits for OpenAI's approval and client ID.

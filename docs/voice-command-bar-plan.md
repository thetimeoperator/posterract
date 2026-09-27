# Voice bar — build brief for the implementing agent

Written 2026-09-18 for Opus 5. **Read Part A before touching anything.** Everything marked **[code]** was checked in this repo that day; **[docs]** was read on the provider's page that day; **[unverified]** must be confirmed before you rely on it.

## What you are building

A black rounded bar at the bottom-centre of the editor canvas, showing a Siri-style waveform.

- **Hold Q and talk** (or press and hold the bar): the bar opens into the waveform, and the waveform moves with the person's voice. Release: the speech is transcribed by Groq, the words appear in the bar, and the command is carried out on the canvas as one undo step.
- **Tap ⌘K**: the same bar opens with a text input, for typing the same commands.
- Exact command names ("split", "undo", "bring to front", "export") need no AI key.
- Free-form sentences ("put the title in the lower third and fade it in") are resolved by **Jev, called through OpenRouter**.
- A command that needs writing ("write a punchier headline") becomes an `@agent` marker at the playhead.
- Nothing has to be selected first. A selection only lets the person say "this".

Build the phases in order. Each ends in something the founder can see and try. **Stop after each phase and report.**

---

# Part A — rules of this repo (non-negotiable)

1. **The editor is SolidJS**, not React: `apps/editor-sandbox` uses `solid-js`, `@kobalte/core`, `cmdk-solid`, Tailwind v4, TypeScript 5.9 **[code]**. There is no React and no three.js in it. Do not add either. (`apps/web` is the React app; this work does not touch it.)
2. **Never handle API keys.** Do not read key values out of `api-keys.json` into logs, output, tests, commits or memory. Never call Groq or OpenRouter with the founder's keys. Tests run against a **local stub server**. The only real calls are ones the founder makes himself or explicitly approves.
3. **Never write to the founder's open project** and never drive his running app. Test on an isolated instance and a **scratch copy** of a project:
   - from `apps/desktop`: `POSTERRACT_PROFILE=agenttest ./node_modules/.bin/electron . --hidden --remote-debugging-port=9333`
   - then over CDP: `Page.navigate` to `posterract-app://app/editor-sandbox/#/` (the web shell is sign-in gated); use `Page.reload` after rebuilding the renderer.
   - existing probes to copy the conventions from: `scripts/probe-collab.mjs`, `scripts/probe-bridge.mjs` **[code]** (exit 0 pass / 1 fail / 2 cannot run; refuse to run without `POSTERRACT_PROFILE`).
4. **Build and check commands** **[code]** — from `apps/desktop`: `pnpm run build:renderer:editor`, `pnpm run build:main`, `pnpm run typecheck`; from `apps/editor-sandbox`: `pnpm run check`, `pnpm run lint`.
5. **The working tree holds other agents' uncommitted work.** Touch only the files this brief names. Do not commit, push, deploy or package unless the founder says so.
6. **Never scan the home folder** (`~/Library`, Desktop, Documents, Downloads): it floods the founder with macOS permission prompts. Stay inside the repo and the session scratchpad.
7. **Match the neighbours.** Every file in `apps/editor-sandbox/src` starts with the MPL-2.0 header (copy it from the file next door). `engine/**` uses tabs; `components/shell/**` uses two spaces. Class names are merged with `cx` from `@/lib/cva` — there is no `cn` helper **[code]**.
8. **Product rules.** Plain words in the UI, sentence case, no invented vocabulary. No purple anywhere. Nothing new goes in the right inspector. Change only what this brief names — do not restyle or "improve" neighbouring UI.
9. **Reporting.** When a phase is done say so once, in plain words: what the founder can now do, what you checked, anything that did not work. Do not list internal tidying or optional extras.

---

# Part B — decisions already made (do not reopen)

| Topic | Decision |
|---|---|
| Speech-to-text | Groq `whisper-large-v3-turbo` through the app's existing `transcribe` slot. Base URL `https://api.groq.com/openai/v1`; the app appends `/audio/transcriptions`. Verified: that path answers 401 without a key, a fake path answers 404. |
| Second speech provider | xAI `grok-voice-transcribe-2.0`, behind a switch, **off by default** |
| Command understanding | Jev (`typesafe/jev-1.13`) **through OpenRouter**. Never TypeSafe's own API. |
| The visual | The Siri-wave component, **`wave` variant only**. The `fluid-dots` variant is not used and is not ported. |
| Voice reactivity | The waveform must be near-flat in silence and visibly move with the voice (§1.1, §2.4) |
| Talk key | **Hold `Q`** — one constant, `TALK_KEY`. `Q` is unbound **[code]**. |
| Type key | **Tap ⌘K** — unbound **[code]** (`K` alone stays pause-shuttle) |
| Mic | Push-to-talk only. No wake word, no always-on microphone. |
| Keys | Bring-your-own, per project, in `api-keys.json`; every provider call is made from the desktop **main** process. The founder's Groq key is already in his project. |

---

# Phase 1 — the wave and the bar (no keys needed)

**Done when:** the black bar with a calm, near-flat glowing line sits at the bottom-centre of the canvas; ⌘K opens it with a text input; typing "duplicate", "split", "zoom to fit" or "export" and pressing Enter runs that command; one ⌘Z undoes it.

## 1.1 `apps/editor-sandbox/src/components/ui/siri-wave.tsx` (new)

A Solid port of the React `SiriWave` component. The original is plain WebGL with no library, so only the React shell changes: `useRef` → a `let canvas`; `useEffect` → `onMount` + `createEffect` + `onCleanup`; `className` → `class`; `cn` → `cx`.

**Props**

```ts
export interface SiriWaveProps extends Omit<JSX.CanvasHTMLAttributes<HTMLCanvasElement>, 'children'> {
  width?: number;        // CSS px, default 420
  height?: number;       // CSS px, default 96   (the original forced a square; the shader handles any aspect)
  renderScale?: number;  // default 0.75, as in the original
  live?: number;         // 0 = the shader's own fake audio (the original look), 1 = driven by `levels`
  amp?: number;          // multiplies the wave's height; 1 = the original
  levels?: { low: number; mid: number; high: number };  // each 0–1
  paused?: boolean;
}
```

**Vertex shader — verbatim**

```glsl
attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }
```

**Fragment shader** — the original `WAVE_SHADER`, with exactly **five** edits, each marked `// EDIT`. With `uLive = 0` and `uAmp = 1` the output is pixel-identical to the original. Change nothing else in it.

```glsl
precision highp float;
uniform vec2 iResolution; uniform float iTime;
uniform float uLive; uniform float uLow; uniform float uMid; uniform float uHigh; uniform float uAmp; // EDIT 1: five uniforms
const float PI = 3.14159265359;
const float AMPLITUDE   = 0.32;
const float FREQ        = 1.1;
const float ABER_FREQ   = 1.0;
const float SPEED       = 2.4;
const float WAVE_SCALE  = 0.6;
const float ABERRATION  = 2.6;
const float THICKNESS   = 3.0;
const float INTENSITY   = 2.;
const float FALLOFF     = 1.7;
const float EDGE_MASK   = 0.4;
const float EDGE_INSET  = 0.0;
const float BAND_FILL   = 30000.0;
const float BAND_THICK  = 0.08;
const float SOFTNESS    = 2.5;
const float LOW_AMP     = 6.0;
const float LOW_INT     = 1.5;
const float MID_ABER    = 0.8;
const float MID_ABAMP   = 0.05;
const float MID_BAND    = 20.0;
const float MID_SOFT    = 0.4;
const float HIGH_ABER   = 0.5;
const float HIGH_ABAMP  = 0.06;
const float RESOLVED    = 1.0;
const float UNRES_SCALE = 0.14;

vec3 spectral4(int s){
    float x = float(s);
    return clamp(vec3(abs(x-3.0)-1.0, 2.0-abs(x-2.0), 2.0-abs(x-4.0)), 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 R = iResolution.xy;
    float aspect = R.x / R.y;
    vec2 p = (fragCoord + 0.5) * 2.0 / R - 1.0;
    p.x *= aspect;
    float yScreen = p.y;
    p /= max(WAVE_SCALE, 0.1);

    float t   = iTime;
    float low  = mix(clamp(0.45 + 0.45*sin(t*0.8)*sin(t*0.37+1.0), 0.0, 1.0), uLow,  uLive); // EDIT 2
    float mid  = mix(clamp(0.40 + 0.40*sin(t*1.7+2.0)*sin(t*0.53), 0.0, 1.0), uMid,  uLive); // EDIT 3
    float high = mix(clamp(0.30 + 0.30*sin(t*2.9+4.0)*sin(t*0.71+2.0), 0.0, 1.0), uHigh, uLive); // EDIT 4

    float res   = clamp(RESOLVED, 0.0, 1.0);
    float drift = mod(t, 20.0*PI) * SPEED;

    float xN  = p.x / max(aspect, 1.0);
    float env = cos(PI*0.5 * min(abs(0.9*xN), 1.0));
    env *= env;

    float A1    = AMPLITUDE*uAmp + 0.01*low*LOW_AMP; // EDIT 5: height follows the voice
    float A2    = A1 + mid*MID_ABAMP + high*HIGH_ABAMP;
    float AB    = (ABERRATION + mid*MID_ABER + high*HIGH_ABER)*res;
    float th    = mix(0.1, 0.01*THICKNESS, res);
    float inten = mix(0.1, 0.01*(INTENSITY + low*LOW_INT), res);
    float soft  = 0.01*res*max(0.0, SOFTNESS + mid*MID_SOFT);

    float dUnres = max(length(p) - mix(0.14, UNRES_SCALE, res), 0.0);
    float yMain = A1 * env * res * sin(p.x*FREQ + drift);

    float bandFillTh = max(BAND_THICK, 1e-4);
    float bandAmt    = 1e-4 * BAND_FILL * inten;
    vec3 num = vec3(0.0), den = vec3(0.0);
    for(int s = 0; s < 4; s++){
        vec3 hue = mix(vec3(1.0), spectral4(s), res);
        den += hue;
        float ab = mix(-AB, AB, float(s)/3.0);
        float yL = A2 * env * res * sin(p.x*ABER_FREQ + drift + ab);
        float d   = mix(dUnres, abs(p.y - yL), res);
        float lor = mix(1.0/(1.0 + (0.02*d)*(0.02*d)), 1.0, res);
        float line = inten / (sqrt(d*d + soft*soft) + th);
        float lo = min(yMain, yL), hi = max(yMain, yL);
        float dBand = max(0.0, max(p.y - hi, lo - p.y));
        float band  = bandAmt / (dBand + bandFillTh);
        num += hue * lor * (line + band);
    }
    vec3 col = num / den;

    float dM    = mix(dUnres, abs(p.y - yMain), res);
    float lorM  = mix(1.0/(1.0 + (0.02*dM)*(0.02*dM)), 1.0, res);
    float boost = (1.0 - res) * (14.0*low + 4.0);
    col += 0.5 * inten * (lorM + boost) / (sqrt(dM*dM + soft*soft) + th);

    col = pow(max(col, 0.0), vec3(1.5));
    float emT = clamp((abs(yScreen) - 1.0 + EDGE_INSET) / (-max(EDGE_MASK, 1e-4)), 0.0, 1.0);
    float em  = emT*emT*(3.0 - 2.0*emT);
    float gauss = exp(-pow(xN*FALLOFF, 2.0));
    col *= mix(1.0, em*gauss, res);
    col *= res;
    fragColor = vec4(col, 1.0);
}
void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }
```

**Why edit 5 exists:** in the original the wave's height is the constant `AMPLITUDE`; the audio values only nudge thickness and colour spread. Feeding in a real voice without edit 5 would barely show. The colours (`spectral4`) are red, yellow, green and cyan summing to white — there is no purple, leave them alone.

**Setup** — as the original: `canvas.getContext('webgl')`; compile both shaders; one buffer `new Float32Array([-1, -1, 3, -1, -1, 3])`; attribute `aPos`. Look up all seven uniforms once.

**Frame loop**

- Render size = `round(cssWidth × renderScale × devicePixelRatio)` by the same for height; update it from a `ResizeObserver` (the original ignores pixel ratio, so it is soft on Retina).
- Each frame: `iResolution`, `iTime` (seconds since mount), then the five uniforms from **eased** values: `uLive`, `uLow`, `uMid`, `uHigh`, `uAmp`. Ease toward the prop targets with attack 60 ms / release 250 ms (`value += (target − value) × (1 − exp(−dt / τ))`), so the wave jumps up with speech and settles smoothly.
- 60 fps while `live > 0.5`, otherwise 30 fps (skip every other frame).
- Do not draw when `props.paused`, when `document.hidden`, when the interface is hidden (`useLayout().uiVisible()` is false) or while exporting (`useExport().exporting()`) — export wants the GPU.
- `onCleanup`: cancel the frame, delete program, shaders and buffer (as the original), then `gl.getExtension('WEBGL_lose_context')?.loseContext()`.
- If the context or a shader fails, do **not** throw (the original throws): log once and render `<div class="posterract-voice-meter">` — a plain CSS bar whose width follows `levels`.

**Element:** `<canvas class={cx('block rounded-[20px] bg-black', local.class)} style={{ width: `${w}px`, height: `${h}px` }} />`.

## 1.2 `apps/editor-sandbox/src/engine/voice.tsx` (new) — shared state

Follow `engine/skill-deck.tsx` **[code]**: module-level Solid signals, exported as read-only accessors plus functions, so both the shortcut system (engine) and the component (UI) can use them.

```ts
export type VoiceMode = 'idle' | 'typing' | 'listening' | 'transcribing' | 'resolving' | 'confirm' | 'done' | 'error';
export const voiceMode: Accessor<VoiceMode>;
export const voiceText: Accessor<string>;
export const voiceReading: Accessor<Reading | null>;   // what it understood (Phase 3)
export const voiceReceipt: Accessor<string | null>;    // "Duplicated Wild storm · ⌘Z"
export const voiceError: Accessor<string | null>;
export const voiceLevels: Accessor<{ low: number; mid: number; high: number; level: number }>;
export function openVoiceBar(): void;                  // → 'typing'
export function closeVoiceBar(): void;                 // → 'idle'
export function startTalking(): void;                  // Phase 2
export function stopTalking(reason: 'released' | 'lost-focus' | 'cancelled'): void;  // Phase 2
export function submitCommand(text: string, source: 'typed' | 'spoken'): Promise<void>;
export function registerCommand(command: Command): () => void;   // for commands that need UI context (§1.4); returns an unregister function

export type Reading = {
  confidence: number;                       // the lowest answer in it (§3.5)
  action: string;                           // a COMMANDS id, or 'edit-properties' | 'change-text' | 'add-animation' | …
  targets: string[];                        // element ids
  edits: CanvasEdit[];                      // what Enter will apply
  chips: Array<{ label: string; value: string; sure: boolean; alternatives: Array<{ value: string; p: number }> }>;
};
```

`submitCommand` in Phase 1: run the matcher (§1.4). A match runs the command, sets the receipt for 2.5 s, then returns to `idle` (spoken) or stays in `typing` with the input cleared (typed). No match: mode `error`, message "I don't know that command yet." (Phase 3 replaces that branch.)

## 1.3 `apps/editor-sandbox/src/components/shell/voice-bar.tsx` (new) + mount

- Mount inside `components/canvas/canvas.tsx`, in the `absolute inset-0` container, directly after `<SkillDeck />` **[code]**.
- Position: `absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 20`. The canvas tool strip is top-right **[code]**, so nothing collides.
- Hidden when `uiVisible()` is false and while `skillDeckScene()` is not null.
- Pointer events on the bar must not reach the canvas underneath: `stopPropagation` on `pointerdown`.
- Styles go in `apps/editor-sandbox/src/index.css`, using the existing `posterract-*` naming and the theme variables, so Noir and Glass both work. Size changes animate with a 180 ms CSS transition on width and height.

| Mode | Bar | Wave props |
|---|---|---|
| `idle` | 160 × 40 pill, the wave only | `live=1`, `amp=0.05`, levels 0 → a near-flat glowing line |
| `typing` | 460 × 48: wave 96 × 32 on the left, text input on the right | same as idle |
| `listening` | 420 × 96, the wave only | `live=1`, `amp` and `levels` from the microphone (§2.4) |
| `transcribing`, `resolving` | 460 × 48, wave left, text "Listening…" then the transcript | `live=0`, `amp=0.35` — the shader's own gentle motion reads as "working" |
| `confirm` | 460 × 48 plus the chips row above (Phase 3) | as idle |
| `done` | receipt line for 2.5 s, then `idle` | as idle |
| `error` | plain sentence in the bar for 4 s, then `idle` | `paused` |

- Row above the bar (only when there is something to show): the reading as chips, or the receipt line.
- Input keys: Enter → `submitCommand(text, 'typed')`; Escape → `closeVoiceBar()`; ArrowUp/ArrowDown → history (last 50, in memory). The engine already ignores key presses whose target is an input (`engine/create-engine.ts:125`) **[code]**, so typing never triggers editor shortcuts.
- While typing, list the matching commands under the input with `components/ui/command.tsx` (a cmdk-solid wrapper that exists and is not imported anywhere yet **[code]**). Each row shows the command's label and its shortcut in `<Kbd>`.
- Tooltip on the idle pill: "Hold Q to talk · ⌘K to type".

## 1.4 The command list — `apps/editor-sandbox/src/engine/input/shortcuts.ts` (edit)

Today `PRESSED_SHORTCUTS` is a list of `{ keys, action }` with no names, and `components/shortcut-sheet.tsx` keeps a second, hand-written list of labels that has drifted (it lacks wrap in scene/sequence, hide, select all/parents/children, copy/cut/paste and canvas zoom in/out) **[code]**.

1. Extend the type:
   ```ts
   type Shortcut = {
   	keys: string[];
   	action: (world: World) => void;
   	id?: string;            // 'edit.split'
   	label?: string;         // 'Split at the playhead'
   	group?: 'Transport' | 'Range' | 'Editing' | 'Canvas' | 'Timeline' | 'Agent';
   	aliases?: string[];     // ['cut here', 'cut', 'blade']
   	when?: 'selection' | 'scene';
   };
   ```
2. Give every real command an `id`, `label`, `group` and sensible `aliases`. Use the wording already in `shortcut-sheet.tsx` for the labels. Entries that are not commands (the raw Space press/lift handlers, the duplicate `+`/`=` and `delete`/`backspace` bindings) keep no `id`.
3. `export const COMMANDS` = the entries with an `id`, de-duplicated by `id`, **plus** commands that have no key (`keys: []`): the three workspaces (`useLayout().setWorkspace`), toggle assets / inspector / timeline, version history, switch theme, hide interface, export, export settings, open exports library, open in agent, open AI Generate. Those need UI context, so register them from `voice-bar.tsx` on mount through `registerCommand()` in `engine/voice.tsx`.
4. The shortcut system's behaviour must not change. Run the existing editor workspace test (`pnpm run test:editor-workspace` from `apps/desktop`) and `scripts/probe-collab.mjs`.
5. `components/shortcut-sheet.tsx`: build its groups from `COMMANDS` instead of the hand-written `GROUPS`; format `keys` for display (`mod` → ⌘, `shift` → ⇧, `alt` → ⌥, arrows → ←→↑↓). Add a "Voice bar" group: Hold Q — Talk to the editor; ⌘K — Type a command.
6. **Matcher** — `apps/editor-sandbox/src/lib/command-match.ts` (new): normalise (lowercase, trim, strip `.,!?`, collapse spaces), then (a) exact label or alias → score 1; (b) label or alias starts with the text → 0.9; (c) cmdk-solid's scoring. Run only when the top score ≥ 0.85 **and** beats the runner-up by ≥ 0.15. If `when: 'selection'` and nothing is selected: error "Select something first."

## 1.5 Keys — `shortcuts.ts` (edit)

- `PRESSED_SHORTCUTS`: `{ keys: ['k', 'mod'], action: () => openVoiceBar(), id: 'voice.type', label: 'Type a command', group: 'Agent' }`. The existing `{ keys: ['k', '!mod'] }` pause-shuttle entry already excludes ⌘ **[code]**.
- The talk key is Phase 2 (§2.5).

## Phase 1 checks — `scripts/probe-voice-bar.mjs` (new, modelled on `probe-collab.mjs`)

1. The bar exists and is centred along the bottom of the canvas workspace.
2. ⌘K → mode `typing`, the input has focus; Escape → `idle`.
3. With an element selected, typing `duplicate` + Enter adds one element to the source; one undo returns the file byte-for-byte.
4. Typing `v`, `h`, `t` in the input does **not** change the active tool.
5. The shortcut sheet lists every entry in `COMMANDS`.
6. With `live=0, amp=1` the component renders the same frame as the original shader at the same time and size (compare a `readPixels` of both programs in the probe).

---

# Phase 2 — voice in (Groq)

**Done when:** holding Q shows the waveform moving with the voice; on release the words appear in the bar; a spoken "split", "undo" or "bring to front" runs.

## 2.1 Microphone permission — `apps/desktop`

`src/main.ts` ~line 970: both permission handlers allow only `fullscreen` and `clipboard-sanitized-write` **[code]**, so the microphone is refused today.

- Allow `media` **only** when it is audio-only **and** the requesting page is the app's own scheme (the one registered in `protocol.registerSchemesAsPrivileged`, `main.ts:99–115` **[code]**):
  - request handler `(contents, permission, callback, details)`: `permission === 'media'`, `details.mediaTypes` is non-empty and every entry is `'audio'`, and `new URL(contents.getURL()).protocol` is the app scheme;
  - check handler `(contents, permission, requestingOrigin, details)`: `permission === 'media'`, `details.mediaType === 'audio'`, and `requestingOrigin` is the app scheme.
  - Everything else stays refused. Keep the two existing allowances exactly as they are.
- New channel `VOICE_MIC_ACCESS: "voice:mic-access"` in `src/channels.ts`, mirrored in `apps/editor-sandbox/src/bridge/main-channels.ts`. Handler: on macOS `systemPreferences.getMediaAccessStatus('microphone')`, and if `'not-determined'`, `await systemPreferences.askForMediaAccess('microphone')`; return `{ status: 'granted' | 'denied' | 'restricted' }`. Other platforms return `granted`.
- `forge.config.ts` → `packagerConfig.extendInfo = { NSMicrophoneUsageDescription: "Posterract listens only while you hold the talk key, to carry out the command you speak." }`. The packaged app shows Electron's generic string today **[code]**.
- Nothing else is needed **[code]**: `@electron/osx-sign` 1.3.3's default entitlements already include `com.apple.security.device.audio-input`; the app scheme is registered `secure: true`, so `navigator.mediaDevices` exists; provider calls are made from main, so the CSP's `connect-src` is not involved.
- When access is denied the bar says: "Turn on the microphone for Posterract in System Settings → Privacy & Security → Microphone."

## 2.2 Capture — `apps/editor-sandbox/src/lib/voice-capture.ts` (new)

```ts
export type VoiceClip = { bytes: Uint8Array; mime: string; durationMs: number; peakLevel: number };
export async function warmMicrophone(): Promise<'ready' | 'denied' | 'no-device'>;
export function startCapture(onLevels: (l: { low: number; mid: number; high: number; level: number }) => void): void;
export async function stopCapture(): Promise<VoiceClip | null>;   // null = nothing worth sending
export function releaseMicrophone(): void;
```

- `getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.
- Keep the stream open for 60 s after the last use, then `releaseMicrophone()` — so the menu-bar microphone light is not on permanently, yet repeated commands start instantly.
- **Cold start:** the first hold has to open the stream (100–300 ms). Do not show the `listening` state until the stream is live — the wave appearing is the person's cue to speak.
- `MediaRecorder` with `audio/webm;codecs=opus`, `audioBitsPerSecond: 32000`; collect chunks; on stop build one `Uint8Array`.
- Keep recording **150 ms after** `stopCapture()` is called before stopping the recorder, so the last syllable is not clipped.
- Drop the clip (return `null`) when `durationMs < 300` or `peakLevel < 0.15` — Whisper invents phrases such as "Thank you." from silence. Hard stop at 15 s.
- If the scene is playing when talking starts, pause it and resume afterwards. The runtime exports only `togglePlayback(world, scene)` **[code]** — find the playing flag it flips in `packages/posterract-video-runtime/src/systems/playback.ts` and toggle only when actually playing.

## 2.3 Transcription — `apps/desktop/src/ai-local.ts` (edit)

- Extend `AiKeys` and `readKeys()` with `voiceProvider: 'openai-compatible' | 'xai'` (default `'openai-compatible'`), `xai: string`, `openrouter: string` (Phase 3). Extend `aiKeysStatus` / `aiKeysSave` and their channel types (`bridge/main-channels.ts` lines ~256–270 **[code]**) with `openrouter` and `xai`. **Do not change** the defaults `TRANSCRIBE_BASE` / `TRANSCRIBE_MODEL`: people transcribing captions with an OpenAI key would break.
- New:
  ```ts
  export async function transcribeCommand(input: { dir: string; audio: Uint8Array; mime: string; prompt?: string }): Promise<{ text: string; ms: number }>
  ```
  - Do **not** reuse `transcribeLocal`: it takes a project file, caches by hash and asks for word timings **[code]**.
  - `openai-compatible`: `POST ${transcribeUrl}/audio/transcriptions`, multipart — `file` (`new Blob([audio], { type: mime })`, filename `command.webm`), `model` = `transcribeModel`, `response_format=json`, `language=en`, `temperature=0`, and `prompt` when given (Groq allows 224 tokens **[docs]** — trim to 800 characters). Read `text`.
  - `xai`: `POST https://api.x.ai/v1/stt`, multipart — `model=grok-voice-transcribe-2.0`, `language=en`, `format=true`, one `keyterm` field per term (max 100, each ≤ 50 characters), and **`file` last**. Read `text` **[docs]**.
  - `signal: AbortSignal.timeout(8000)`. One retry after 400 ms on 429 or 5xx. No key: throw "Add your Groq key to talk to the editor." Any other failure: the provider's `error.message`, cut to 300 characters.
  - Trim the text; strip a trailing full stop from a transcript of three words or fewer.
- Channel `AI_TRANSCRIBE_COMMAND: "ai:transcribe-command"` in `src/channels.ts`, typed in `main-channels.ts` beside `AI_TRANSCRIBE` (line ~277 **[code]**), handled in `main.ts` beside the other `ai:*` handlers (lines 688–691 **[code]**). IPC is one private invoke channel with no per-channel allowlist in `preload.ts` **[code]**, so nothing else needs registering.
- `apps/editor-sandbox/src/lib/ai-bridge.ts`: add `aiTranscribeCommand(dir, audio, mime, prompt)`; extend `AiKeyProvider`, `AiKeysStatus` and `PROVIDER_LABELS` with `transcribe: { name: 'Groq', site: 'console.groq.com/keys' }` and `openrouter: { name: 'OpenRouter', site: 'openrouter.ai/keys' }`. Saving the `transcribe` key **from the voice bar** also writes `transcribeUrl: 'https://api.groq.com/openai/v1'` and `transcribeModel: 'whisper-large-v3-turbo'` (the save channel already accepts both **[code]**).

**Asking for the key where it is needed.** `KeysCard` in `components/genai/generate-panel.tsx` (line ~431) is a local function **[code]**. Move it to `components/genai/keys-card.tsx`, export it, widen its `provider` prop to the new providers, and leave the Generate panel behaving exactly as before. The voice bar shows that card above itself when the key it needs is missing. Do not add rows or tabs to the Generate panel. The card uses `useAi()` from `context/ai.tsx`; its provider wraps the project page (`pages/project.tsx:71`) **[code]**, so it is available to the voice bar — but `ai.saveKey` and `ai.refreshKeys` must learn the two new providers.

## 2.4 Driving the wave from the microphone

In `voice-capture.ts`: `AudioContext` → `createMediaStreamSource(stream)` → `AnalyserNode` (`fftSize = 1024`, `smoothingTimeConstant = 0.6`). **Do not connect it to `destination`.** There is no analyser in the editor today **[code]**. Once per animation frame while listening:

- **Level:** `getFloatTimeDomainData` → RMS → `db = 20 × log10(max(rms, 1e-5))` → `level = clamp((db + 50) / 40, 0, 1)`. So −50 dB is 0 and −10 dB is 1.
- **Bands:** `getByteFrequencyData`; bin width = `sampleRate / fftSize`; take the mean of the bins in each range, divide by 255, raise to the power 0.8:
  - `low` 80–300 Hz, `mid` 300–2,000 Hz, `high` 2,000–8,000 Hz.
- Call `onLevels(...)`. `engine/voice.tsx` stores them; `voice-bar.tsx` passes `levels` and `amp = 0.05 + 1.20 × level` to `<SiriWave live={1} …>`. The easing in §1.1 does the smoothing.

**Result that must be true:** silence → a near-flat line; speech → the wave rises and falls with every syllable; release → it settles flat within about 250 ms.

## 2.5 The talk key — `shortcuts.ts` (edit)

Model it on how Space is handled in the same file (`onSpacePressed`, `onSpaceLifted`, `updateSpaceHold`) **[code]**:

```ts
const TALK_KEY = 'q';
// PRESSED_SHORTCUTS:
{ keys: [TALK_KEY, '!mod', '!alt', '!shift'], action: () => startTalking(), id: 'voice.talk', label: 'Talk to the editor (hold)', group: 'Agent' },
// LIFTED_SHORTCUTS:
{ keys: [TALK_KEY], action: () => stopTalking('released') },
```

- Add `updateTalkHold(held)` next to `updateSpaceHold` in `shortcutSystem`: if the mode is `listening` and `!held.has(TALK_KEY)`, call `stopTalking('lost-focus')`. A window blur clears `held` without a key-up (`create-engine.ts:108`) **[code]**; this is what catches it. A clip ended by `lost-focus` is **discarded**, not sent.
- The engine ignores key events from inputs **[code]**, so Q types a "q" while the bar's input has focus. That is correct. In `typing` mode the way to talk is to press and hold the wave.
- Mouse: `pointerdown` on the wave → `startTalking()`; `pointerup` or `pointerleave` → `stopTalking('released')`. A press shorter than 300 ms opens the bar for typing instead.
- Escape while listening → `stopTalking('cancelled')`: discard.

## 2.6 Vocabulary hint — `apps/editor-sandbox/src/lib/voice-vocabulary.ts` (new)

Build the `prompt` fresh for every utterance, comma-separated, **in this order**, cut at 800 characters:

1. names and on-screen text (first 40 characters each) of the active scene's elements — from `look()` and `handleContextGet` in `context/agent-api/` **[code]**;
2. the `label` of every entry in `COMMANDS`;
3. editor words from the vocabulary — the `place` values, animation types, caption presets and easing names — spelled the way a person says them ("lower third", "slide up", "fade in"). The renderer already imports the vocabulary module (`context/agent-api/canvas.ts:31`), and the data is `@posterract/composition/vocabulary.json` **[code]**.

## 2.7 Flow

`startTalking()` → `warmMicrophone()` (first use also calls `VOICE_MIC_ACCESS`) → mode `listening` → `startCapture()`. `stopTalking('released')` → `stopCapture()`; `null` → back to `idle` silently; otherwise mode `transcribing` → `aiTranscribeCommand(...)` → put the text in the bar → `submitCommand(text, 'spoken')`.

Spoken `delete` and `ripple delete` never run immediately: mode `confirm`, "Delete Wild storm? Enter to confirm · Esc to cancel".

## Phase 2 checks

- A local stub server (`scripts/stub-transcribe.mjs`, new) answers `POST /audio/transcriptions` with a fixed text; the scratch project's `api-keys.json` points `transcribeUrl` at it with a dummy key. **No real key is used.**
- Feed a fixture WAV through a fake microphone stream: in the probe override `navigator.mediaDevices.getUserMedia` to return the stream of an `<audio>` element routed through `createMediaStreamDestination()`.
- Assert: levels rise while the fixture plays; `uAmp` goes above 0.5 during speech and below 0.1 within 400 ms after it; the request carries `model`, `language`, `prompt` and a non-empty `file`; a silent fixture sends **no** request; "split" splits the clip at the playhead; "delete" asks first; losing window focus mid-hold sends nothing.
- Report the time from key-up to text as measured against the stub. The real figure is the founder's to measure with his key. Target: under 600 ms.

---

# Phase 3 — any command, in your own words (Jev through OpenRouter)

**Done when:** "put the title in the lower third and fade it in", typed or spoken with nothing selected, shows what it understood and applies it as one undo step.

## 3.0 First, confirm the request shape — one real call

What is known comes from launch-day integrations on GitHub (for example `rajivkuriakose/typesafe-jev-examples`), **not** from an OpenRouter docs page **[unverified]**:

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OpenRouter key>
{ "model": "typesafe/jev-1.13", "state": { … }, "questions": { "<id>": { "type": "choice" | "score" | "noul", "instructions": "…", "criteria": { … } } } }
→ { "model": "…", "answers": { "<id>": { "type", "choice", "probabilities", "confidence" | "noul" | "score" } }, "usage": { "input_tokens", "output_tokens", "cost" }, "provider": "TypeSafe" }
```

- It does **not** work on `/api/v1/chat/completions`.
- The path is `/api/alpha/` and may move: keep the URL in **one** constant.
- The pinned slug is `typesafe/jev-1.13-20260917`; use it so behaviour does not shift.
- 32K tokens for the whole request (situation + all questions) **[docs]**.

Write `scripts/probe-decisions.mjs`: it reads the key from the environment variable `OPENROUTER_API_KEY`, sends one tiny yes/no question, and prints only the HTTP status, the top-level response fields and `usage` — **never the key**. **Ask the founder to run it himself, or to tell you explicitly to run it.** Do not build §3.1–3.6 until the shape is confirmed; if it differs, adjust §3.1 only.

Question types, from TypeSafe's docs **[docs]**: `choice` (`criteria` = map of option → description, at most 255 options; returns `choice`, `probabilities`, `confidence`), `score` (`criteria` = ordered list of levels), `noul` (yes/no; returns a probability 0–1 and no confidence). Jev cannot write text or numbers, reads questions literally, cannot count or do arithmetic, and gets less accurate as unrelated detail is added to the state.

## 3.1 The call — `apps/desktop/src/ai-local.ts`

`export async function decide(input: { dir: string; state: unknown; questions: Record<string, unknown> }): Promise<{ answers: Record<string, any>; usage?: unknown; ms: number }>` — `AbortSignal.timeout(4000)`, one retry on 429/5xx, no key → "Add your OpenRouter key to use your own words." Channel `AI_DECIDE: "ai:decide"`, wired like §2.3. Bridge function `aiDecide` in `lib/ai-bridge.ts`.

## 3.2 The resolver — `apps/editor-sandbox/src/context/agent-api/command-resolver.ts` (new)

`export async function resolveCommand(text: string): Promise<Reading>`

**The situation (`state`)**

```ts
{
  command: text,
  scene: { name, width, height, duration },
  playhead: <seconds>,
  selected: [ids],
  elements: [ { id, kind, name?, text?, start, end, place? }, … ]   // the active scene only
}
```

Use `look()` (`collab.ts`) and the bounded context reader (`context.ts`) **[code]**. With more than 120 elements, keep the selected ones, then the ones on screen at the playhead, then the rest nearest in time, up to 120.

**The questions — all in one request** (they are evaluated in parallel; more questions barely change the response time **[docs]**):

1. `action` — `choice`: every command in `COMMANDS` whose `when` is satisfied, plus `edit-properties`, `change-text`, `add-animation`, `add-effect`, `remove-animation`, `needs-writing`, `none`. The option descriptions come from §3.3.
2. `target` — `choice` over element ids, plus `selection` and `none`. Each option's description is that element's compact line.
3. `target_all` — `noul`: "Does the command refer to several elements at once (for example 'all the text')?" When ≥ 0.6, make a second request with one `noul` per element: "Is `#id` one of the elements the command refers to?"
4. For every property valid for **text, image, video, rect and group** (the vocabulary's `tags` lists say which tag takes which prop **[code]**): `said_<prop>` — `noul`: "Does the command ask to change `<prop>`?" — and, for enum props, `value_<prop>` — `choice` over its values.
5. Animation: `said_animation` (`noul`), `anim_type` (`choice`, the 14 animation types), `anim_phase` (`choice`: in / out), `anim_easing` (`choice`, the 8 easings plus `unstated`).
6. Relative words: `direction` (`choice`: left, right, up, down, none); `size` (`choice`: bigger, smaller, none); `amount` (`score`: a little, noticeably, a lot).

**Numbers and quoted text are found by code, never asked of Jev.** Regex the command for `\d+(\.\d+)?\s?(px|%|s|sec|seconds|degrees|°)?`, quoted strings and `#hex` colours. When a number is present, add a `number_for` `choice` over the numeric props valid for the target ("Which property does the number 64 belong to?"). For `change-text` with no quotes, add a `text_start` `choice` over the command's word positions ("Which word begins the new text?").

## 3.3 `apps/editor-sandbox/src/context/agent-api/command-descriptions.ts` (new)

One plain sentence for every enum value and every command, written for meaning — what the "whisper" caption preset looks like, what "snappy" easing feels like, what "ripple delete" does. The vocabulary carries a `doc` per prop but nothing per value **[code]**; Jev matches on meaning, so this file decides the accuracy. About 150 short entries. Add a unit test that fails when a value in the vocabulary has no description, so it cannot drift.

## 3.4 Answers → edits

- Build `CanvasEdit[]` (the type is in `packages/posterract-cli/src/cli-channels.ts:485`) and call `canvasApply(requireEditorSession, { edits })` (`context/agent-api/canvas.ts:287`) **[code]**: one write, one undo step, all-or-nothing, checked before anything changes.
- Call it **directly**, not through `asAgent` (`api.tsx`), so the journal records the person as the author — they gave the command.
- Animations and effects are **child elements** in the source (`<animation type="fade" … />`) **[code]**: emit `{ op: 'create', parentId: <target>, element: { … } }` — what the inspector's add-animation does via `editor.insertElement` (`components/sidebar-right/inspector/animations.tsx:129`).
- Relative steps are code: bigger/smaller ×1.15, ×1.3, ×1.6 by `amount`; moves of 5 / 10 / 20% of the scene's shorter side; "here" means the playhead.
- A command from `COMMANDS` simply runs its `action(world)`.
- Receipt text comes from the edits, in code: "Moved Wild storm → lower third · added fade in · ⌘Z".

## 3.5 Three lanes

Reading confidence = the **lowest** of: `action.confidence`, `target.confidence`, each used `value_*` confidence, and each used `said_*` noul (taken as `max(p, 1 − p)`).

- **≥ 0.80** → apply immediately; show the receipt.
- **0.50–0.80** → mode `confirm`: the reading as chips above the bar, each chip a dropdown of the other options with their probabilities (they arrive in `probabilities` at no cost); a ghost outline on the canvas where the element will land. Enter applies, Escape cancels.
- **< 0.50** → numbered choices (top three targets or actions), with the same numbers drawn on the canvas; keys 1–3 pick.
- `needs-writing`, or `none` with a low score → add `addMarkerAtPlayhead(world, name)` to `engine/markers.tsx` (next to `toggleMarkerAtPlayhead` **[code]**) and drop a marker named `@agent <the person's words>`. `look()` already returns such markers to a connected agent as `notes` (`collab.ts`) **[code]**. The bar says: "Left a note for your agent at 0:03." It is a note the agent picks up, not a live hand-off — do not claim otherwise.
- Destructive actions (delete, ripple delete) always go through `confirm`, whatever the confidence.
- Put the thresholds in one constants block; they are starting values to tune.

## 3.6 Live reading and the ghost

- While typing: call `resolveCommand` 250 ms after the last keystroke; cancel the request in flight on new input (`AbortController` through the channel); never apply from a live reading — only on Enter.
- Ghost: compute the target's rectangle as the Skill Deck does (`entityQuad(world, entity)` divided by `RenderSurface.resolution`, `components/canvas/skill-deck.tsx:100–115` **[code]**), apply the pending change to that rectangle in code, and draw a dashed outline.

## Phase 3 checks — the go/no-go

`scripts/command-corpus.json`: 60 sentences, each with the edits it must produce, spread over single property, two properties, target by name, target by description, "all the …", relative words, numbers, quoted text, exact commands, needs-writing and nonsense. Run them against a scratch copy of a real project. Report the accuracy per lane, the wrong-but-confident rate (it must be near zero — that is what breaks trust) and p50/p95 time. **This needs the founder's OpenRouter key: he runs it, or tells you explicitly to.**

---

# Phase 4 — finish

- "again" / "do that again" repeats the last command; ↑ history persists per project in `.posterract/view.json`.
- Every applied command writes a journal entry, so `posterract changes` shows it.
- Settings popover on the bar: talk key, apply-automatically on/off, speech provider (Groq / xAI).
- First-run hint above the idle pill, shown once: "Hold Q and say 'split' — or press ⌘K".
- One docs page, `apps/desktop/docs/voice-bar.md`, in the same voice as the other pages there.

---

# What to report back after each phase

1. What the founder can now do, in two or three plain sentences.
2. Which checks you ran and their results (probe names, pass/fail counts).
3. Anything that did not work, or that you were unsure about.
4. Nothing else.

# Why Posterract feels slow, and the plan to fix it

Measured Oct 5 2026 on production (server timings, network, live bundle) and on a local production build of the web app (headless Chrome, 1440×900 at 2× density).

## What is NOT the problem

The server. The VPS sits at load 0.01 with 4 GB of memory free, and every request the app makes is answered fast:

| Request | Server time | Size |
|---|---|---|
| Startup data (`/v1/bootstrap`, all parts in parallel) | ~90 ms | ~160 KB |
| Points dashboard (with feed page 1) | 23–37 ms | 33 KB |
| Feed page 2 | 5–7 ms | 17 KB |
| Leaderboard, analytics, calendar stats | 5–20 ms each | 1–51 KB |

## What IS the problem

### 1. Effects that never stop drawing (why it *feels* slow)

Behind every page the app shell runs:

- **A starfield canvas that redraws 260 stars, 60 times a second**, full screen at 2× resolution, for as long as the app is open (`packages/hyperkit/src/fx/Starfield.tsx`).
- **A style change on the page root on every mouse move** (`--space-x/--space-y` in `apps/web/src/shell/SpaceBackdrop.tsx`), which makes the browser recheck the styles of the whole page each time.
- **Layered nebula, grid, grade and noise layers**, plus a background video and poster that don't exist on the server. Those URLs return the HTML page, so they are wasted requests and a broken image.
- On the Points page, the HUD rings spin forever with glow filters on them.

Measured on the same pages, effects on vs off:

| Page | Frame rate at rest | Main thread busy at rest | Mouse moves handled in 3 s |
|---|---|---|---|
| Points | 32 fps vs 60 | 11% vs 2% | 101 vs 180 |
| Calendar | 46 fps vs 60 | 12% vs 2% | 136 vs 180 |
| Analytics | 42 fps vs 60 | 15% vs 2% | 104 vs 178 |

So with the effects on, scrolling stutters and clicks and typing respond late, on every page, all the time.

### 2. The app waits in line before showing anything (why it *loads* slowly)

Opening the app runs up to 9 steps, one after another:

HTML → main code → app frame code → session check → billing config → billing subscription → startup data → page code → page data.

Each step is a ~150–200 ms round trip through Cloudflare to the VPS, even though the server itself only spends 5–90 ms. That's roughly 1.5–2.5 s before a page shows its content, on every launch and reload.

### 3. Too many, too big downloads

A first visit to Points downloads ~830 KB compressed across ~65 files:

- 51 separate code files (icons are each their own file).
- 369 KB of CSS (68 KB compressed) in two global files, which include landing-page styles the app doesn't need.
- A 170 KB `instagram.png` icon.
- After every deploy the files have new names, so Cloudflare has to fetch them all from the VPS again.

### 4. Points feed thumbnails

Each feed row loads the start of its video file from storage to show the first frame: 10 video requests per page, and the stat card plays the whole video. Also, only 8 of your 39 posts still have their video file, so most rows can only show a placeholder.

## The plan, in order

### Phase 1: stop the constant drawing (biggest felt win, ~half a day)

- Draw the starfield once (a still image), or at most a slow drift that pauses when the window is hidden; cap it at 1× resolution.
- Remove the mouse-follow root style update (or move it onto one layer, throttled to the screen's refresh).
- Remove the missing background-video and poster requests.
- Points HUD: keep the look, but let the rings spin once on load and then rest (or turn only while hovered); bake the glow in instead of using live filters on moving parts.
- Target: 60 fps everywhere, ~2% CPU at rest, instant clicks.

### Phase 2: cut the waiting in line (~1 day)

- One startup request instead of four: session + billing + startup data together, or at least sent in parallel.
- Show the last data instantly from the browser's cache, then refresh it quietly. Repeat visits paint at once.
- Load the current page's code and data at the same time as the startup data, not after it.
- Target: ~1–1.5 s faster on every launch; near-instant repeat visits.

### Phase 3: lighter downloads (~1 day)

- Bundle the icons together instead of one file each; split landing-page CSS out of the app.
- Shrink the platform icons (170 KB PNG → a few KB) and serve code with Brotli compression.
- Target: ~30–40% fewer bytes and about half the requests.

### Phase 4: real thumbnails (~half a day + API)

- Save a small still image (~15 KB WebP) of every video when it's uploaded, with ffmpeg on the server, and store its URL with the post.
- Fill in older posts from the thumbnails Instagram, TikTok, Facebook and Threads already provide.
- Fixes the 31 posts with no thumbnail, and stops loading 10 videos per feed page.

### Checking each phase

The profiling scripts used for this study (frame rate, CPU at rest, mouse response, bytes per first visit) get rerun after each phase so the gains are measured, not guessed.

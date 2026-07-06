# POSTERRACT

**One post. Six platforms. The fourth dimension is time.**

Posterract is a short-form video scheduling platform for humans and AI agents.
Upload once, write a caption per platform, schedule — and the cloud publishes
to Instagram, TikTok, YouTube, X, Threads, and Facebook at the exact moment,
whether your laptop is open or not.

## Stack

- **Frontend** — React 19 · Vite · TanStack Router · Tailwind v4 · Three.js (`apps/web`)
- **Backend** — [Convex](https://convex.dev): database, exact-time scheduler, file storage, crons (`apps/web/convex`)
- **Auth** — [Better Auth](https://better-auth.com) running on Convex (users live in our database)
- **Design system** — `packages/hyperkit` (tokens + components), `packages/contract` (shared types + platform capability registry)

## Develop

```bash
pnpm install
cd apps/web
npx convex dev        # backend (first run links a Convex project)
pnpm dev              # app on http://localhost:5173
pnpm test:e2e         # Playwright suite (runs against the offline demo engine)
```

Without a `VITE_CONVEX_URL` env, the app boots in **demo mode** — a fully
functional in-browser simulation used by the e2e suite.

## Deploy

- Frontend: Vercel (root directory `apps/web`), SPA rewrites via `apps/web/vercel.json`
- Backend: `npx convex deploy` (production deployment)
- Required Vercel env vars: `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_SITE_URL`

---

© Posterract. All rights reserved.

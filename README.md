# POSTERRACT

**One post. Six platforms. The fourth dimension is time.**

Posterract is a short-form video scheduling platform for humans and AI agents.
Upload once, write a caption per platform, schedule — and the cloud publishes
to Instagram, TikTok, YouTube, X, Threads, and Facebook at the exact moment,
whether your laptop is open or not.

## Stack

- **Frontend** — React 19 · Vite · TanStack Router · Tailwind v4 · Three.js (`apps/web`)
- **Backend** — Fastify · PostgreSQL 17 · Redis · Temporal (`apps/api`, `apps/orchestrator`)
- **Media** — Direct multipart uploads to Cloudflare R2 through the Posterract API
- **Auth** — Better Auth backed by PostgreSQL
- **Design system** — `packages/hyperkit` (tokens + components), `packages/contract` (shared types + platform capability registry)

## Develop

```bash
pnpm install
pnpm dev
pnpm test:e2e
```

Without `VITE_API_URL`, the web app boots in the deterministic demo mode used by Playwright.

## Deploy

Production uses the project Docker Compose stack on the private Posterract VPS.
Follow the repository deployment instructions; never deploy Posterract to Vercel.

---

© Posterract. All rights reserved.

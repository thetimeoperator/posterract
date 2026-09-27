# Work with me: process hover grid

## Current revision — icon-only

The founder rejected the illustrated cards. The section now uses the supplied component's original icon-only structure: four desktop columns, two medium-screen columns, one mobile column, 40px internal spacing, neutral borders and gradient, and a blue hover accent. It displays the five real service steps instead of the sample component's placeholder features.

Removed all image properties, image rendering, step badges, image zoom, solid card backgrounds, and the custom three-plus-two layout. The component cannot render an image. The generated artwork remains saved separately but is not referenced by this section.

The updated component and agency consumer passed the web TypeScript check, production build, and desktop/mobile browser checks. Browser inspection confirmed five icons, zero images, no horizontal overflow, gradient opacity 1 on hover, an 8px title shift, and a 32px accent bar on hover.

Only the component and its agency consumer were synced for the corrective web deployment. The VPS web build and restart succeeded. Production browser verification confirmed five step titles, five icons, zero images, the original four-column desktop grid, and no horizontal overflow. The readiness endpoint returned `ok: true` for the backend services and R2.

## Previous revision — superseded

Replaced the five-panel squeeze carousel in the Work with me landing page with the supplied feature-grid pattern: a hover gradient, extending accent bar, shifting title, and five Tabler icons. The five revised anime illustrations appear above their matching steps. The process descriptions are preserved.

## Integration

- Shared component: `apps/web/src/components/ui/feature-section-with-hover-effects.tsx`.
- Consumer: `apps/web/src/marketing/agency/index.tsx` (`HowItRuns`).
- Existing alias `@/components/ui` resolves to `apps/web/src/components/ui`; the monorepo's source directory is the correct shared UI folder, so no duplicate repository-root `/components/ui` was created.
- Global Tailwind styles already live in `apps/web/src/styles/app.css`; TypeScript and the Tailwind Vite integration were already configured.
- Added `apps/web/components.json` to record those existing paths for shadcn tooling.
- Added `@tabler/icons-react` to the web workspace and lockfile.
- Public images: `apps/web/public/brand/how-it-works/*.webp`, 1280 × 720, 828,906 bytes combined, loaded lazily with reserved aspect ratios.
- Full-resolution originals and the built-in image-generation prompt set: `posterract-marketing/shared/website-assets/how-it-works-anime-2026-09-15/`.

## Validation

- Web TypeScript check passed.
- Local production build passed. Vite retains its existing large-chunk advisory.
- Desktop: three cards followed by two wider cards; all five images loaded.
- Tablet at 820px: two columns with the final card spanning both.
- Mobile at 390px: all five cards stack in a single column.
- No horizontal overflow at the checked widths.
- Hover inspection confirmed gradient opacity 1, title translation 8px, and accent-bar height 32px.
- Motion effects include reduced-motion overrides; process content does not depend on hover.

## Production

Deployed only the relevant web component, consumer, shadcn metadata, web package manifest, lockfile, and five public images. Before syncing, verified that the three existing VPS source files matched the local HEAD versions, then reviewed the targeted rsync dry run.

Rollback source archive: `/srv/posterract/backups/how-it-works-before-hover-20260915.tar.gz`.

Built the web image on the VPS and recreated the web service with Docker Compose. No GitHub commit or push was made. Production browser verification at `https://posterract.app/?mode=work#how` confirmed the five new cards, all five images decoded at 1280px, no carousel, and no horizontal overflow.

# Landing page: two modes, one switch

Status: plan + local preview, Sep 9 2026. The live landing page (`/`) is untouched. The preview lives at `/preview/landing` and is built from the same components the final page will use, so approval means swapping one import.

## The idea

The page has two jobs now: sell the tool, and sell the service. One switch at the top decides which job the page is doing. Everything under the switch belongs to the chosen job. The green world, the parallax and the nav stay in place while the content changes, so switching feels like turning a dial, not loading a page.

- **Use the product** — the current page, unchanged: hero, network, roadmap, pricing, pipeline, analytics, final CTA.
- **Work with me** — the agency offer: *I program content agents that grow your page.*

## The switch

A segmented control in the centre of the nav: `USE THE PRODUCT | WORK WITH ME`. A neon pill slides between the two halves; the active half is black-on-green, the other is mono on glass. The nav's right side follows the mode: `Sign in · Launch Posterract` becomes `Sign in · Work with me`. A thin row under the nav lists the mode's sections (`01 Network · 02 Roadmap · 03 Pricing · 04 Analytics` or `01 Team · 02 How it runs · 03 Engagement · 04 Apply`).

The mode is in the URL (`?mode=work`), so the agency page can be linked on its own. Switching scrolls to the top and fades the new content up into place (0.5s). With reduced motion, it cuts.

## Work-with-me mode, top to bottom

| # | Section | What it is |
|---|---|---|
| 00 | **Hero** | Kicker `WORK WITH ME // CONTENT AGENTS, PROGRAMMED FOR YOUR PAGE`. Title: *I program content agents that grow your page.* Lede: you get a content team that runs on Posterract — five agents set up for your audience, formats and voice; they make, schedule, post and learn; you approve, or you let them run. Buttons: **Work with me** · *See the team*. Same typography and layout as the product hero, so the two modes read as one page. |
| 00b | **The ops window** | The agency counterpart of a product demo, in the roadmap terminal's look. Left: a terminal where the operator's commands run — hiring the five agents for `@yourpage`, running the week, learning from analytics. Right: the page's week board (days across, platforms down) filling with posts as the terminal schedules them, thumbnails from real clips made with the five skills. Labeled *example week*. No invented metrics anywhere on the page. |
| 01 | **The team** | Five cards, one per agent: Clipping, Lead With Animations, Talking Characters, Trending News, UGC Ad. Each shows its clip, what it makes, and what the operator sets (voice, hooks, brand, guardrails). These are the skills that ship with the product, so every card is true. |
| 02 | **How it runs** | Four steps on one rail: strategy call → I program the agents → they produce and schedule (you approve each post, or none) → weekly review, where analytics retrain them. |
| 03 | **Ways to work** | Three shapes: **Setup** (I build the five agents on your account, hand them over, teach you to run them), **Managed** (I run them every week, you approve the calendar), **Autopilot** (the page runs itself, you get the report). Prices are the founder's; until set, each card reads *Priced on the call*. |
| 04 | **Apply** | A short form — name, email, page handle, platforms, what the page is for, monthly budget. There is no lead endpoint in the API, so submitting opens a prefilled email to the support address already on the page. A booking link, when provided, becomes the primary CTA instead. |
| 05 | **FAQ** | Honest answers from the product: you own the accounts and the content; live platforms are Instagram, Facebook, Threads, with TikTok as draft delivery; approval is your call; what I need from you is access and references. |
| — | **Final CTA** | *Stop making content. Start approving it.* Button: Work with me. Secondary: *Or use the product yourself →* (switches mode). The product mode's final CTA gets the mirror link: *Or let me run it for you →*. |
| — | Footer | Shared. |

## Design rules

- Same tokens, same faces: Switzer display, JetBrains Mono for labels and readouts, black `#05080b`, neon `#65ff9a`, mint `#eafff3`. Nothing blue or purple.
- Every element maps to the offer. No decorative components.
- Nothing is drawn over a video. Clips play inside plain frames.
- No fabricated numbers, testimonials or client names. Placeholders are explicit and named in one constants block at the top of the agency component (`AGENCY`), so the founder fills them once.
- Mobile: the switch stays in the nav, the ops window stacks (terminal above board), cards go single column, the form goes full width.

## Files

| File | Role |
|---|---|
| `apps/web/src/marketing/Landing.tsx` NEW | The two-mode page: nav with the switch, product mode (the current sections, copied verbatim), agency mode. Becomes the homepage on approval. |
| `apps/web/src/marketing/agency/*.tsx` NEW | `AgencyHero`, `OpsWindow`, `Team`, `HowItRuns`, `Engagement`, `Apply`, `Faq`. |
| `apps/web/src/styles/landing-two-mode.css` NEW | Styles for the switch, sub-nav and the agency sections. `homepage.css` is not edited. |
| `apps/web/src/routes/preview.landing.tsx` NEW | The preview route, `/preview/landing`. Public, no auth. Deleted after the swap. |
| `apps/web/public/brand/agency/` NEW | The five clips (720 wide, 5s, muted) and their poster frames. |

## Acceptance

Both modes reachable from the switch and from the URL. Product mode pixel-identical to today's page. The ops window runs and loops; the board fills in sync with the terminal. Typecheck and build clean. No horizontal scroll at any width. Reduced motion shows finished states.

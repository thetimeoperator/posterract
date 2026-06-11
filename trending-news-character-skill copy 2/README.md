# Trending News Character Skill Template

This folder is a reusable template for building short-form trending-news character videos with HyperFrames visuals on top and a HeyGen talking avatar on the bottom.

The distributed copy has been sanitized:

- no real API keys
- no personal avatar or voice IDs
- no private drafts or rendered outputs
- no user-specific run artifacts

## What To Configure

1. Copy `.env.example` to `.env`.
2. Fill in your own API keys and provider IDs.
3. Edit the files in `config/`.
4. Read `START_HERE.md`.
5. Read `AGENT_RUNBOOK.md`.
6. Run `python3 scripts/setup_check.py`.

## Main Skill Path

- `skills/trending-news-character-skill/`
  Main reusable skill and subskills.

## Included Reference Skill

- `skills/safezone-template-reference/`
  Reference video-editing skill tree. Keep it intact if you want the bundled editing workflow reference.

## Runtime Folders

- `output/drafts/`
- `output/approved/`
- `output/published/`
- `memory/`

These are included as blank runtime stubs only.

## Distribution Notes

- Do not include a real `.env`.
- Do not package the parent repo's `.git` folder.
- Keep generated drafts, transcripts, and rendered videos out of the template.

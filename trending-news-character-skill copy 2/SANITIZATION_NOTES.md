# Distribution Hygiene Notes

This template is prepared for public distribution.

Distribution checks:

- `.env` must stay private and is not included
- `.env.example` contains blank shell-safe placeholders
- provider IDs and API keys are blank placeholders
- personal drafts, transcripts, and rendered outputs are not included
- runtime output folders are included only as empty stubs
- brand/config files are generalized so users can adapt the template to their own character

Before publishing a package, distribute this folder without the parent repository's `.git` metadata.

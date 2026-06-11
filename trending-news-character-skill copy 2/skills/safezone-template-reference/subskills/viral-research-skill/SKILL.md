---
name: viral-research-skill
description: Pull live X posts from user-defined keywords or lists, then return coherent narrative candidates.
---

# Viral Research Skill

Use this skill only when `config/research.json` says the mode requires X.

## Inputs

Read:

- `{baseDir}/../../../../../config/research.json`
- `{baseDir}/references/story-evaluation.md`
- `{baseDir}/references/x-api-research.md`

Use the helper:

```bash
python3 {baseDir}/scripts/x_recent_scan.py
```

## Modes

- If `config/research.json` is set to `manual_topic`, skip X and research the user-supplied topic from web/chart/data sources.
- Use this X workflow only when the configured mode explicitly requires X discovery.

## Rules

- use configured keywords, lists, or user-supplied topic only
- exclude replies by default
- return narrative objects, not raw phrase fragments
- if the X batch is unusable, say so plainly
- for NFT market topics, start with overall market structure: market cap, sales volume, buyer/seller counts, chain split, and concentration in top collections
- separate participation growth from capital growth; rising buyers without comparable volume growth means early recovery, not full market return

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
- for trend topics, start with source credibility, recency, audience impact, and distribution signal
- separate attention growth from practical consequence; high engagement without a concrete consequence is not enough

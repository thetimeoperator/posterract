# X API Research Reference

Use this file inside `viral-research-skill`.

## Endpoint

- Recent Search: `GET https://api.x.com/2/tweets/search/recent`

This skill uses X for one job: finding live conversation clusters fast.

## Request Defaults

The helper script uses:

- `max_results=30`
- `sort_order=relevancy`
- `start_time`
- `end_time`
- `tweet.fields=created_at,lang,public_metrics,author_id`
- `expansions=author_id`
- `user.fields=username,name,verified`
- an `8` hour search window by default

## Query Rules

Search each keyword separately.

Default watchlist comes from `config/research.json`.
The starter config scans two keywords so it stays under the default low-budget API cap:

- `ai video`
- `creator tools`

Add more keywords only after raising `x.max_api_calls`, `x.daily_post_cap`, and the matching `.env` budget values.

Default pattern:

```text
("keyword") lang:en -is:retweet
```

Use `-is:reply` by default when reply clusters are noisy, and keep the window focused on the configured recent-hours range.

## What To Extract

From each keyword scan, extract:

- the 30 most relevant returned posts
- repeated claims
- repeated nouns and phrases
- repeated consequences
- obvious debate lines

The point is to find the shape of the live conversation, not just the single most viral post. After both scans, combine the 60-post pool and identify the top 3 narrative clusters for scripting.

## How To Form Clusters

Build clusters around:

- repeated event descriptions
- repeated entities
- repeated risks
- repeated opportunities

Examples:

- multiple posts about an AI company rolling out a new agent product
- multiple posts reacting to a macro print and its implications
- multiple posts discussing a trending narrative with similar stakes

## Noise Filters

Downgrade or reject clusters when they are:

- only jokes
- only vague hype
- only recycled takes with no new event
- too broad to explain cleanly

## Ranking Logic

Engagement matters, but it is not enough.

A strong cluster usually has:

- several supporting posts
- strong engagement
- visible recency
- one clear mechanism
- obvious consequence

## Output Reminder

The research skill should return candidate narratives with:

- topic
- why it is live now
- mechanism
- evidence quality
- working-class stakes
- advice mode suggestion

Do not force the script here. Hand off a clean narrative package instead.

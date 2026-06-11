#!/usr/bin/env python3
"""Scan X recent search results for a configurable crypto/NFT project."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Tuple


API_URL = "https://api.x.com/2/tweets/search/recent"
END_TIME_SAFETY_SECONDS = 30
WORKSPACE_ROOT = pathlib.Path(__file__).resolve().parents[5]
DEFAULT_LEDGER_PATH = WORKSPACE_ROOT / "memory" / "research-budget.json"
DEFAULT_CONFIG_PATH = WORKSPACE_ROOT / "config" / "research.json"
DEFAULT_DAILY_POST_CAP = int(os.environ.get("X_DAILY_POST_CAP", "60"))
DEFAULT_POSTS_PER_KEYWORD_CAP = int(os.environ.get("X_POSTS_PER_KEYWORD_CAP", "30"))
DEFAULT_MAX_API_CALLS = int(os.environ.get("X_MAX_API_CALLS", "2"))

STOPWORDS = {
    "a",
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "but",
    "by",
    "can",
    "do",
    "for",
    "from",
    "get",
    "has",
    "have",
    "how",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "more",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "so",
    "than",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "to",
    "up",
    "use",
    "using",
    "was",
    "we",
    "what",
    "when",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}

NOISE_TERMS = {
    "nsfw",
    "porn",
    "nude",
    "sexy",
    "aigirls",
    "aiart",
    "r18",
    "follow",
    "giveaway",
    "dm",
    "onlyfans",
}

COMMON_EVENT_TERMS = {
    "launch",
    "mint",
    "airdrop",
    "listing",
    "unlock",
    "burn",
    "bridge",
    "staking",
    "restaking",
    "yield",
    "whale",
    "wallet",
    "sweep",
    "floor",
    "volume",
    "liquidity",
    "breakout",
    "breakdown",
    "funding",
    "open interest",
    "token",
    "tokens",
    "nft",
    "nfts",
    "memecoin",
    "memecoins",
    "solana",
    "ethereum",
    "bitcoin",
}

KEYWORD_EVENT_TERMS: Dict[str, set[str]] = {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan X recent posts with configurable keyword and account inputs.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to config/research.json.")
    parser.add_argument("--keywords", nargs="*", help="One or more keywords to scan.")
    parser.add_argument("--accounts", nargs="*", help="Optional curated account usernames to constrain the search.")
    parser.add_argument("--hours", type=int, default=8, help="Hours to scan backwards from now.")
    parser.add_argument("--lang", default="en", help="Language filter.")
    parser.add_argument("--exclude-replies", action="store_true", help="Exclude replies.")
    parser.add_argument("--sort-orders", nargs="+", choices=("relevancy", "recency"), default=["relevancy"], help="One or more X Recent Search sort orders.")
    parser.add_argument("--posts-per-sort", type=int, default=30, help="Posts to request for each keyword/sort pair.")
    parser.add_argument("--posts-per-keyword-cap", type=int, default=DEFAULT_POSTS_PER_KEYWORD_CAP, help="Hard ceiling on total requested posts per keyword for this run.")
    parser.add_argument("--daily-post-cap", type=int, default=DEFAULT_DAILY_POST_CAP, help="Hard ceiling on total requested posts for the day.")
    parser.add_argument("--max-pages", type=int, default=1, help="Maximum API pages to fetch per keyword/sort pair.")
    parser.add_argument("--max-api-calls", type=int, default=DEFAULT_MAX_API_CALLS, help="Hard ceiling on API requests for this run.")
    parser.add_argument("--budget-ledger", default=str(DEFAULT_LEDGER_PATH), help="Path to the JSON ledger that tracks daily X usage.")
    parser.add_argument("--dry-run", action="store_true", help="Print the planned request and post volume without calling X.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON.")
    args = parser.parse_args()
    if args.posts_per_sort < 1:
        parser.error("--posts-per-sort must be at least 1")
    if args.max_pages < 1:
        parser.error("--max-pages must be at least 1")
    return args


def load_config(path: pathlib.Path) -> Dict[str, object]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_accounts(values: Iterable[str]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for value in values:
        username = str(value).strip().lstrip("@")
        if not username or username in seen:
            continue
        seen.add(username)
        normalized.append(username)
    return normalized


def configured_keyword_terms(topics: Iterable[Dict[str, object]]) -> Dict[str, set[str]]:
    mapping: Dict[str, set[str]] = {}
    for topic in topics:
        keyword = str(topic.get("keyword", "")).strip().lower()
        if not keyword:
            continue
        event_terms = {
            str(item).strip().lower()
            for item in topic.get("event_terms", []) or []
            if str(item).strip()
        }
        if event_terms:
            mapping[keyword] = event_terms
    return mapping


def apply_config_defaults(args: argparse.Namespace, config: Dict[str, object]) -> argparse.Namespace:
    x_cfg = config.get("x", {}) if isinstance(config.get("x"), dict) else {}
    topics = config.get("topics", []) if isinstance(config.get("topics"), list) else []

    if not args.keywords:
        configured_keywords = x_cfg.get("keywords", []) if isinstance(x_cfg.get("keywords"), list) else []
        args.keywords = [str(item).strip() for item in configured_keywords if str(item).strip()]
        if not args.keywords:
            args.keywords = [
                str(item.get("keyword", "")).strip()
                for item in topics
                if isinstance(item, dict) and str(item.get("keyword", "")).strip()
            ]

    if not args.accounts:
        configured_accounts = x_cfg.get("accounts", []) if isinstance(x_cfg.get("accounts"), list) else []
        args.accounts = normalize_accounts(configured_accounts)
    else:
        args.accounts = normalize_accounts(args.accounts)

    if args.hours == 8 and isinstance(x_cfg.get("hours"), int):
        args.hours = int(x_cfg["hours"])
    if args.lang == "en" and isinstance(x_cfg.get("lang"), str) and str(x_cfg["lang"]).strip():
        args.lang = str(x_cfg["lang"]).strip()
    if not args.exclude_replies and bool(x_cfg.get("exclude_replies")):
        args.exclude_replies = True
    if args.sort_orders == ["relevancy"] and isinstance(x_cfg.get("sort_orders"), list) and x_cfg["sort_orders"]:
        args.sort_orders = [str(item) for item in x_cfg["sort_orders"]]
    if args.posts_per_sort == 30 and isinstance(x_cfg.get("posts_per_sort"), int):
        args.posts_per_sort = int(x_cfg["posts_per_sort"])
    if args.posts_per_keyword_cap == DEFAULT_POSTS_PER_KEYWORD_CAP and isinstance(x_cfg.get("posts_per_keyword_cap"), int):
        args.posts_per_keyword_cap = int(x_cfg["posts_per_keyword_cap"])
    if args.daily_post_cap == DEFAULT_DAILY_POST_CAP and isinstance(x_cfg.get("daily_post_cap"), int):
        args.daily_post_cap = int(x_cfg["daily_post_cap"])
    if args.max_pages == 1 and isinstance(x_cfg.get("max_pages"), int):
        args.max_pages = int(x_cfg["max_pages"])
    if args.max_api_calls == DEFAULT_MAX_API_CALLS and isinstance(x_cfg.get("max_api_calls"), int):
        args.max_api_calls = int(x_cfg["max_api_calls"])
    return args


def utc_now() -> dt.datetime:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=END_TIME_SAFETY_SECONDS)).replace(microsecond=0)


def local_today() -> str:
    return dt.datetime.now().astimezone().date().isoformat()


def isoformat_z(value: dt.datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def quoted_term(keyword: str) -> str:
    return f"\"{keyword}\"" if " " in keyword else keyword


def build_query(keyword: str, lang: str, exclude_replies: bool, accounts: List[str]) -> str:
    parts = []
    if keyword:
        parts.append(quoted_term(keyword))
    if accounts:
        parts.append("(" + " OR ".join(f"from:{username}" for username in accounts) + ")")
    parts.append(f"lang:{lang}")
    parts.append("-is:retweet")
    if exclude_replies:
        parts.append("-is:reply")
    return " ".join(parts)


def request_json(url: str, params: Dict[str, str], token: str) -> Dict:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "crypto/NFT-character-x-scan"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"X API HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"X API connection error: {exc}") from exc


def fetch_recent_posts(
    *,
    keyword: str,
    sort_order: str,
    query: str,
    token: str,
    hours: int,
    max_pages: int,
    posts_per_sort: int,
) -> Tuple[List[Dict], int]:
    end_time = utc_now()
    start_time = end_time - dt.timedelta(hours=hours)
    posts: List[Dict] = []
    users: Dict[str, Dict] = {}
    next_token = None
    request_count = 0

    for _ in range(max_pages):
        remaining = posts_per_sort - len(posts)
        if remaining <= 0:
            break
        params = {
            "query": query,
            "start_time": isoformat_z(start_time),
            "end_time": isoformat_z(end_time),
            "max_results": str(max(10, min(remaining, 100))),
            "sort_order": sort_order,
            "tweet.fields": "created_at,lang,public_metrics,author_id",
            "expansions": "author_id",
            "user.fields": "username,name,verified",
        }
        if next_token:
            params["next_token"] = next_token

        payload = request_json(API_URL, params, token)
        request_count += 1
        posts.extend(payload.get("data", []))
        for user in payload.get("includes", {}).get("users", []):
            users[user["id"]] = user

        next_token = payload.get("meta", {}).get("next_token")
        if not next_token:
            break
        time.sleep(0.2)

    enriched = []
    for index, post in enumerate(posts[:posts_per_sort], start=1):
        metrics = post.get("public_metrics", {})
        author = users.get(post.get("author_id", ""), {})
        enriched.append(
            {
                "id": post.get("id"),
                "keyword": keyword,
                "sort_order": sort_order,
                "rank_in_response": index,
                "text": post.get("text", "").strip(),
                "created_at": post.get("created_at"),
                "author_username": author.get("username"),
                "author_name": author.get("name"),
                "author_verified": author.get("verified", False),
                "like_count": metrics.get("like_count", 0),
                "retweet_count": metrics.get("retweet_count", 0),
                "reply_count": metrics.get("reply_count", 0),
                "quote_count": metrics.get("quote_count", 0),
                "engagement_score": engagement_score(metrics),
                "url": post_url(author.get("username"), post.get("id")),
            }
        )
    return enriched, request_count


def post_url(username: str | None, post_id: str | None) -> str | None:
    if not username or not post_id:
        return None
    return f"https://x.com/{username}/status/{post_id}"


def engagement_score(metrics: Dict[str, int]) -> int:
    like_count = int(metrics.get("like_count", 0))
    retweet_count = int(metrics.get("retweet_count", 0))
    reply_count = int(metrics.get("reply_count", 0))
    quote_count = int(metrics.get("quote_count", 0))
    return like_count + (retweet_count * 2) + reply_count + (quote_count * 3)


def clean_text(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"@\w+", " ", text)
    text = text.replace("#", "")
    text = re.sub(r"[^A-Za-z0-9'\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def tokenize_text(text: str) -> List[str]:
    return [token for token in clean_text(text).split() if token]


def repetition_ratio(tokens: List[str]) -> float:
    if not tokens:
        return 1.0
    counts = collections.Counter(tokens)
    return max(counts.values()) / len(tokens)


def first_sentence(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    if not collapsed:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", collapsed, maxsplit=1)
    return parts[0].strip()


def keyword_event_terms(keyword: str, configured_terms: Dict[str, set[str]] | None = None) -> set[str]:
    terms = set(COMMON_EVENT_TERMS)
    if configured_terms:
        terms |= configured_terms.get(keyword.lower(), set())
    else:
        terms |= KEYWORD_EVENT_TERMS.get(keyword.lower(), set())
    return terms


def narrative_tokens(text: str, keyword: str, configured_terms: Dict[str, set[str]] | None = None) -> List[str]:
    keyword_token = clean_text(keyword)
    allowed_terms = keyword_event_terms(keyword, configured_terms)
    tokens = []
    for token in tokenize_text(text):
        if token in STOPWORDS or token in NOISE_TERMS:
            continue
        if token == keyword_token:
            continue
        if len(token) <= 2:
            continue
        if token in allowed_terms or len(token) >= 5:
            tokens.append(token)
    deduped = []
    seen = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def is_noisy_post(post: Dict, keyword: str) -> bool:
    raw_text = post.get("text", "")
    tokens = tokenize_text(raw_text)
    if len(tokens) < 6:
        return True
    if repetition_ratio(tokens) > 0.34:
        return True
    if raw_text.strip().startswith("@"):
        return True
    lowered = clean_text(raw_text)
    if any(term in lowered.split() for term in NOISE_TERMS):
        return True
    if lowered.count(clean_text(keyword)) > 4:
        return True
    return False


def is_narrative_like_post(post: Dict, keyword: str, configured_terms: Dict[str, set[str]] | None = None) -> bool:
    if is_noisy_post(post, keyword):
        return False
    tokens = narrative_tokens(post.get("text", ""), keyword, configured_terms)
    if len(tokens) < 4:
        return False
    event_terms = keyword_event_terms(keyword, configured_terms)
    if not any(token in event_terms for token in tokens):
        return False
    return True


def post_quality_score(post: Dict, keyword: str, configured_terms: Dict[str, set[str]] | None = None) -> int:
    score = int(post.get("engagement_score", 0))
    if post.get("author_verified"):
        score += 75
    text = post.get("text", "")
    tokens = narrative_tokens(text, keyword, configured_terms)
    event_terms = keyword_event_terms(keyword, configured_terms)
    if any(token in event_terms for token in tokens):
        score += 30
    if re.search(r"\d", text):
        score += 10
    if "http" in text:
        score += 10
    return score


def token_overlap(left: List[str], right: List[str]) -> int:
    return len(set(left) & set(right))


def headline_from_post(post: Dict, keyword: str) -> str:
    sentence = first_sentence(post.get("text", ""))
    sentence = re.sub(r"https?://\S+", "", sentence)
    sentence = re.sub(r"@\w+", "", sentence)
    sentence = re.sub(r"#\w+", "", sentence)
    sentence = re.sub(r"\s+", " ", sentence).strip(" -")
    if not sentence:
        sentence = post.get("text", "").strip()
    if len(sentence) > 140:
        sentence = sentence[:137].rstrip() + "..."
    return sentence


def build_breaking_narrative_candidates(
    posts: List[Dict],
    *,
    configured_terms: Dict[str, set[str]] | None = None,
    limit: int = 3,
) -> List[Dict]:
    filtered = [post for post in posts if is_narrative_like_post(post, post.get("keyword", ""), configured_terms)]
    ranked = sorted(
        filtered,
        key=lambda post: post_quality_score(post, post.get("keyword", ""), configured_terms),
        reverse=True,
    )
    used_ids: set[str] = set()
    candidates: List[Dict] = []

    for post in ranked:
        if post["id"] in used_ids:
            continue
        keyword = post.get("keyword", "")
        anchor_tokens = narrative_tokens(post.get("text", ""), keyword, configured_terms)
        if len(anchor_tokens) < 4:
            continue

        cluster = []
        for other in ranked:
            if other["id"] in used_ids:
                continue
            if other.get("keyword") != keyword:
                continue
            overlap = token_overlap(anchor_tokens, narrative_tokens(other.get("text", ""), keyword, configured_terms))
            if overlap >= 2:
                cluster.append(other)

        if len(cluster) < 2:
            continue

        supporting_ids = [item["id"] for item in cluster]
        supporting_authors = sorted({item.get("author_username") for item in cluster if item.get("author_username")})
        candidates.append(
            {
                "headline": headline_from_post(post, keyword),
                "source_keyword": keyword,
                "representative_post_id": post["id"],
                "supporting_post_ids": supporting_ids,
                "supporting_post_count": len(supporting_ids),
                "supporting_authors": supporting_authors,
                "quality_score": post_quality_score(post, keyword, configured_terms),
                "narrative_terms": anchor_tokens[:8],
            }
        )
        used_ids.update(supporting_ids)
        if len(candidates) >= limit:
            break

    for index, candidate in enumerate(candidates, start=1):
        candidate["rank"] = index
    return candidates


def extract_phrases(text: str) -> Iterable[str]:
    cleaned = clean_text(text)
    tokens = [token for token in cleaned.split() if len(token) > 2 and token not in STOPWORDS]
    for size in (2, 3):
        if len(tokens) < size:
            continue
        for idx in range(len(tokens) - size + 1):
            gram = tokens[idx : idx + size]
            if any(token in STOPWORDS for token in gram):
                continue
            yield " ".join(gram)


def collect_topic_candidates(posts: List[Dict], limit: int = 8) -> List[Dict]:
    phrase_scores: Dict[str, int] = collections.Counter()
    phrase_posts: Dict[str, set] = collections.defaultdict(set)
    for post in posts:
        score = max(1, int(post["engagement_score"]))
        for phrase in extract_phrases(post["text"]):
            phrase_scores[phrase] += score
            phrase_posts[phrase].add(post["id"])
    ranked = phrase_scores.most_common(limit)
    return [
        {
            "phrase": phrase,
            "score": score,
            "supporting_post_ids": sorted(phrase_posts[phrase]),
        }
        for phrase, score in ranked
    ]


def save_usage_state(path: pathlib.Path, state: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)


def load_usage_state(path: pathlib.Path, daily_post_cap: int, max_api_calls: int) -> Dict[str, object]:
    today = local_today()
    if path.exists():
        with open(path, "r", encoding="utf-8") as handle:
            try:
                state = json.load(handle)
            except json.JSONDecodeError:
                state = {}
    else:
        state = {}

    if state.get("date") != today:
        requests_used = 0
        posts_retrieved_used = 0
    else:
        requests_used = int(state.get("requests_used", 0))
        posts_retrieved_used = int(state.get("posts_retrieved_used", 0))

    state = {
        "date": today,
        "requests_used": requests_used,
        "posts_retrieved_used": posts_retrieved_used,
        "daily_post_cap": daily_post_cap,
        "max_api_calls": max_api_calls,
        "remaining_post_capacity": max(0, daily_post_cap - posts_retrieved_used),
        "remaining_request_capacity": max(0, max_api_calls - requests_used),
    }
    save_usage_state(path, state)
    return state


def increment_usage_state(path: pathlib.Path, daily_post_cap: int, max_api_calls: int, request_count: int, posts_retrieved: int) -> Dict[str, object]:
    state = load_usage_state(path, daily_post_cap, max_api_calls)
    state["requests_used"] = int(state.get("requests_used", 0)) + request_count
    state["posts_retrieved_used"] = int(state.get("posts_retrieved_used", 0)) + posts_retrieved
    state["remaining_post_capacity"] = max(0, daily_post_cap - int(state["posts_retrieved_used"]))
    state["remaining_request_capacity"] = max(0, max_api_calls - int(state["requests_used"]))
    save_usage_state(path, state)
    return state


def planned_request_count(args: argparse.Namespace) -> int:
    return len(args.keywords) * len(args.sort_orders) * args.max_pages


def planned_posts_per_keyword(args: argparse.Namespace) -> int:
    return len(args.sort_orders) * args.posts_per_sort * args.max_pages


def planned_total_posts(args: argparse.Namespace) -> int:
    return len(args.keywords) * planned_posts_per_keyword(args)


def render_json(payload: Dict[str, object], pretty: bool) -> None:
    if pretty:
        print(json.dumps(payload, indent=2))
    else:
        print(json.dumps(payload))


def main() -> int:
    args = parse_args()
    config_path = pathlib.Path(args.config)
    config = load_config(config_path)
    args = apply_config_defaults(args, config)
    configured_terms = configured_keyword_terms(config.get("topics", []) if isinstance(config, dict) else [])

    if not args.keywords:
        render_json({"status": "blocked", "reason": "No keywords configured. Edit config/research.json or pass --keywords."}, args.pretty)
        return 1

    ledger_path = pathlib.Path(args.budget_ledger)
    usage_before = load_usage_state(ledger_path, args.daily_post_cap, args.max_api_calls)
    planned_requests = planned_request_count(args)
    planned_keyword_posts = planned_posts_per_keyword(args)
    planned_posts = planned_total_posts(args)

    output: Dict[str, object] = {
        "status": "success",
        "generated_at_utc": isoformat_z(utc_now()),
        "scan_window_hours": args.hours,
        "keywords": list(args.keywords),
        "accounts": list(args.accounts or []),
        "sort_orders": list(args.sort_orders),
        "usage": {
            "config_path": str(config_path),
            "posts_per_sort": args.posts_per_sort,
            "posts_per_keyword_cap": args.posts_per_keyword_cap,
            "daily_post_cap": args.daily_post_cap,
            "planned_requests": planned_requests,
            "planned_posts_per_keyword": planned_keyword_posts,
            "planned_posts_retrieved": planned_posts,
            "max_api_calls": args.max_api_calls,
            "ledger_path": str(ledger_path),
            "before": usage_before,
        },
        "keyword_results": [],
        "breaking_narrative_candidates": [],
    }

    if planned_keyword_posts > args.posts_per_keyword_cap:
        output["status"] = "blocked"
        output["reason"] = (
            f"Planned posts per keyword {planned_keyword_posts} exceed the cap of {args.posts_per_keyword_cap}. "
            "Lower --posts-per-sort, --max-pages, or the number of sort orders."
        )
        render_json(output, args.pretty)
        return 1

    if planned_requests > args.max_api_calls:
        output["status"] = "blocked"
        output["reason"] = (
            f"Planned request count {planned_requests} exceeds --max-api-calls {args.max_api_calls}. "
            "Reduce keywords, sort orders, or pages."
        )
        render_json(output, args.pretty)
        return 1

    if planned_posts > int(usage_before["remaining_post_capacity"]):
        output["status"] = "blocked"
        output["reason"] = (
            f"Planned posts {planned_posts} exceed remaining daily post capacity {usage_before['remaining_post_capacity']}. "
            "Lower the volume or wait until tomorrow."
        )
        render_json(output, args.pretty)
        return 1

    if args.dry_run:
        output["status"] = "dry_run"
        render_json(output, args.pretty)
        return 0

    token = os.environ.get("X_BEARER_TOKEN")
    if not token:
        render_json({"status": "blocked", "reason": "X_BEARER_TOKEN is missing"}, args.pretty)
        return 1

    overall_posts: List[Dict] = []
    usage_after = usage_before
    try:
        for keyword in args.keywords:
            query = build_query(keyword, args.lang, args.exclude_replies, args.accounts or [])
            keyword_posts: List[Dict] = []
            sort_runs: List[Dict[str, object]] = []
            for sort_order in args.sort_orders:
                posts, request_count = fetch_recent_posts(
                    keyword=keyword,
                    sort_order=sort_order,
                    query=query,
                    token=token,
                    hours=args.hours,
                    max_pages=args.max_pages,
                    posts_per_sort=args.posts_per_sort,
                )
                usage_after = increment_usage_state(
                    ledger_path,
                    args.daily_post_cap,
                    args.max_api_calls,
                    request_count,
                    len(posts),
                )
                keyword_posts.extend(posts)
                overall_posts.extend(posts)
                sort_runs.append(
                    {
                        "sort_order": sort_order,
                        "x_query_used": query,
                        "api_calls_used": request_count,
                        "fetched_posts": len(posts),
                        "posts": posts,
                        "narrative_like_post_ids": [
                            item["id"] for item in posts if is_narrative_like_post(item, keyword, configured_terms)
                        ],
                    }
                )
            output["keyword_results"].append(
                {
                    "keyword": keyword,
                    "requested_posts_total": args.posts_per_sort * len(args.sort_orders),
                    "sort_runs": sort_runs,
                    "narrative_like_post_count": sum(
                        1 for item in keyword_posts if is_narrative_like_post(item, keyword, configured_terms)
                    ),
                }
            )
    except RuntimeError as exc:
        message = str(exc)
        output["status"] = "blocked" if "CreditsDepleted" in message or "HTTP 402" in message else "error"
        output["reason"] = message
        output["usage"]["after"] = usage_after
        render_json(output, args.pretty)
        return 1

    output["usage"]["after"] = usage_after
    output["breaking_narrative_candidates"] = build_breaking_narrative_candidates(overall_posts, configured_terms=configured_terms, limit=3)
    render_json(output, args.pretty)
    return 0


if __name__ == "__main__":
    sys.exit(main())

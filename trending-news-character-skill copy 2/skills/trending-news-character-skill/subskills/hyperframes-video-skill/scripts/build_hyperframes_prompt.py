#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import re
from typing import Dict, List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a beat-level HyperFrames planning package from a runtime script."
    )
    parser.add_argument("--script", help="Approved script text.")
    parser.add_argument("--script-file", help="Path to file containing runtime script.")
    parser.add_argument("--topic", help="Optional explicit topic label.")
    parser.add_argument("--output", help="Optional path to save the master prompt text.")
    parser.add_argument("--json-output", help="Optional path to save the full planning package JSON.")
    parser.add_argument("--duration", type=float, help="Optional target total video duration in seconds.")
    return parser.parse_args()


def load_script(script: str | None, script_file: str | None) -> str:
    if script and script.strip():
        return script.strip()
    if script_file:
        return pathlib.Path(script_file).read_text(encoding="utf-8").strip()
    raise SystemExit("Provide --script or --script-file")


def summarize_topic(script: str, explicit_topic: str | None) -> str:
    if explicit_topic and explicit_topic.strip():
        return explicit_topic.strip()
    first_sentence = re.split(r"(?<=[.!?])\s+", script.strip(), maxsplit=1)[0]
    return first_sentence[:160].strip()


def split_sentences(script: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", script.strip())
    return [part.strip() for part in parts if part.strip()]


def chunk_sentences(sentences: List[str]) -> List[str]:
    if not sentences:
        return []
    chunks: List[str] = []
    current: List[str] = []
    current_words = 0
    for sentence in sentences:
        words = sentence.split()
        if current and (current_words + len(words) > 16 or len(current) >= 1):
            chunks.append(" ".join(current).strip())
            current = []
            current_words = 0
        current.append(sentence)
        current_words += len(words)
    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def allocate_durations(chunks: List[str], total_duration: float | None) -> List[float]:
    if not chunks:
        return []
    if total_duration is None:
        total_duration = max(15.0, min(45.0, sum(len(chunk.split()) for chunk in chunks) / 2.6))
    weights = [max(1.0, len(chunk.split())) for chunk in chunks]
    total_weight = sum(weights)
    raw = [total_duration * (weight / total_weight) for weight in weights]
    rounded = [round(value, 2) for value in raw]
    diff = round(total_duration - sum(rounded), 2)
    rounded[-1] = round(rounded[-1] + diff, 2)
    return rounded


def normalize_label(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return cleaned or "scene"


def default_safe_zone() -> Dict[str, object]:
    return {
        "viewport_width": 1080,
        "viewport_height": 960,
        "safe_zone_width": 960,
        "safe_zone_height": 890,
        "safe_zone_inset_left": 60,
        "safe_zone_inset_top": 35,
        "primary_content_anchor": "centered-in-1080x960-top-half-viewport",
        "edge_exclusion_rule": "All major content must stay inside the centered 960x890 safe zone within the 1080x960 top-half viewport; only background texture, glows, and non-essential decoratives may live outside it.",
    }


def default_ticker_spec() -> Dict[str, object]:
    return {
        "required": True,
        "role": "contextual moving news ticker / market tape for broadcast texture",
        "placement": "bottom rail glued to the bottom edge of the HyperFrames top-half viewport, directly above the avatar split",
        "content_rule": "Use short story-specific phrases, source/context labels, market/team/policy terms, or alert words; never use word-for-word subtitles or transcript text.",
        "motion_rule": "Ticker must move continuously through each scene with deterministic finite CSS/GSAP motion compatible with HyperFrames rendering.",
        "safe_zone_rule": "Ticker edges may extend outside the centered 960x890 safe zone as ambient overflow, but the ticker rail must stay attached to the bottom of the HyperFrames layer and ticker text must not collide with headlines, charts, maps, source cards, or the avatar split.",
    }


def detect_story_genre(topic: str, script: str) -> Dict[str, object]:
    lower = f"{topic} {script}".lower()
    if any(word in lower for word in ["nba", "lakers", "playoffs", "game 5", "thunder", "rockets", "reaves", "doncic", "injury"]):
        if any(word in lower for word in ["injury", "questionable", "game-time", "return", "strain", "ruled out"]):
            return {
                "genre": "sports-injury-board",
                "visual_world": "playoff medical/status command board with team-color tension, status cards, matchup pressure, and source-aware labels",
                "layout_grammar": "compact headline lockups, two-column status cards, timeline rows, matchup boards, and clear availability tags",
                "motion_language": "broadcast snaps, status pulses, ticker drift, subtle scoreboard parallax, and alert-line emphasis",
                "anti_patterns": ["generic tech dashboard", "official logos", "confirmed-status language when status is uncertain"],
            }
        return {
            "genre": "sports-broadcast-recap",
            "visual_world": "sports-broadcast scoreboard package with big team abbreviations, score strips, bracket pressure, and arena-control-room energy",
            "layout_grammar": "scoreboards, series cards, matchup tiles, ticker strips, and large abbreviated team/result typography",
            "motion_language": "ticker movement, score pulses, card snaps, line sweeps, and fast but readable transitions",
            "anti_patterns": ["official logos", "generic stat grid", "tiny scoreboard text carrying the story"],
        }
    if any(word in lower for word in ["crypto", "bitcoin", "ethereum", "coin", "nft", "market", "price", "token"]):
        return {
            "genre": "market-news-terminal",
            "visual_world": "trading terminal meets newsroom: market boards, source cards, volatility pulses, clean price context, and narrative rotation",
            "layout_grammar": "market panels, source cards, labeled charts, mover lists, risk callouts, and timeline strips",
            "motion_language": "chart draws, signal pulses, scrolling market tape, card emphasis shifts, and controlled glow",
            "anti_patterns": ["unlabeled fake charts", "random candles", "abstract neon rings as the main visual"],
        }
    if any(word in lower for word in ["war", "military", "country", "border", "election", "policy", "government", "iran", "china", "russia"]):
        return {
            "genre": "intelligence-briefing",
            "visual_world": "newsroom intelligence board with restrained maps, source cards, location labels, and consequence panels",
            "layout_grammar": "briefing cards, map treatments, timeline rows, source strips, and concise consequence boards",
            "motion_language": "route reveals, measured line draws, source-card fades, and restrained alert pulses",
            "anti_patterns": ["rough hand-drawn maps", "sensational explosion graphics", "unsourced claims"],
        }
    if any(word in lower for word in ["celebrity", "instagram", "tiktok", "viral", "creator", "drama", "posted"]):
        return {
            "genre": "social-editorial-feed",
            "visual_world": "tabloid/editorial social-feed package with post cards, comment velocity, creator panels, and clean receipts",
            "layout_grammar": "post screenshots, receipt cards, timeline tiles, quote panels, and reaction meters",
            "motion_language": "feed slides, receipt reveals, comment pulses, and quick editorial punch-ins",
            "anti_patterns": ["fake screenshots", "subtitle-only recap", "generic app UI cards without context"],
        }
    return {
        "genre": "editorial-news-package",
        "visual_world": "subject-specific editorial explainer package with strong hierarchy, source cards, clear labels, and bespoke information design",
        "layout_grammar": "headline frames, source cards, timelines, stat boards, split comparisons, and concise callouts",
        "motion_language": "measured editorial reveals, subtle parallax, line draws, and continuous low-intensity motion",
        "anti_patterns": ["generic dashboard", "placeholder shapes", "template reuse with text swaps"],
    }


def layout_blueprint_for(scene_type: str) -> Dict[str, object]:
    mapping = {
        "sports-broadcast-board": {
            "layout_blueprint": "sports-scoreboard-package",
            "layout_budget": {"max_headline_lines": 2, "max_dek_lines": 2, "max_stat_cards": 4, "max_annotations": 2, "max_panels": 4},
            "overflow_policy": "preserve the main result/status first, then shorten context cards and source labels before render",
        },
        "sports-injury-board": {
            "layout_blueprint": "injury-status-command-board",
            "layout_budget": {"max_headline_lines": 2, "max_dek_lines": 2, "max_stat_cards": 3, "max_annotations": 3, "max_panels": 3},
            "overflow_policy": "preserve status certainty language first, then shorten timeline details and secondary analysis before render",
        },
        "editorial-incident-board": {
            "layout_blueprint": "incident-board",
            "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 4, "max_stat_cards": 3, "max_annotations": 2, "max_panels": 2},
            "overflow_policy": "reduce copy first, then drop low-priority supporting detail before render",
        },
        "editorial-map-explainer": {
            "layout_blueprint": "map-explainer",
            "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 4, "max_stat_cards": 3, "max_annotations": 3, "max_panels": 2},
            "overflow_policy": "reduce annotations or move low-priority detail to the next scene before render",
        },
        "photo-plus-callouts": {
            "layout_blueprint": "shipping-risk-board",
            "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 3, "max_stat_cards": 2, "max_annotations": 2, "max_panels": 2},
            "overflow_policy": "preserve hero visual and reduce supporting labels before render",
        },
        "editorial-data-board": {
            "layout_blueprint": "market-dashboard",
            "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 3, "max_stat_cards": 0, "max_annotations": 2, "max_panels": 3},
            "overflow_policy": "drop low-priority callouts and shorten panel copy before render",
        },
        "split-editorial-outlook": {
            "layout_blueprint": "final-outlook",
            "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 3, "max_stat_cards": 1, "max_annotations": 2, "max_panels": 2},
            "overflow_policy": "preserve split-board structure and reduce secondary copy before render",
        },
    }
    return mapping.get(scene_type, {
        "layout_blueprint": "editorial-explainer",
        "layout_budget": {"max_headline_lines": 3, "max_dek_lines": 3, "max_stat_cards": 2, "max_annotations": 2, "max_panels": 2},
        "overflow_policy": "reduce non-essential detail before render",
    })


def creative_direction_for_run(topic: str, script: str) -> Dict[str, object]:
    genre = detect_story_genre(topic, script)
    checksum = sum(ord(ch) for ch in (topic + script))
    ticker_spec = default_ticker_spec()
    return {
        "style_seed": checksum,
        "genre": genre["genre"],
        "visual_world": genre["visual_world"],
        "layout_grammar": genre["layout_grammar"],
        "motion_language": genre["motion_language"],
        "ticker_strategy": ticker_spec,
        "anti_patterns": genre["anti_patterns"],
        "design_doc_required": True,
        "creative_direction_summary": "Create a subject-specific DESIGN.md before HTML. Use the safe zone as a layout boundary only; let the story define palette, type, information architecture, ticker strategy, and motion.",
    }


def classify_scene(text: str) -> Dict[str, object]:
    lower = text.lower()

    has_injury_status = any(word in lower for word in ["injury", "strain", "return", "ruled out", "questionable", "game-time", "status"])

    if any(word in lower for word in ["game", "series", "sweep", "lead", "playoff", "bracket", "closeout"]) and not has_injury_status:
        return {
            "slug": "sports-scoreboard",
            "scene_type": "sports-broadcast-board",
            "editorial_goal": "Make the playoff state legible immediately with a broadcast-style score or series board.",
            "headline": "Playoff pressure board",
            "dek": "Show the score, series state, and why this beat matters.",
            "layout": "large team/result lockup + compact context cards + optional ticker/source strip",
            "visual_direction": "subject-specific sports broadcast graphics with large abbreviations, score panels, and arena/control-room texture",
            "motion_direction": "score pulses, card snaps, ticker drift, and readable broadcast transitions through the beat",
            "required_assets": [
                "native HTML/CSS scoreboard or series board",
                "source/status label",
                "subject-specific broadcast texture or ticker",
            ],
            "recommended_text_elements": ["kicker", "headline", "series/result cards", "short source line"],
            "forbidden_assets": ["official team logos unless licensed", "generic dashboard cards", "tiny score text as the only story"],
        }

    if has_injury_status:
        return {
            "slug": "injury-status-board",
            "scene_type": "sports-injury-board",
            "editorial_goal": "Clarify availability without overstating certainty.",
            "headline": "Availability watch",
            "dek": "Show current status, timeline, and consequence in a clean injury/status board.",
            "layout": "headline + two status cards or timeline rows + certainty tag",
            "visual_direction": "playoff medical/status desk with team-color tension, clear labels, and source-aware language",
            "motion_direction": "status-tag pulses, timeline reveals, subtle alert-line movement, and restrained scoreboard motion",
            "required_assets": [
                "native HTML/CSS injury status cards",
                "timeline or certainty tag",
                "source/fact note",
            ],
            "recommended_text_elements": ["kicker", "headline", "status tag", "timeline row", "source line"],
            "forbidden_assets": ["confirmed-return wording without confirmation", "medical clipart filler", "official logos unless licensed"],
        }

    if any(word in lower for word in ["launch", "drop", "reveal", "release", "rollout"]):
        return {
            "slug": "launch-board",
            "scene_type": "editorial-incident-board",
            "editorial_goal": "Explain the launch or release event with a clean incident board instead of generic hype visuals.",
            "headline": "Launch signal",
            "dek": "Show the drop, timeline, and immediate market reaction in one clean frame.",
            "layout": "hero announcement board + supporting callouts + one timing strip",
            "visual_direction": "clean release board, source identity, timing, and key details",
            "motion_direction": "measured reveals, timer emphasis, subtle panel drift, continuous motion through the beat",
            "required_assets": [
                "native SVG or HTML announcement board graphics",
                "release timeline treatment",
                "supporting callout panel",
            ],
            "recommended_text_elements": ["kicker", "headline", "2 short callouts", "timing strip"],
            "forbidden_assets": ["generic hype explosions", "placeholder icons", "random rings"],
        }

    if any(word in lower for word in ["distribution", "platform", "network", "audience", "creator", "users"]):
        return {
            "slug": "distribution-flow",
            "scene_type": "editorial-map-explainer",
            "editorial_goal": "Explain distribution, platform behavior, or audience movement clearly at a glance.",
            "headline": "Distribution is the signal",
            "dek": "Use a clean flow explainer instead of noisy charts and random visual filler.",
            "layout": "distribution flow board + concentration card + audience notes",
            "visual_direction": "source-to-audience flow diagram, platform clusters, clean route-line logic",
            "motion_direction": "flow-line reveals, cluster emphasis, subtle node pulses, steady board motion",
            "required_assets": [
                "native SVG distribution flow board",
                "audience concentration card",
            ],
            "recommended_text_elements": ["headline", "2 short labels", "one concentration stat"],
            "forbidden_assets": ["rough map sketch", "generic network doodles", "floating unlabeled circles"],
        }

    if any(word in lower for word in ["views", "growth", "decline", "breakout", "breakdown", "trend", "traffic", "engagement"]):
        return {
            "slug": "trend-dashboard",
            "scene_type": "editorial-data-board",
            "editorial_goal": "Explain the trend signal with a clean premium dashboard, not noisy charts.",
            "headline": "The trend is the live intel",
            "dek": "Show growth, engagement, reach, or pressure using designed data cards and hierarchy.",
            "layout": "headline stack + 3-panel trend board + key stat strip",
            "visual_direction": "clean news dashboard, source card, engagement card, impact card, restrained palette, high signal",
            "motion_direction": "staggered panel reveals, chart line draws, card emphasis shifts, subtle camera settle",
            "required_assets": [
                "native HTML/SVG trend dashboard panels",
                "native HTML/SVG engagement or impact board",
                "native stat strip graphics",
            ],
            "recommended_text_elements": ["headline", "subhead/dek", "panel labels", "1-2 key figures"],
            "forbidden_assets": ["doodled lines", "placeholder candles", "fake unlabeled bars"],
        }

    if any(word in lower for word in ["rotation", "narrative", "run", "upside", "conviction", "next leg"]):
        return {
            "slug": "thesis-board",
            "scene_type": "split-editorial-outlook",
            "editorial_goal": "Land the thesis with a high-end split-screen outlook board tying narrative strength to market consequence.",
            "headline": "This is where the next move comes from",
            "dek": "Use a clean final thesis frame with one side for narrative drivers and one side for audience consequence.",
            "layout": "split-screen editorial board + headline lockup + closing emphasis card",
            "visual_direction": "premium split-screen combining narrative driver board and consequence panel, cinematic but orderly",
            "motion_direction": "measured split-screen motion, emphasis shift, closing lock-in, no random flourishes",
            "required_assets": [
                "native SVG narrative driver board",
                "native SVG audience consequence panel",
            ],
            "recommended_text_elements": ["headline", "short closing line", "1 label per side"],
            "forbidden_assets": ["countdown rings", "abstract end-card filler"],
        }

    return {
        "slug": "news-explainer",
        "scene_type": "editorial-explainer",
        "editorial_goal": "Make the beat understandable at a glance using elegant hierarchy and news-native visual support.",
        "headline": "News explainer beat",
        "dek": "Use a clean editorial explainer scene tied to the narration.",
        "layout": "headline + hero visual + supporting annotation",
        "visual_direction": "clean trending-news visual with native graphics, restrained palette, and precise annotations",
        "motion_direction": "subtle continuous motion with measured reveals and no dead space",
        "required_assets": ["one beat-specific native infographic treatment"],
        "recommended_text_elements": ["headline", "supporting annotation"],
        "forbidden_assets": ["placeholder graphics", "rough sketches", "generic abstract fillers"],
    }


def build_master_prompt(topic: str, script: str) -> str:
    cleaned = " ".join(script.split())
    direction = creative_direction_for_run(topic, script)
    ticker_spec = default_ticker_spec()
    return (
        "Plan a HyperFrames visual package for the top half of a vertical short-form trending-news character video. "
        f"Topic: {topic}. "
        f"Run genre: {direction['genre']}. Visual world: {direction['visual_world']}. "
        "Create a DESIGN.md first, then derive beat-specific scenes from that subject-specific visual world. "
        "The DESIGN.md must include a contextual moving ticker/news tape strategy: bottom-of-HyperFrames placement, phrase style, motion direction, and collision rules. "
        "The visible design truth is the 1080x960 top-half viewport, with primary content inside the centered 960x890 safe zone. "
        "The safe zone is only the collision boundary; it is not the art direction. "
        "Break the script into beat-level scenes and decide the best explainer format for each beat. "
        "Designed text is allowed and encouraged when it helps explain the beat: headlines, labels, numbers, source lines, and short annotations. "
        f"Every scene must include the run ticker as a secondary moving element. Ticker rule: {ticker_spec['placement']}. {ticker_spec['content_rule']} {ticker_spec['safe_zone_rule']} "
        "Do not use subtitle-style transcript overlays, placeholder SVGs, random generic shapes, or fake charts. "
        "Every beat must map to a scene concept, layout, asset plan, and motion plan. "
        f"Narration context: {cleaned}"
    )


def build_scene_prompt(topic: str, scene_text: str, classification: Dict[str, object]) -> str:
    allowed_text = ", ".join(classification["recommended_text_elements"])
    required_assets = ", ".join(classification["required_assets"])
    forbidden_assets = ", ".join(classification["forbidden_assets"])
    ticker_spec = default_ticker_spec()
    return (
        "Create a clean square 1:1 HyperFrames scene plan for the top half of a vertical short-form trending-news character video. "
        f"Story topic: {topic}. "
        f"Narration beat: {scene_text} "
        f"Scene format: {classification['scene_type']}. "
        f"Editorial goal: {classification['editorial_goal']} "
        f"Layout direction: {classification['layout']}. "
        f"Primary visual direction: {classification['visual_direction']}. "
        f"Motion direction: {classification['motion_direction']}. "
        f"Allowed on-screen text elements: {allowed_text}. "
        f"Required assets before render: {required_assets}. "
        f"Required moving ticker: include the run-level contextual ticker/news tape as a secondary moving element; {ticker_spec['placement']}. {ticker_spec['content_rule']} {ticker_spec['motion_rule']} "
        f"Forbidden assets/styles: {forbidden_assets}. "
        "Keep primary content inside the 960x890 safe zone within the 1080x960 top-half viewport. Use beautiful editorial hierarchy and HyperFrames-native composition structure. This is explanatory design, not subtitles."
    )


def build_scene_package(topic: str, script: str, total_duration: float | None) -> List[Dict[str, object]]:
    sentences = split_sentences(script)
    chunks = chunk_sentences(sentences)
    durations = allocate_durations(chunks, total_duration)
    scenes: List[Dict[str, object]] = []
    cursor = 0.0
    safe_zone = default_safe_zone()
    ticker_spec = default_ticker_spec()
    creative_direction = creative_direction_for_run(topic, script)

    for index, (chunk, duration) in enumerate(zip(chunks, durations), start=1):
        classification = classify_scene(chunk)
        blueprint = layout_blueprint_for(str(classification["scene_type"]))
        start = round(cursor, 2)
        end = round(cursor + duration, 2)
        cursor = end
        scene_id = f"scene-{index:02d}-{normalize_label(str(classification['slug']))}"
        scenes.append(
            {
                "scene_index": index,
                "scene_id": scene_id,
                "slug": classification["slug"],
                "scene_type": classification["scene_type"],
                "headline": classification["headline"],
                "dek": classification["dek"],
                "start_seconds": start,
                "end_seconds": end,
                "duration_seconds": round(duration, 2),
                "narration": chunk,
                "editorial_goal": classification["editorial_goal"],
                "layout_direction": classification["layout"],
                "visual_direction": classification["visual_direction"],
                "animation_direction": classification["motion_direction"],
                "recommended_text_elements": classification["recommended_text_elements"],
                "required_assets": classification["required_assets"],
                "forbidden_assets": classification["forbidden_assets"],
                "layout_blueprint": blueprint["layout_blueprint"],
                "creative_direction": creative_direction,
                "layout_budget": blueprint["layout_budget"],
                "overflow_policy": blueprint["overflow_policy"],
                "safe_zone_width": safe_zone["safe_zone_width"],
                "safe_zone_height": safe_zone["safe_zone_height"],
                "safe_zone_inset_left": safe_zone["safe_zone_inset_left"],
                "safe_zone_inset_top": safe_zone["safe_zone_inset_top"],
                "primary_content_anchor": safe_zone["primary_content_anchor"],
                "edge_exclusion_rule": safe_zone["edge_exclusion_rule"],
                "ticker_strategy": ticker_spec,
                "verification_checklist": [
                    "scene explains the narration beat at a glance",
                    "scene follows the run-level DESIGN.md visual world",
                    "scene includes the contextual moving ticker/news tape from the run-level DESIGN.md",
                    "ticker text is story-specific and is not a subtitle/transcript line",
                    "ticker is glued to the bottom of the HyperFrames top-half viewport directly above the avatar split",
                    "ticker does not collide with major content or the avatar split",
                    "editorial text is designed hierarchy, not subtitles",
                    "all required assets exist before render",
                    "no placeholder vectors, sketches, or fake charts",
                    "motion continues through the full beat and does not stall",
                    "all major content stays inside the centered 960x890 safe zone within the 1080x960 top-half viewport",
                    "layout is pulled inward from the outer frame edges while preserving hierarchy",
                ],
                "prompt": build_scene_prompt(topic, chunk, classification),
                "safe_crop": "top-half 1080x960 inside 1:1 master",
            }
        )
    return scenes


def main() -> int:
    args = parse_args()
    script = load_script(args.script, args.script_file)
    topic = summarize_topic(script, args.topic)
    master_prompt = build_master_prompt(topic, script)
    scenes = build_scene_package(topic, script, args.duration)
    payload = {
        "topic": topic,
        "frame": "1:1",
        "planning_mode": "editorial-hyperframes",
        "master_prompt": master_prompt,
        "creative_direction": creative_direction_for_run(topic, script),
        "scene_count": len(scenes),
        "global_rules": {
            "design_doc_required_before_html": True,
            "designed_text_allowed": True,
            "subtitle_style_text_allowed": False,
            "placeholder_graphics_allowed": False,
            "manual_sketch_assets_allowed": False,
            "native_html_css_svg_allowed_when_it_is_real_information_design": True,
            "top_half_style": "subject-specific editorial motion design with beautiful hierarchy",
            "contextual_moving_ticker_required": True,
            "ticker_spec": default_ticker_spec(),
            "validation_command": "npx hyperframes lint && npx hyperframes inspect --samples 12",
        },
        "scenes": scenes,
    }
    if args.output:
        output_path = pathlib.Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(master_prompt + "\n", encoding="utf-8")
    if args.json_output:
        json_path = pathlib.Path(args.json_output)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

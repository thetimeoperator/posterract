#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import re
import secrets
from typing import Dict, List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a beat-level HyperFrames planning package from an approved script."
    )
    parser.add_argument("--script", help="Approved script text.")
    parser.add_argument("--script-file", help="Path to file containing approved script.")
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


def layout_blueprint_for(scene_type: str) -> Dict[str, object]:
    mapping = {
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
    checksum = sum(ord(ch) for ch in (topic + script))
    run_nonce = secrets.randbelow(10_000_000)
    style_key = checksum + run_nonce
    palettes = [
        {"palette_mode": "crypto/NFTprint-contrast", "palette_note": "warm paper, charcoal text, restrained red alerts"},
        {"palette_mode": "signal-terminal", "palette_note": "dark graphite, cyan signal lines, amber labels"},
        {"palette_mode": "premium-broadcast", "palette_note": "deep navy, ivory text, polished gold accents"},
        {"palette_mode": "macro-ledger", "palette_note": "slate base, mint/red market accents, financial briefing tone"},
    ]
    typography = [
        {"type_mode": "serif-headline-sans-body", "type_note": "editorial serif headline with clean sans body"},
        {"type_mode": "all-sans-broadcast", "type_note": "strong sans headlines with compact data typography"},
        {"type_mode": "ledger-serif-mix", "type_note": "financial-report serif paired with neutral sans labels"},
    ]
    surface = [
        {"surface_mode": "thin-rule-paper-cards", "surface_note": "thin borders, flatter cards, print-like hierarchy"},
        {"surface_mode": "glass-panel-dashboard", "surface_note": "layered translucent panels with clean depth"},
        {"surface_mode": "solid-panel-briefing", "surface_note": "opaque briefing cards with hard separation"},
    ]
    motion = [
        {"motion_mode": "measured-editorial", "motion_note": "measured reveals, line draws, slow camera drift"},
        {"motion_mode": "broadcast-snap", "motion_note": "tighter card reveals, stronger emphasis shifts, still readable"},
        {"motion_mode": "calm-dossier", "motion_note": "subtle parallax, restrained transitions, steady information pacing"},
    ]
    annotation = [
        {"annotation_mode": "capsule-labels", "annotation_note": "pill labels and concise callouts"},
        {"annotation_mode": "rule-callouts", "annotation_note": "thin rules with anchored notes"},
        {"annotation_mode": "inline-stat-markers", "annotation_note": "small inline badges and stat markers"},
    ]
    return {
        "run_nonce": run_nonce,
        "palette": palettes[style_key % len(palettes)],
        "typography": typography[(style_key // 3) % len(typography)],
        "surface": surface[(style_key // 5) % len(surface)],
        "motion": motion[(style_key // 7) % len(motion)],
        "annotation": annotation[(style_key // 11) % len(annotation)],
        "creative_direction_summary": "Generate a fresh style this run by varying palette, typography, surface treatment, chart/map styling, annotation style, and motion language while keeping the same no-overlap safe-zone rules.",
    }


def classify_scene(text: str) -> Dict[str, object]:
    lower = text.lower()

    if any(word in lower for word in ["mint", "launch", "drop", "reveal", "collection"]):
        return {
            "slug": "mint-launch",
            "scene_type": "editorial-incident-board",
            "editorial_goal": "Explain the launch or mint event with a clean collection board instead of generic hype visuals.",
            "headline": "Launch and mint signal",
            "dek": "Show the drop, timeline, and immediate market reaction in one clean frame.",
            "layout": "hero collection board + supporting callouts + one timing strip",
            "visual_direction": "clean NFT drop board, collection identity, mint timing, and key release details",
            "motion_direction": "measured reveals, timer emphasis, subtle panel drift, continuous motion through the beat",
            "required_assets": [
                "native SVG or HTML collection board graphics",
                "mint timeline treatment",
                "supporting callout panel",
            ],
            "recommended_text_elements": ["kicker", "headline", "2 short callouts", "timing strip"],
            "forbidden_assets": ["generic hype explosions", "placeholder icons", "random rings"],
        }

    if any(word in lower for word in ["wallet", "whale", "accumulation", "distribution", "holders"]):
        return {
            "slug": "wallet-flow",
            "scene_type": "editorial-map-explainer",
            "editorial_goal": "Explain wallet concentration, whale behavior, or holder structure clearly at a glance.",
            "headline": "Wallet flow is the signal",
            "dek": "Use a clean wallet-flow explainer instead of noisy charts and random token art.",
            "layout": "wallet flow board + concentration card + distribution notes",
            "visual_direction": "onchain flow diagram, wallet clusters, holder concentration, clean route-line logic",
            "motion_direction": "flow-line reveals, cluster emphasis, subtle node pulses, steady board motion",
            "required_assets": [
                "native SVG wallet flow board",
                "holder concentration card",
            ],
            "recommended_text_elements": ["headline", "2 short labels", "one concentration stat"],
            "forbidden_assets": ["rough map sketch", "generic network doodles", "floating unlabeled circles"],
        }

    if any(word in lower for word in ["volume", "floor", "breakout", "breakdown", "liquidity", "open interest", "funding", "squeeze"]):
        return {
            "slug": "market-dashboard",
            "scene_type": "editorial-data-board",
            "editorial_goal": "Explain the market signal with a clean premium crypto dashboard, not noisy charts.",
            "headline": "The tape is the live intel",
            "dek": "Show price, volume, liquidity, or floor pressure using designed crypto-native data cards and hierarchy.",
            "layout": "headline stack + 3-panel market board + key stat strip",
            "visual_direction": "clean crypto dashboard, token price card, volume card, liquidity/floor card, restrained palette, high signal",
            "motion_direction": "staggered panel reveals, chart line draws, card emphasis shifts, subtle camera settle",
            "required_assets": [
                "native HTML/SVG token dashboard panels",
                "native HTML/SVG volume or floor board",
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
            "dek": "Use a clean final thesis frame with one side for narrative drivers and one side for market consequence.",
            "layout": "split-screen editorial board + headline lockup + closing emphasis card",
            "visual_direction": "premium split-screen combining narrative driver board and market consequence panel, cinematic but orderly",
            "motion_direction": "measured split-screen motion, emphasis shift, closing lock-in, no random flourishes",
            "required_assets": [
                "native SVG narrative driver board",
                "native SVG market consequence panel",
            ],
            "recommended_text_elements": ["headline", "short closing line", "1 label per side"],
            "forbidden_assets": ["countdown rings", "abstract end-card filler"],
        }

    return {
        "slug": "crypto-explainer",
        "scene_type": "editorial-explainer",
        "editorial_goal": "Make the beat understandable at a glance using elegant hierarchy and crypto-native visual support.",
        "headline": "Crypto explainer beat",
        "dek": "Use a clean crypto-native explainer scene tied to the narration.",
        "layout": "headline + hero visual + supporting annotation",
        "visual_direction": "clean crypto/NFT visual with native graphics, restrained palette, and precise annotations",
        "motion_direction": "subtle continuous motion with measured reveals and no dead space",
        "required_assets": ["one beat-specific native infographic treatment"],
        "recommended_text_elements": ["headline", "supporting annotation"],
        "forbidden_assets": ["placeholder graphics", "rough sketches", "generic abstract fillers"],
    }


def build_master_prompt(topic: str, script: str) -> str:
    cleaned = " ".join(script.split())
    return (
        "Plan a square 1:1 HyperFrames visual package for the top half of a vertical short-form crypto/NFT video. "
        f"Topic: {topic}. "
        "The top half should feel like premium crypto-native motion design: clean typography, strong visual hierarchy, token dashboards, wallet boards, volume cards, floor-price cards, and information graphics when useful. "
        "This is not a subtitle layer and not an abstract motion-graphics sandbox. "
        "Break the script into beat-level scenes and decide the best explainer format for each beat. "
        "Designed text is allowed and encouraged when it helps explain the beat: headlines, labels, numbers, source lines, and short annotations. "
        "Do not use placeholder SVGs, homemade sketch graphics, random generic shapes, or fake charts. "
        "Every beat must map to a scene concept, layout, asset plan, and motion plan. "
        f"Narration context: {cleaned}"
    )


def build_scene_prompt(topic: str, scene_text: str, classification: Dict[str, object]) -> str:
    allowed_text = ", ".join(classification["recommended_text_elements"])
    required_assets = ", ".join(classification["required_assets"])
    forbidden_assets = ", ".join(classification["forbidden_assets"])
    return (
        "Create a clean square 1:1 HyperFrames scene plan for the top half of a vertical short-form crypto/NFT video. "
        f"Story topic: {topic}. "
        f"Narration beat: {scene_text} "
        f"Scene format: {classification['scene_type']}. "
        f"Editorial goal: {classification['editorial_goal']} "
        f"Layout direction: {classification['layout']}. "
        f"Primary visual direction: {classification['visual_direction']}. "
        f"Motion direction: {classification['motion_direction']}. "
        f"Allowed on-screen text elements: {allowed_text}. "
        f"Required assets before render: {required_assets}. "
        f"Forbidden assets/styles: {forbidden_assets}. "
        "Use beautiful editorial hierarchy and HyperFrames-native composition structure. This is explanatory design, not subtitles."
    )


def build_scene_package(topic: str, script: str, total_duration: float | None) -> List[Dict[str, object]]:
    sentences = split_sentences(script)
    chunks = chunk_sentences(sentences)
    durations = allocate_durations(chunks, total_duration)
    scenes: List[Dict[str, object]] = []
    cursor = 0.0
    safe_zone = default_safe_zone()
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
                "verification_checklist": [
                    "scene explains the narration beat at a glance",
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
            "designed_text_allowed": True,
            "subtitle_style_text_allowed": False,
            "placeholder_graphics_allowed": False,
            "manual_sketch_assets_allowed": False,
            "real_assets_required_before_render": True,
            "top_half_style": "clean editorial motion design with beautiful hierarchy",
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

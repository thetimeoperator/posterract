#!/usr/bin/env python3
"""HeyGen helper for reference-image prep and bottom-half talking-head renders."""

from __future__ import annotations

import argparse
import difflib
import json
import math
import mimetypes
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Sequence


BASE_URL = "https://api.heygen.com"
ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech"
SCRIPT_PATH = pathlib.Path(__file__).resolve()
SKILL_DIR = SCRIPT_PATH.parent.parent
ASSET_DIR = SKILL_DIR / "assets"
DEFAULT_IMAGE_PATH = ASSET_DIR / "reference-image.jpg"
DEFAULT_FONT_PATH = ASSET_DIR / "fonts" / "caption-font.otf"
WORKSPACE_ROOT = SCRIPT_PATH.parents[5]
DEFAULT_VIDEO_CONFIG_PATH = WORKSPACE_ROOT / "config" / "video.json"
DEFAULT_OUTPUT_DIR = WORKSPACE_ROOT / "output" / "drafts"
DEFAULT_FONT_NAME = "SDDystopianDemo"
DEFAULT_ELEVENLABS_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_CAPTION_ZONE = "lower-third"
DEFAULT_TITLE_MAX_LINE_CHARS = 20
DEFAULT_TITLE_FALLBACK = "TRENDING NEWS ALERT"

NORMALIZE_RE = re.compile(r"[^a-z0-9']+")
SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._-]+")
TITLE_ENTITY_RE = re.compile(r"\b[A-Za-z][A-Za-z'/-]*\b")
TITLE_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "says",
    "that",
    "the",
    "their",
    "this",
    "to",
    "today",
    "tomorrow",
    "what",
    "while",
    "with",
    "you",
}
TITLE_ENTITY_BLOCKLIST = TITLE_STOPWORDS | {
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
}
TITLE_IGNORE_PREFIXES = (
    "what this means",
    "you need to",
    "you are",
    "stay calm",
    "stay disciplined",
    "protect your",
    "do not",
)
TITLE_SIGNAL_PATTERNS = (
    (re.compile(r"\b(could be hit|could hit|will be hit|warning|warn|threat|deadline|ultimatum)\b"), ("DEADLINE", "SIGNAL")),
    (re.compile(r"\b(attack|attacks|attacked|strike|strikes|struck|bomb|bombs|bombed|hit|hits|missile|missiles)\b"), ("MOVE",)),
    (re.compile(r"\b(war|conflict|escalation|escalate|escalates|escalated)\b"), ("RUN",)),
    (re.compile(r"\b(launch|launches|launched|release|releases|released|unveil|unveils|unveiled|announce|announces|announced|drop|drops|dropped)\b"), ("SHAKEUP",)),
    (re.compile(r"\b(ban|bans|banned|sanction|sanctions|sanctioned|block|blocks|blocked|cut|cuts|crackdown)\b"), ("CRACKDOWN",)),
    (re.compile(r"\b(crash|crashes|crashed|collapse|collapses|collapsed|fall|falls|fell|selloff)\b"), ("CRASH",)),
    (re.compile(r"\b(surge|surges|surged|jump|jumps|jumped|soar|soars|soared|rally|rallies|rallied)\b"), ("SURGE",)),
    (re.compile(r"\b(cash|market|markets|shipping|energy|jobs)\b"), ("ALERT",)),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HeyGen helper for talking-photo setup and bottom-half talking-head renders.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight = subparsers.add_parser("preflight", help="Check quota and list sample groups and voices.")
    preflight.add_argument("--voice-id", help="Optional voice id to verify.")
    preflight.add_argument("--group-id", help="Optional avatar group id to verify.")

    upload = subparsers.add_parser("upload-image", help="Upload a reference image to HeyGen assets.")
    upload.add_argument("--image-file", default=str(DEFAULT_IMAGE_PATH))

    create_group = subparsers.add_parser("create-photo-group", help="Create a photo avatar group from an uploaded image key.")
    create_group.add_argument("--name", required=True)
    create_group.add_argument("--image-key", required=True)

    train_group = subparsers.add_parser("train-photo-group", help="Start training for a photo avatar group.")
    train_group.add_argument("--group-id", required=True)

    list_group = subparsers.add_parser("list-group-avatars", help="List all avatars in a photo avatar group.")
    list_group.add_argument("--group-id", required=True)

    render = subparsers.add_parser("render", help="Submit a HeyGen render for the bottom-half talking-head asset.")
    render.add_argument("--script", help="Script text.")
    render.add_argument("--script-file", help="Path to a file containing the script.")
    render.add_argument("--avatar-id", help="HeyGen full avatar id. Falls back to HEYGEN_AVATAR_ID.")
    render.add_argument("--talking-photo-id", help="HeyGen talking photo id or avatar look id. Falls back to HEYGEN_TALKING_PHOTO_ID or HEYGEN_AVATAR_LOOK_ID.")
    render.add_argument("--run-slot", type=int, choices=(1, 2, 3), help="Daily run slot used for avatar-look rotation.")
    render.add_argument("--voice-id", help="HeyGen voice ID for native text-to-speech mode.")
    render.add_argument("--elevenlabs-voice-id", help="ElevenLabs voice id for external-audio mode.")
    render.add_argument("--elevenlabs-model", default=DEFAULT_ELEVENLABS_TTS_MODEL, help="ElevenLabs text-to-speech model for external-audio mode.")
    render.add_argument("--elevenlabs-output-format", default=DEFAULT_ELEVENLABS_OUTPUT_FORMAT, help="ElevenLabs output format query parameter, for example mp3_44100_128.")
    render.add_argument("--width", type=int, default=1080)
    render.add_argument("--height", type=int, default=1920)
    render.add_argument("--bg-color", default="#101010")
    render.add_argument("--wait", action="store_true", help="Poll until render completes or fails.")
    render.add_argument("--poll-interval", type=int, default=10)
    render.add_argument("--timeout-seconds", type=int, default=600)
    render.add_argument("--download-dir", help="Optional directory to save the completed raw render.")
    render.add_argument("--finalize-output-dir", help="Legacy optional directory for transcript/subtitle artifacts. Leave unset for the current no-captions workflow.")
    render.add_argument("--font-file", default=str(DEFAULT_FONT_PATH))
    render.add_argument("--font-name", help="Optional font family override for ASS generation.")
    render.add_argument("--title", help="Optional persistent top title for the whole video. Auto-generated from the script when omitted.")
    render.add_argument("--title-file", help="Path to a file containing the persistent top title.")
    render.add_argument("--scribe-model", default="scribe_v2", help="ElevenLabs transcription model to use for word timestamps.")
    render.add_argument("--language-code", default="en", help="Optional ISO-639 language hint for ElevenLabs Scribe.")
    render.add_argument("--transcript-json", help="Optional existing transcript JSON with word timestamps.")
    render.add_argument("--keep-audio", action="store_true", help="Keep the extracted WAV after transcription.")
    render.add_argument("--max-line-chars", type=int, default=18)
    render.add_argument("--max-words-per-cue", type=int, default=7)
    render.add_argument("--caption-zone", choices=("upper-third", "lower-third"), default=DEFAULT_CAPTION_ZONE)

    finalize = subparsers.add_parser("finalize", help="Download or load a raw video, transcribe it, and burn timed captions.")
    source_group = finalize.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--video-file", help="Existing local raw render path.")
    source_group.add_argument("--video-url", help="Completed HeyGen video URL.")
    finalize.add_argument("--script", help="Approved final script.")
    finalize.add_argument("--script-file", help="Path to a file containing the approved final script.")
    finalize.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for all generated caption assets.")
    finalize.add_argument("--basename", help="Optional basename for generated assets.")
    finalize.add_argument("--font-file", default=str(DEFAULT_FONT_PATH))
    finalize.add_argument("--font-name", help="Optional font family override for ASS generation.")
    finalize.add_argument("--title", help="Optional persistent top title for the whole video. Auto-generated from the script when omitted.")
    finalize.add_argument("--title-file", help="Path to a file containing the persistent top title.")
    finalize.add_argument("--scribe-model", default="scribe_v2", help="ElevenLabs transcription model to use for word timestamps.")
    finalize.add_argument("--language-code", default="en", help="Optional ISO-639 language hint for ElevenLabs Scribe.")
    finalize.add_argument("--transcript-json", help="Optional existing transcript JSON with word timestamps.")
    finalize.add_argument("--keep-audio", action="store_true", help="Keep the extracted WAV after transcription.")
    finalize.add_argument("--max-line-chars", type=int, default=18)
    finalize.add_argument("--max-words-per-cue", type=int, default=7)
    finalize.add_argument("--caption-zone", choices=("upper-third", "lower-third"), default=DEFAULT_CAPTION_ZONE)

    status = subparsers.add_parser("status", help="Fetch status for a video id.")
    status.add_argument("--video-id", required=True)
    return parser.parse_args()


def api_key() -> str:
    value = os.environ.get("HEYGEN_API_KEY")
    if not value:
        raise RuntimeError("HEYGEN_API_KEY is missing")
    return value


def elevenlabs_api_key() -> str:
    value = os.environ.get("ELEVENLABS_API_KEY")
    if not value:
        raise RuntimeError("ELEVENLABS_API_KEY is missing")
    return value


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if not value:
        return None
    return value.strip() or None


def load_json_file(path: pathlib.Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def video_config() -> Dict[str, Any]:
    return load_json_file(DEFAULT_VIDEO_CONFIG_PATH)


def config_string(*keys: str) -> str | None:
    current: Any = video_config()
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    if current is None:
        return None
    value = str(current).strip()
    if not value or value.startswith("replace-with") or value == "replace-me":
        return None
    return value


def config_string_list(*keys: str) -> List[str]:
    current: Any = video_config()
    for key in keys:
        if not isinstance(current, dict):
            return []
        current = current.get(key)
    if not isinstance(current, list):
        return []
    values: List[str] = []
    for item in current:
        value = str(item).strip()
        if not value or value.startswith("replace-with") or value == "replace-me":
            continue
        values.append(value)
    return values


def resolve_rotating_avatar_look_id(args: argparse.Namespace) -> str | None:
    if args.talking_photo_id:
        return args.talking_photo_id

    talking_photo_id = env_value("HEYGEN_TALKING_PHOTO_ID") or config_string("ids", "heygen_talking_photo_id")
    if talking_photo_id:
        return talking_photo_id

    avatar_look_id = env_value("HEYGEN_AVATAR_LOOK_ID")
    if avatar_look_id:
        return avatar_look_id

    rotation_look_ids = config_string_list("avatar_rotation", "avatar_look_ids")
    if rotation_look_ids:
        run_slot = args.run_slot or int(config_string("avatar_rotation", "default_run_slot") or "1")
        index = run_slot - 1
        if index >= len(rotation_look_ids):
            raise RuntimeError(f"Run slot {run_slot} exceeds configured avatar rotation size {len(rotation_look_ids)}")
        return rotation_look_ids[index]

    return config_string("ids", "heygen_avatar_look_id")


def resolve_character(args: argparse.Namespace) -> tuple[Dict[str, Any], Dict[str, Any]]:
    avatar_id = args.avatar_id or env_value("HEYGEN_AVATAR_ID") or config_string("ids", "heygen_avatar_id")
    talking_photo_id = resolve_rotating_avatar_look_id(args)

    if avatar_id:
        return (
            {
                "type": "avatar",
                "avatar_id": avatar_id,
                "avatar_style": "normal",
            },
            {
                "character_type": "avatar",
                "character_id": avatar_id,
            },
        )

    if talking_photo_id:
        return (
            {
                "type": "talking_photo",
                "talking_photo_id": talking_photo_id,
            },
            {
                "character_type": "talking_photo",
                "character_id": talking_photo_id,
            },
        )

    raise RuntimeError("Provide --avatar-id or --talking-photo-id, or set HEYGEN_AVATAR_ID / HEYGEN_TALKING_PHOTO_ID / HEYGEN_AVATAR_LOOK_ID.")


def request_json(method: str, path: str, *, params: Dict[str, str] | None = None, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    url = f"{BASE_URL}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    data = None
    headers = {
        "Accept": "application/json",
        "X-Api-Key": api_key(),
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HeyGen HTTP {exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HeyGen connection error: {exc}") from exc


def request_multipart(method: str, url: str, *, file_field: str, file_path: str) -> Dict[str, Any]:
    del file_field
    filename = pathlib.Path(file_path).name
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(file_path, "rb") as handle:
        file_bytes = handle.read()

    request = urllib.request.Request(
        url,
        data=file_bytes,
        method=method,
        headers={
            "Accept": "application/json",
            "X-Api-Key": api_key(),
            "Content-Type": mime_type,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HeyGen HTTP {exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HeyGen connection error: {exc}") from exc


def request_multipart_form(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    fields: Dict[str, Any] | None = None,
    file_field: str | None = None,
    file_path: str | None = None,
) -> Dict[str, Any]:
    boundary = f"----codex-{uuid.uuid4().hex}"
    lines: List[bytes] = []

    for name, value in (fields or {}).items():
        if value is None:
            continue
        if isinstance(value, bool):
            encoded_value = "true" if value else "false"
        else:
            encoded_value = str(value)
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        lines.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        lines.append(encoded_value.encode("utf-8"))
        lines.append(b"\r\n")

    if file_field and file_path:
        filename = pathlib.Path(file_path).name
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with open(file_path, "rb") as handle:
            file_bytes = handle.read()
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        lines.append(
            (
                f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                f"Content-Type: {mime_type}\r\n\r\n"
            ).encode("utf-8")
        )
        lines.append(file_bytes)
        lines.append(b"\r\n")

    lines.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(lines)
    request_headers = dict(headers)
    request_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    request = urllib.request.Request(url, data=body, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Multipart request failed with HTTP {exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Multipart request connection error: {exc}") from exc


def request_bytes(method: str, url: str, *, headers: Dict[str, str], body: Dict[str, Any] | None = None) -> tuple[bytes, Dict[str, str]]:
    data = None
    request_headers = dict(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = response.read()
            response_headers = dict(response.info().items())
            return payload, response_headers
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Binary request failed with HTTP {exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Binary request connection error: {exc}") from exc


def load_script(script: str | None, script_file: str | None) -> str:
    if script:
        return script.strip()
    if script_file:
        with open(script_file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    raise RuntimeError("Provide --script or --script-file")


def load_optional_text(value: str | None, value_file: str | None) -> str | None:
    if value:
        return value.strip() or None
    if value_file:
        with open(value_file, "r", encoding="utf-8") as handle:
            return handle.read().strip() or None
    return None


def ensure_dir(path: pathlib.Path) -> pathlib.Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_stem(value: str) -> str:
    stem = SAFE_STEM_RE.sub("-", value).strip("-._")
    return stem or "crypto/NFT-character"


def split_script_sentences(script: str) -> List[str]:
    sentences = re.split(r"(?<=[.!?])\s+", script.strip())
    return [sentence.strip() for sentence in sentences if sentence.strip()]


def extract_title_entities(sentence: str) -> List[str]:
    entities: List[str] = []
    seen = set()
    for token in TITLE_ENTITY_RE.findall(sentence):
        lower = token.lower()
        upper = token.upper()
        if lower in TITLE_ENTITY_BLOCKLIST:
            continue
        if not (token[0].isupper() or upper in {"AI", "USA", "US", "UK", "EU", "NATO", "IPO", "SEC"}):
            continue
        if upper in seen:
            continue
        seen.add(upper)
        entities.append(upper)
    return entities


def detect_title_action(sentence: str) -> str | None:
    lower = sentence.lower()
    if any(phrase in lower for phrase in ("could be hit", "could hit", "will be hit", "deadline", "warning", "warn", "threat")):
        return "SIGNALENS"
    if re.search(r"\b(attack|attacks|attacked|strike|strikes|struck|bomb|bombs|bombed|hit|hits)\b", lower):
        return "ATTACKS"
    if re.search(r"\b(launch|launches|launched|release|releases|released|unveil|unveils|unveiled|announce|announces|announced|drop|drops|dropped)\b", lower):
        return "DROPS"
    if re.search(r"\b(ban|bans|banned|sanction|sanctions|sanctioned|block|blocks|blocked|cut|cuts)\b", lower):
        return "SQUEEZES"
    if re.search(r"\b(crash|crashes|crashed|collapse|collapses|collapsed|fall|falls|fell)\b", lower):
        return "CRASHES"
    if re.search(r"\b(surge|surges|surged|jump|jumps|jumped|soar|soars|soared)\b", lower):
        return "SURGES"
    if re.search(r"\b(test|tests|testing)\b", lower):
        return "TESTS"
    return None


def score_title_sentence(sentence: str) -> tuple[int, int]:
    lower = sentence.lower()
    entities = extract_title_entities(sentence)
    action = detect_title_action(sentence)
    impact_terms = sum(
        1
        for term in (
            "attack",
            "strike",
            "war",
            "deadline",
            "threat",
            "iran",
            "trump",
            "ai",
            "market",
            "cash",
            "jobs",
            "launch",
            "release",
            "ban",
            "sanction",
        )
        if term in lower
    )
    penalty = 6 if lower.startswith(TITLE_IGNORE_PREFIXES) else 0
    return (len(entities) * 4) + (5 if action else 0) + impact_terms - penalty, -len(sentence)


def compress_title_words(sentence: str) -> str:
    kept: List[str] = []
    for token in TITLE_ENTITY_RE.findall(sentence):
        normalized = normalize_word(token)
        if not normalized or normalized in TITLE_STOPWORDS:
            continue
        kept.append(token.upper())
    if not kept:
        return DEFAULT_TITLE_FALLBACK
    for width in range(min(len(kept), 6), 2, -1):
        candidate = kept[:width]
        if wrap_caption_words(candidate, DEFAULT_TITLE_MAX_LINE_CHARS):
            return " ".join(candidate)
    return " ".join(kept[:4])


def extract_signal_tokens(sentence: str) -> List[str]:
    lower = sentence.lower()
    tokens: List[str] = []
    for pattern, values in TITLE_SIGNAL_PATTERNS:
        if not pattern.search(lower):
            continue
        for value in values:
            if value not in tokens:
                tokens.append(value)
    return tokens


def build_title_phrase(entities: List[str], signals: List[str], sentence: str) -> str:
    tokens: List[str] = []

    for entity in entities[:2]:
        if entity not in tokens:
            tokens.append(entity)

    for signal in signals:
        if signal not in tokens:
            tokens.append(signal)
        if len(tokens) >= 3:
            break

    if not tokens and "ai" in sentence.lower():
        tokens = ["AI", "ALERT"]
    if not tokens and "cash" in sentence.lower():
        tokens = ["CASH", "ALERT"]
    if not tokens:
        return compress_title_words(sentence)

    for width in range(min(len(tokens), 4), 1, -1):
        candidate = tokens[:width]
        if wrap_caption_words(candidate, DEFAULT_TITLE_MAX_LINE_CHARS):
            return " ".join(candidate)
    return " ".join(tokens[:2])


def generate_overlay_title(script: str) -> str:
    sentences = split_script_sentences(script)
    if not sentences:
        return DEFAULT_TITLE_FALLBACK

    ranked = sorted(sentences[:4], key=score_title_sentence, reverse=True)
    seed = ranked[0]
    entities = extract_title_entities(seed)
    signals = extract_signal_tokens(seed)
    return build_title_phrase(entities, signals, seed)


def resolve_overlay_title(title: str | None, title_file: str | None, script: str) -> tuple[str, str]:
    explicit = load_optional_text(title, title_file)
    if explicit:
        normalized = " ".join(explicit.split())
        return normalized, "manual"
    generated = " ".join(generate_overlay_title(script).split())
    return generated or DEFAULT_TITLE_FALLBACK, "auto"


def wrap_title_lines(title_text: str, *, max_line_chars: int = DEFAULT_TITLE_MAX_LINE_CHARS) -> List[str]:
    words = title_text.split()
    if not words:
        return [DEFAULT_TITLE_FALLBACK]

    lines = wrap_caption_words(words, max_line_chars)
    if lines:
        return lines

    def greedy_wrap(width: int) -> List[str]:
        wrapped: List[str] = []
        current: List[str] = []
        for word in words:
            trial = " ".join(current + [word])
            if current and len(trial) > width:
                wrapped.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            wrapped.append(" ".join(current))
        return wrapped

    max_word_len = max(len(word) for word in words)
    target_width = max(max_line_chars, max_word_len)
    hard_width = max(target_width, min(42, len(title_text)))

    for allowed_lines in (2, 3, 4):
        for width in range(target_width, hard_width + 1):
            wrapped = greedy_wrap(width)
            if len(wrapped) <= allowed_lines:
                return wrapped

    return greedy_wrap(hard_width)


def resolve_title_style(title_lines: Sequence[str]) -> Dict[str, int]:
    line_count = max(1, len(title_lines))
    longest = max((len(line) for line in title_lines), default=0)
    font_size = 48
    margin_v = 128

    if line_count >= 3:
        font_size = min(font_size, 42)
        margin_v = 108
    if line_count >= 4:
        font_size = min(font_size, 36)
        margin_v = 92
    if longest > 20:
        font_size = min(font_size, 44)
    if longest > 26:
        font_size = min(font_size, 40)
    if longest > 32:
        font_size = min(font_size, 36)

    return {
        "font_size": font_size,
        "margin_v": margin_v,
    }


def normalize_status(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = payload.get("data", payload)
    return {
        "render_status": data.get("status") or payload.get("status"),
        "video_id": data.get("video_id") or payload.get("video_id"),
        "video_url": data.get("video_url") or payload.get("video_url"),
        "error": data.get("error") or payload.get("error"),
        "raw": payload,
    }


def run_command(command: Sequence[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    return result


def ensure_binary(name: str) -> str:
    binary = shutil.which(name)
    if not binary:
        raise RuntimeError(f"Required binary not found in PATH: {name}")
    return binary


def download_file(url: str, destination: pathlib.Path) -> pathlib.Path:
    ensure_dir(destination.parent)
    request = urllib.request.Request(url, headers={"User-Agent": "crypto/NFT-character-asset-download"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response, open(destination, "wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Asset download failed with HTTP {exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Asset download connection error: {exc}") from exc
    return destination


def output_extension(output_format: str) -> str:
    prefix = output_format.split("_", 1)[0].lower()
    if prefix in {"mp3", "pcm", "wav", "ulaw", "mulaw"}:
        return "wav" if prefix == "pcm" else prefix
    return "bin"


def generate_elevenlabs_speech(
    *,
    text: str,
    voice_id: str,
    model_id: str,
    output_format: str,
    language_code: str | None,
    destination: pathlib.Path,
) -> pathlib.Path:
    url = f"{ELEVENLABS_TTS_URL}/{urllib.parse.quote(voice_id)}?{urllib.parse.urlencode({'output_format': output_format})}"
    body: Dict[str, Any] = {
        "text": text,
        "model_id": model_id,
    }
    if language_code:
        body["language_code"] = language_code
    audio_bytes, _headers = request_bytes(
        "POST",
        url,
        headers={
            "Accept": "application/octet-stream",
            "xi-api-key": elevenlabs_api_key(),
        },
        body=body,
    )
    ensure_dir(destination.parent)
    with open(destination, "wb") as handle:
        handle.write(audio_bytes)
    return destination


def upload_heygen_asset(file_path: pathlib.Path) -> Dict[str, Any]:
    payload = request_multipart("POST", "https://upload.heygen.com/v1/asset", file_field="file", file_path=str(file_path))
    data = payload.get("data", payload)
    return {
        "asset_id": data.get("asset_id") or data.get("id"),
        "asset_key": data.get("image_key") or data.get("asset_key") or data.get("key"),
        "raw": payload,
    }


def resolve_render_voice(args: argparse.Namespace, script: str) -> tuple[Dict[str, Any], Dict[str, Any] | None]:
    heygen_voice_id = args.voice_id or env_value("HEYGEN_VOICE_ID") or config_string("ids", "heygen_voice_id")
    elevenlabs_voice_id = args.elevenlabs_voice_id or env_value("ELEVENLABS_VOICE_ID") or config_string("ids", "elevenlabs_voice_id")

    if heygen_voice_id and elevenlabs_voice_id:
        raise RuntimeError("Provide only one voice provider at a time: HeyGen voice_id or ElevenLabs voice_id.")
    if not heygen_voice_id and not elevenlabs_voice_id:
        raise RuntimeError("Provide --voice-id for HeyGen TTS or --elevenlabs-voice-id for external ElevenLabs audio.")

    if heygen_voice_id:
        return (
            {
                "type": "text",
                "input_text": script,
                "voice_id": heygen_voice_id,
                "speed": 1.0,
            },
            {
                "provider": "heygen",
                "voice_id": heygen_voice_id,
            },
        )

    temp_dir = pathlib.Path(
        args.finalize_output_dir
        or args.download_dir
        or tempfile.mkdtemp(prefix="crypto/NFT-character-elevenlabs-")
    )
    ensure_dir(temp_dir)
    file_ext = output_extension(args.elevenlabs_output_format)
    audio_file = temp_dir / f"{safe_stem(elevenlabs_voice_id or 'elevenlabs')}-tts.{file_ext}"
    generate_elevenlabs_speech(
        text=script,
        voice_id=elevenlabs_voice_id or "",
        model_id=args.elevenlabs_model,
        output_format=args.elevenlabs_output_format,
        language_code=args.language_code,
        destination=audio_file,
    )
    uploaded = upload_heygen_asset(audio_file)
    asset_id = uploaded["asset_id"]
    if not asset_id:
        raise RuntimeError("HeyGen audio upload did not return an asset_id.")
    return (
        {
            "type": "audio",
            "audio_asset_id": asset_id,
        },
        {
            "provider": "elevenlabs",
            "voice_id": elevenlabs_voice_id,
            "model_id": args.elevenlabs_model,
            "output_format": args.elevenlabs_output_format,
            "audio_file": str(audio_file),
            "audio_asset_id": asset_id,
        },
    )


def ffprobe_duration(video_path: pathlib.Path) -> float:
    ensure_binary("ffprobe")
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
    )
    return float(result.stdout.strip())


def ffprobe_dimensions(video_path: pathlib.Path) -> tuple[int, int]:
    ensure_binary("ffprobe")
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            str(video_path),
        ]
    )
    width_text, height_text = result.stdout.strip().split("x", 1)
    return int(width_text), int(height_text)


def extract_audio(video_path: pathlib.Path, audio_path: pathlib.Path) -> pathlib.Path:
    ensure_binary("ffmpeg")
    ensure_dir(audio_path.parent)
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(audio_path),
        ]
    )
    return audio_path


def run_elevenlabs_transcription(
    audio_path: pathlib.Path,
    *,
    model_id: str,
    language_code: str | None,
) -> Dict[str, Any]:
    payload = request_multipart_form(
        "POST",
        ELEVENLABS_STT_URL,
        headers={
            "Accept": "application/json",
            "xi-api-key": elevenlabs_api_key(),
        },
        fields={
            "model_id": model_id,
            "timestamps_granularity": "word",
            "file_format": "pcm_s16le_16",
            "tag_audio_events": False,
            "diarize": False,
            "language_code": language_code or None,
        },
        file_field="file",
        file_path=str(audio_path),
    )
    return {
        "backend": "elevenlabs_scribe",
        "model": model_id,
        "result": payload,
    }


def load_transcription(
    *,
    audio_path: pathlib.Path,
    transcript_json: pathlib.Path | None,
    model_id: str,
    language_code: str | None,
) -> Dict[str, Any]:
    if transcript_json:
        with open(transcript_json, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return {
            "backend": "provided-json",
            "model": "n/a",
            "result": payload,
            "transcript_path": str(transcript_json),
        }
    return run_elevenlabs_transcription(audio_path, model_id=model_id, language_code=language_code)


def normalize_word(text: str) -> str:
    return NORMALIZE_RE.sub("", text.lower())


def extract_timed_words(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    words: List[Dict[str, Any]] = []
    if "words" in payload:
        iterable = payload.get("words", [])
        for item in iterable or []:
            if item.get("type") != "word":
                continue
            word_text = str(item.get("text", "")).strip()
            normalized = normalize_word(word_text)
            start = item.get("start")
            end = item.get("end")
            if not normalized or start is None or end is None:
                continue
            words.append(
                {
                    "display": word_text,
                    "normalized": normalized,
                    "start": float(start),
                    "end": float(end),
                }
            )
    else:
        segments = payload.get("segments", [])
        for segment in segments:
            for item in segment.get("words", []) or []:
                word_text = str(item.get("word", "")).strip()
                normalized = normalize_word(word_text)
                start = item.get("start")
                end = item.get("end")
                if not normalized or start is None or end is None:
                    continue
                words.append(
                    {
                        "display": word_text,
                        "normalized": normalized,
                        "start": float(start),
                        "end": float(end),
                    }
                )

    if not words:
        raise RuntimeError("Transcript output did not include word timestamps.")
    words.sort(key=lambda item: (item["start"], item["end"]))
    return words


def build_script_tokens(script: str) -> List[Dict[str, Any]]:
    tokens: List[Dict[str, Any]] = []
    for raw_token in script.split():
        normalized = normalize_word(raw_token)
        if not normalized:
            continue
        tokens.append(
            {
                "display": raw_token,
                "normalized": normalized,
                "start": None,
                "end": None,
            }
        )
    if not tokens:
        raise RuntimeError("Approved script did not contain any alignable words.")
    return tokens


def match_cost(script_word: str, transcript_word: str) -> float:
    if script_word == transcript_word:
        return 0.0
    similarity = difflib.SequenceMatcher(a=script_word, b=transcript_word).ratio()
    if similarity >= 0.94:
        return 0.12
    if similarity >= 0.86:
        return 0.24
    if similarity >= 0.74:
        return 0.45
    return math.inf


def align_script_to_transcript(script_tokens: List[Dict[str, Any]], timed_words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    delete_cost = 0.9
    insert_cost = 0.55

    script_words = [token["normalized"] for token in script_tokens]
    transcript_words = [token["normalized"] for token in timed_words]
    script_count = len(script_words)
    transcript_count = len(transcript_words)

    dp = [[math.inf for _ in range(transcript_count + 1)] for _ in range(script_count + 1)]
    back: List[List[tuple[str, int, int] | None]] = [[None for _ in range(transcript_count + 1)] for _ in range(script_count + 1)]
    dp[0][0] = 0.0

    for index in range(1, script_count + 1):
        dp[index][0] = index * delete_cost
        back[index][0] = ("delete", index - 1, 0)
    for index in range(1, transcript_count + 1):
        dp[0][index] = index * insert_cost
        back[0][index] = ("insert", 0, index - 1)

    for script_index in range(1, script_count + 1):
        for transcript_index in range(1, transcript_count + 1):
            delete_candidate = dp[script_index - 1][transcript_index] + delete_cost
            insert_candidate = dp[script_index][transcript_index - 1] + insert_cost
            best_cost = delete_candidate
            best_back: tuple[str, int, int] = ("delete", script_index - 1, transcript_index)

            if insert_candidate < best_cost:
                best_cost = insert_candidate
                best_back = ("insert", script_index, transcript_index - 1)

            diagonal_cost = match_cost(script_words[script_index - 1], transcript_words[transcript_index - 1])
            if math.isfinite(diagonal_cost):
                match_candidate = dp[script_index - 1][transcript_index - 1] + diagonal_cost
                if match_candidate < best_cost:
                    best_cost = match_candidate
                    best_back = ("match", script_index - 1, transcript_index - 1)

            dp[script_index][transcript_index] = best_cost
            back[script_index][transcript_index] = best_back

    aligned = [dict(token) for token in script_tokens]
    script_index = script_count
    transcript_index = transcript_count
    while script_index > 0 or transcript_index > 0:
        step = back[script_index][transcript_index]
        if step is None:
            break
        action, prev_script, prev_transcript = step
        if action == "match":
            aligned[script_index - 1]["start"] = timed_words[transcript_index - 1]["start"]
            aligned[script_index - 1]["end"] = timed_words[transcript_index - 1]["end"]
        script_index, transcript_index = prev_script, prev_transcript
    return aligned


def fill_missing_word_timings(tokens: List[Dict[str, Any]], duration: float) -> List[Dict[str, Any]]:
    completed = [dict(token) for token in tokens]
    matched_durations = [
        token["end"] - token["start"]
        for token in completed
        if token["start"] is not None and token["end"] is not None and token["end"] > token["start"]
    ]
    default_word_duration = max(0.08, min(0.45, (sum(matched_durations) / len(matched_durations)) if matched_durations else duration / max(1, len(completed))))

    if not any(token["start"] is not None for token in completed):
        slot = duration / max(1, len(completed))
        cursor = 0.0
        for token in completed:
            token["start"] = cursor
            token["end"] = min(duration, cursor + slot)
            cursor = token["end"]
        return completed

    index = 0
    while index < len(completed):
        if completed[index]["start"] is not None:
            index += 1
            continue

        run_start = index
        while index < len(completed) and completed[index]["start"] is None:
            index += 1
        run_end = index - 1
        count = run_end - run_start + 1

        prev_token = completed[run_start - 1] if run_start > 0 else None
        next_token = completed[index] if index < len(completed) else None

        prev_end = prev_token["end"] if prev_token and prev_token["end"] is not None else None
        next_start = next_token["start"] if next_token and next_token["start"] is not None else None

        if prev_end is not None and next_start is not None and next_start > prev_end:
            slot = (next_start - prev_end) / count
            cursor = prev_end
        elif prev_end is None and next_start is not None:
            cursor = max(0.0, next_start - (default_word_duration * count))
            slot = (next_start - cursor) / count
        elif prev_end is not None and next_start is None:
            cursor = prev_end
            slot = default_word_duration
        else:
            cursor = 0.0
            slot = duration / max(1, len(completed))

        for offset in range(count):
            token = completed[run_start + offset]
            token["start"] = cursor + (offset * slot)
            token["end"] = cursor + ((offset + 1) * slot)

    for idx, token in enumerate(completed):
        token["start"] = float(max(0.0, token["start"]))
        token["end"] = float(max(token["start"] + 0.05, token["end"]))
        if idx > 0 and token["start"] < completed[idx - 1]["end"]:
            token["start"] = completed[idx - 1]["end"]
            token["end"] = max(token["start"] + 0.05, token["end"])
        token["end"] = min(duration, token["end"])

    if completed[-1]["end"] < duration:
        completed[-1]["end"] = duration
    return completed


def wrap_caption_words(words: Sequence[str], max_line_chars: int) -> List[str] | None:
    if not words:
        return None

    one_line = " ".join(words)
    if len(one_line) <= max_line_chars:
        return [one_line]

    best_lines: List[str] | None = None
    best_score: tuple[int, int] | None = None
    for split_index in range(1, len(words)):
        first_line = " ".join(words[:split_index])
        second_line = " ".join(words[split_index:])
        if len(first_line) > max_line_chars or len(second_line) > max_line_chars:
            continue
        score = (max(len(first_line), len(second_line)), abs(len(first_line) - len(second_line)))
        if best_score is None or score < best_score:
            best_score = score
            best_lines = [first_line, second_line]
    return best_lines


def build_caption_cue(tokens: Sequence[Dict[str, Any]], *, max_line_chars: int) -> Dict[str, Any]:
    words = [token["display"] for token in tokens]
    lines = wrap_caption_words(words, max_line_chars)
    if lines is None:
        raise RuntimeError(f"Caption cue overflowed the safe wrapping width: {' '.join(words)}")
    return {
        "start": float(tokens[0]["start"]),
        "end": float(tokens[-1]["end"] + 0.08),
        "lines": lines,
        "text": " ".join(words),
        "word_count": len(words),
    }


def chunk_caption_tokens(
    tokens: List[Dict[str, Any]],
    *,
    max_line_chars: int,
    max_words_per_cue: int,
) -> List[Dict[str, Any]]:
    cues: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []

    for token in tokens:
        if not current:
            current.append(token)
            continue

        previous = current[-1]
        trial = current + [token]
        gap = float(token["start"] - previous["end"])
        strong_punctuation = previous["display"].endswith((".", "!", "?", ";", ":")) and len(current) >= 3
        too_many_words = len(trial) > max_words_per_cue
        wrapped = wrap_caption_words([item["display"] for item in trial], max_line_chars)

        if gap >= 0.35 or strong_punctuation or too_many_words or wrapped is None:
            cues.append(build_caption_cue(current, max_line_chars=max_line_chars))
            current = [token]
        else:
            current = trial

    if current:
        cues.append(build_caption_cue(current, max_line_chars=max_line_chars))

    return cues


def normalize_cues(cues: List[Dict[str, Any]], duration: float, *, max_line_chars: int) -> List[Dict[str, Any]]:
    normalized = [dict(cue) for cue in cues]
    for idx, cue in enumerate(normalized):
        cue["start"] = max(0.0, cue["start"])
        cue["end"] = min(duration, max(cue["start"] + 0.12, cue["end"]))
        if idx > 0 and cue["start"] < normalized[idx - 1]["end"]:
            cue["start"] = normalized[idx - 1]["end"]
            cue["end"] = max(cue["start"] + 0.12, cue["end"])
        if len(cue["lines"]) > 2:
            raise RuntimeError(f"Caption cue exceeded two lines: {cue['text']}")
        if any(len(line) > max_line_chars for line in cue["lines"]):
            raise RuntimeError(f"Caption cue exceeded max line width: {cue['text']}")
    if normalized:
        normalized[-1]["end"] = min(duration, normalized[-1]["end"])
    return normalized


def ass_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(round(seconds * 100)))
    hours = centiseconds // 360000
    minutes = (centiseconds % 360000) // 6000
    secs = (centiseconds % 6000) // 100
    centis = centiseconds % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def escape_ass_text(text: str) -> str:
    escaped = text.replace("\\", r"\\")
    escaped = escaped.replace("{", "(").replace("}", ")")
    return escaped


def resolve_font_name(font_path: pathlib.Path, override: str | None) -> str:
    if override:
        return override
    scanner = shutil.which("fc-scan")
    if scanner:
        result = subprocess.run(
            [scanner, "--format", "%{family}\n", str(font_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        family = result.stdout.strip().splitlines()
        if family and family[0].strip():
            return family[0].strip()
    return DEFAULT_FONT_NAME


def write_ass_subtitles(
    cues: List[Dict[str, Any]],
    *,
    ass_path: pathlib.Path,
    font_name: str,
    caption_zone: str,
    overlay_title: str | None,
    video_duration: float,
) -> pathlib.Path:
    ensure_dir(ass_path.parent)
    title_lines = wrap_title_lines(overlay_title) if overlay_title else []
    title_style = resolve_title_style(title_lines) if title_lines else {"font_size": 48, "margin_v": 128}
    if caption_zone == "upper-third":
        alignment = 8
        margin_v = 300
    elif caption_zone == "lower-third":
        alignment = 2
        margin_v = 210
    else:
        raise RuntimeError(f"Unsupported caption zone: {caption_zone}")
    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,"
        "ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        (
            "Style: Default,"
            f"{font_name},58,&H00FFFFFF,&H000000FF,&H00303030,&H64000000,"
            f"0,0,0,0,100,100,0,0,1,3.2,0.7,{alignment},96,96,{margin_v},1"
        ),
        (
            "Style: Title,"
            f"{font_name},{title_style['font_size']},&H0000FFFF,&H000000FF,&H00000000,&H00000000,"
            f"0,0,0,0,100,100,0,0,1,4.0,0,8,96,96,{title_style['margin_v']},1"
        ),
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]

    event_lines = []
    if title_lines:
        title_text = r"\N".join(escape_ass_text(line) for line in title_lines)
        event_lines.append(
            "Dialogue: 1,"
            f"{ass_timestamp(0.0)},"
            f"{ass_timestamp(video_duration)},"
            f"Title,,0,0,0,,{title_text}"
        )
    for cue in cues:
        text = r"\N".join(escape_ass_text(line) for line in cue["lines"])
        event_lines.append(
            "Dialogue: 0,"
            f"{ass_timestamp(cue['start'])},"
            f"{ass_timestamp(cue['end'])},"
            f"Default,,0,0,0,,{text}"
        )

    with open(ass_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(header + event_lines) + "\n")
    return ass_path


def subtitle_filter_arg(ass_path: pathlib.Path, font_dir: pathlib.Path) -> str:
    ass_text = str(ass_path).replace("\\", r"\\").replace("'", r"\'")
    font_text = str(font_dir).replace("\\", r"\\").replace("'", r"\'")
    return f"subtitles=filename='{ass_text}':fontsdir='{font_text}'"


def burn_captions(
    *,
    raw_video_path: pathlib.Path,
    ass_path: pathlib.Path,
    font_dir: pathlib.Path,
    final_video_path: pathlib.Path,
) -> pathlib.Path:
    ensure_binary("ffmpeg")
    ensure_dir(final_video_path.parent)
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(raw_video_path),
            "-vf",
            subtitle_filter_arg(ass_path, font_dir),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-c:a",
            "copy",
            str(final_video_path),
        ]
    )
    return final_video_path


def finalize_caption_pipeline(
    *,
    raw_video_path: pathlib.Path,
    script: str,
    output_dir: pathlib.Path,
    basename: str,
    font_path: pathlib.Path,
    font_name: str | None,
    scribe_model: str,
    language_code: str | None,
    transcript_json: pathlib.Path | None,
    keep_audio: bool,
    max_line_chars: int,
    max_words_per_cue: int,
    caption_zone: str,
    overlay_title: str,
    overlay_title_source: str,
) -> Dict[str, Any]:
    ensure_dir(output_dir)
    if not raw_video_path.exists():
        raise RuntimeError(f"Raw video file not found: {raw_video_path}")
    if not font_path.exists():
        raise RuntimeError(f"Caption font file not found: {font_path}")

    audio_path = output_dir / f"{basename}-audio.wav"
    transcript_output_path = output_dir / f"{basename}-transcript.json"
    ass_path = output_dir / f"{basename}-captions.ass"
    final_video_path = output_dir / f"{basename}-captioned.mp4"
    manifest_path = output_dir / f"{basename}-caption-manifest.json"

    duration = ffprobe_duration(raw_video_path)
    extract_audio(raw_video_path, audio_path)

    transcription = load_transcription(
        audio_path=audio_path,
        transcript_json=transcript_json,
        model_id=scribe_model,
        language_code=language_code,
    )
    if transcription.get("backend") != "provided-json":
        with open(transcript_output_path, "w", encoding="utf-8") as handle:
            json.dump(transcription["result"], handle, indent=2)
    elif transcript_json:
        transcript_output_path = transcript_json

    timed_words = extract_timed_words(transcription["result"])
    aligned_tokens = align_script_to_transcript(build_script_tokens(script), timed_words)
    filled_tokens = fill_missing_word_timings(aligned_tokens, duration)
    cues = chunk_caption_tokens(
        filled_tokens,
        max_line_chars=max_line_chars,
        max_words_per_cue=max_words_per_cue,
    )
    normalized_cues = normalize_cues(cues, duration, max_line_chars=max_line_chars)

    resolved_font_name = resolve_font_name(font_path, font_name)
    write_ass_subtitles(
        normalized_cues,
        ass_path=ass_path,
        font_name=resolved_font_name,
        caption_zone=caption_zone,
        overlay_title=overlay_title,
        video_duration=duration,
    )
    burn_captions(
        raw_video_path=raw_video_path,
        ass_path=ass_path,
        font_dir=font_path.parent,
        final_video_path=final_video_path,
    )

    width, height = ffprobe_dimensions(final_video_path)
    if (width, height) != (1080, 1920):
        raise RuntimeError(f"Final video dimensions are incorrect: {width}x{height}")

    if not keep_audio and audio_path.exists():
        audio_path.unlink()

    result = {
        "status": "success",
        "raw_video_path": str(raw_video_path),
        "final_video_path": str(final_video_path),
        "ass_path": str(ass_path),
        "audio_path": str(audio_path) if keep_audio else None,
        "font_path": str(font_path),
        "font_name": resolved_font_name,
        "duration_seconds": duration,
        "transcript_backend": transcription["backend"],
        "transcript_model": transcription["model"],
        "transcript_path": str(transcript_output_path),
        "cue_count": len(normalized_cues),
        "max_line_chars": max_line_chars,
        "max_words_per_cue": max_words_per_cue,
        "caption_zone": caption_zone,
        "overlay_title": overlay_title,
        "overlay_title_source": overlay_title_source,
    }
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    result["manifest_path"] = str(manifest_path)
    return result


def run_preflight(args: argparse.Namespace) -> int:
    quota = request_json("GET", "/v2/user/remaining_quota")
    groups = request_json("GET", "/v2/avatar_group.list")
    voices = request_json("GET", "/v2/voices")

    group_items = groups.get("data", groups)
    voice_items = voices.get("data", voices)
    group_ids = {item.get("group_id") or item.get("id") for item in group_items if isinstance(item, dict)}
    voice_ids = {item.get("voice_id") for item in voice_items if isinstance(item, dict)}

    output = {
        "status": "success",
        "quota": quota,
        "group_check": None,
        "voice_check": None,
        "sample_groups": list(sorted(filter(None, group_ids)))[:10],
        "sample_voices": list(sorted(filter(None, voice_ids)))[:10],
    }
    if args.group_id:
        output["group_check"] = args.group_id in group_ids
    if args.voice_id:
        output["voice_check"] = args.voice_id in voice_ids

    print(json.dumps(output, indent=2))
    return 0


def run_upload_image(args: argparse.Namespace) -> int:
    image_path = pathlib.Path(args.image_file)
    if not image_path.exists():
        raise RuntimeError(f"Reference image not found: {image_path}")
    payload = request_multipart("POST", "https://upload.heygen.com/v1/asset", file_field="file", file_path=args.image_file)
    data = payload.get("data", payload)
    result = {
        "status": "success",
        "image_file": str(image_path),
        "asset_id": data.get("asset_id") or data.get("id"),
        "image_key": data.get("image_key") or data.get("asset_key") or data.get("key"),
        "raw": payload,
    }
    print(json.dumps(result, indent=2))
    return 0


def run_create_photo_group(args: argparse.Namespace) -> int:
    payload = request_json(
        "POST",
        "/v2/photo_avatar/avatar_group/create",
        body={"name": args.name, "image_key": args.image_key},
    )
    data = payload.get("data", payload)
    print(
        json.dumps(
            {
                "status": "success",
                "group_id": data.get("group_id") or data.get("id"),
                "image_url": data.get("image_url"),
                "raw": payload,
            },
            indent=2,
        )
    )
    return 0


def run_train_photo_group(args: argparse.Namespace) -> int:
    payload = request_json("POST", "/v2/photo_avatar/train", body={"group_id": args.group_id})
    print(json.dumps({"status": "submitted", "group_id": args.group_id, "raw": payload}, indent=2))
    return 0


def run_list_group_avatars(args: argparse.Namespace) -> int:
    payload = request_json("GET", f"/v2/avatar_group/{args.group_id}/avatars")
    data = payload.get("data", payload)
    avatar_items = data.get("avatars", data) if isinstance(data, dict) else data
    normalized = []
    for item in avatar_items or []:
        if isinstance(item, dict):
            normalized.append(
                {
                    "id": item.get("id") or item.get("talking_photo_id") or item.get("avatar_id"),
                    "name": item.get("name") or item.get("avatar_name"),
                    "preview_image_url": item.get("preview_image_url") or item.get("image_url"),
                }
            )
    print(json.dumps({"status": "success", "group_id": args.group_id, "avatars": normalized, "raw": payload}, indent=2))
    return 0


def run_render(args: argparse.Namespace) -> int:
    script = load_script(args.script, args.script_file)
    overlay_title, overlay_title_source = resolve_overlay_title(args.title, args.title_file, script)
    if args.finalize_output_dir and not args.wait:
        raise RuntimeError("--finalize-output-dir requires --wait because the completed raw video URL is needed.")
    voice_payload, voice_metadata = resolve_render_voice(args, script)
    character_payload, character_metadata = resolve_character(args)

    payload = {
        "video_inputs": [
            {
                "character": character_payload,
                "voice": voice_payload,
                "background": {
                    "type": "color",
                    "value": args.bg_color,
                },
            }
        ],
        "dimension": {
            "width": args.width,
            "height": args.height,
        },
    }
    response = request_json("POST", "/v2/video/generate", body=payload)
    video_id = (
        response.get("data", {}).get("video_id")
        or response.get("video_id")
        or response.get("data", {}).get("id")
    )
    result: Dict[str, Any] = {
        "status": "submitted",
        "video_id": video_id,
        "request_summary": {
            "width": args.width,
            "height": args.height,
            "character": character_metadata,
            "voice": voice_metadata,
            "background": args.bg_color,
            "caption_zone": args.caption_zone,
            "overlay_title": overlay_title,
            "overlay_title_source": overlay_title_source,
        },
        "raw": response,
    }

    if not args.wait or not video_id:
        print(json.dumps(result, indent=2))
        return 0

    started = time.time()
    while True:
        status_payload = request_json("GET", "/v1/video_status.get", params={"video_id": video_id})
        normalized = normalize_status(status_payload)
        state = normalized["render_status"]
        if state in {"completed", "failed"}:
            result["status"] = state
            result["video_url"] = normalized["video_url"]
            result["error"] = normalized["error"]
            result["final_status"] = normalized["raw"]
            if state == "completed" and normalized["video_url"] and (args.download_dir or args.finalize_output_dir):
                output_dir = pathlib.Path(args.finalize_output_dir or args.download_dir)
                ensure_dir(output_dir)
                basename = safe_stem(video_id)
                raw_video_path = output_dir / f"{basename}-raw.mp4"
                download_file(normalized["video_url"], raw_video_path)
                result["raw_video_path"] = str(raw_video_path)

                if args.finalize_output_dir:
                    result["caption_package"] = finalize_caption_pipeline(
                        raw_video_path=raw_video_path,
                        script=script,
                        output_dir=pathlib.Path(args.finalize_output_dir),
                        basename=basename,
                        font_path=pathlib.Path(args.font_file),
                        font_name=args.font_name,
                        scribe_model=args.scribe_model,
                        language_code=args.language_code,
                        transcript_json=pathlib.Path(args.transcript_json) if args.transcript_json else None,
                        keep_audio=args.keep_audio,
                        max_line_chars=args.max_line_chars,
                        max_words_per_cue=args.max_words_per_cue,
                        caption_zone=args.caption_zone,
                        overlay_title=overlay_title,
                        overlay_title_source=overlay_title_source,
                    )
            print(json.dumps(result, indent=2))
            return 0 if state == "completed" else 2
        if time.time() - started > args.timeout_seconds:
            result["status"] = "timeout"
            result["final_status"] = normalized["raw"]
            print(json.dumps(result, indent=2))
            return 2
        time.sleep(max(1, args.poll_interval))


def run_finalize(args: argparse.Namespace) -> int:
    script = load_script(args.script, args.script_file)
    overlay_title, overlay_title_source = resolve_overlay_title(args.title, args.title_file, script)
    output_dir = pathlib.Path(args.output_dir)
    ensure_dir(output_dir)

    if args.video_file:
        raw_video_path = pathlib.Path(args.video_file).resolve()
        basename = safe_stem(args.basename or raw_video_path.stem)
    else:
        basename = safe_stem(args.basename or "heygen-video")
        raw_video_path = output_dir / f"{basename}-raw.mp4"
        download_file(args.video_url, raw_video_path)

    result = finalize_caption_pipeline(
        raw_video_path=raw_video_path,
        script=script,
        output_dir=output_dir,
        basename=basename,
        font_path=pathlib.Path(args.font_file),
        font_name=args.font_name,
        scribe_model=args.scribe_model,
        language_code=args.language_code,
        transcript_json=pathlib.Path(args.transcript_json) if args.transcript_json else None,
        keep_audio=args.keep_audio,
        max_line_chars=args.max_line_chars,
        max_words_per_cue=args.max_words_per_cue,
        caption_zone=args.caption_zone,
        overlay_title=overlay_title,
        overlay_title_source=overlay_title_source,
    )
    print(json.dumps(result, indent=2))
    return 0


def run_status(args: argparse.Namespace) -> int:
    payload = request_json("GET", "/v1/video_status.get", params={"video_id": args.video_id})
    print(json.dumps(normalize_status(payload), indent=2))
    return 0


def main() -> int:
    args = parse_args()
    try:
        if args.command == "preflight":
            return run_preflight(args)
        if args.command == "upload-image":
            return run_upload_image(args)
        if args.command == "create-photo-group":
            return run_create_photo_group(args)
        if args.command == "train-photo-group":
            return run_train_photo_group(args)
        if args.command == "list-group-avatars":
            return run_list_group_avatars(args)
        if args.command == "render":
            return run_render(args)
        if args.command == "finalize":
            return run_finalize(args)
        if args.command == "status":
            return run_status(args)
        raise RuntimeError("Unknown command")
    except Exception as exc:
        print(json.dumps({"status": "error", "reason": str(exc)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())

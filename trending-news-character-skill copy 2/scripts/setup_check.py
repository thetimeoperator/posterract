#!/usr/bin/env python3
"""Validate config and env for the video-agent skill template."""

from __future__ import annotations

import json
import os
import pathlib
import re
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
ENV_PATH = ROOT / ".env"
PLACEHOLDER_RE = re.compile(
    r"^\s*(?:"
    r"$|"
    r"replace(?:[-_\s]?with)?|"
    r"replace[-_\s]?me|"
    r"your[-_\s]|"
    r"example|"
    r"placeholder|"
    r"\(?\s*insert\b"
    r")",
    re.IGNORECASE,
)


def load_json(path: pathlib.Path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_dotenv(path: pathlib.Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def is_placeholder(value: str | None) -> bool:
    if value is None:
        return True
    stripped = value.strip()
    return bool(PLACEHOLDER_RE.match(stripped))


def env_or_config_value(env_name: str, config_value: Any = None) -> str | None:
    env_value = os.environ.get(env_name)
    if not is_placeholder(env_value):
        return str(env_value).strip()
    if config_value is not None and not is_placeholder(str(config_value)):
        return str(config_value).strip()
    return None


def check_env(video: dict[str, Any], research: dict[str, Any], errors: list[str]) -> None:
    if is_placeholder(os.environ.get("HEYGEN_API_KEY")):
        errors.append("Missing or placeholder env value: HEYGEN_API_KEY")

    voice_provider = video.get("voice_provider")
    captions_enabled = video.get("captions_enabled") is True
    if (voice_provider == "elevenlabs" or captions_enabled) and is_placeholder(os.environ.get("ELEVENLABS_API_KEY")):
        errors.append("Missing or placeholder env value: ELEVENLABS_API_KEY")

    if research.get("mode") in {"x_keywords", "x_list"} and is_placeholder(os.environ.get("X_BEARER_TOKEN")):
        errors.append("Missing or placeholder env value: X_BEARER_TOKEN for X research mode")


def check_project(project: dict[str, Any], errors: list[str]) -> None:
    for key in ("project_name", "character_name", "page_name", "primary_audience"):
        if is_placeholder(str(project.get(key, "") or "")):
            errors.append(f"config/project.json missing a real value for: {key}")


def check_research(research: dict[str, Any], errors: list[str]) -> None:
    mode = research.get("mode")
    if mode not in {"manual_topic", "x_keywords", "x_list"}:
        errors.append("config/research.json mode must be one of: manual_topic, x_keywords, x_list")
    x_cfg = research.get("x", {})
    if mode == "x_keywords":
        keywords = x_cfg.get("keywords", [])
        if not keywords or any(is_placeholder(str(item)) for item in keywords):
            errors.append("config/research.json x.keywords must contain real keywords for x_keywords mode")
    if mode == "x_list":
        has_lists = bool(x_cfg.get("list_ids"))
        has_accounts = bool(x_cfg.get("accounts"))
        if not has_lists and not has_accounts:
            errors.append("config/research.json x.list_ids or x.accounts must be set for x_list mode")


def check_video(video: dict[str, Any], errors: list[str]) -> None:
    ids = video.get("ids", {})
    has_avatar = any(
        env_or_config_value(env_name, ids.get(config_key))
        for config_key, env_name in (
            ("heygen_avatar_id", "HEYGEN_AVATAR_ID"),
            ("heygen_talking_photo_id", "HEYGEN_TALKING_PHOTO_ID"),
            ("heygen_avatar_look_id", "HEYGEN_AVATAR_LOOK_ID"),
        )
    )
    if not has_avatar:
        errors.append("config/video.json or .env must include a HeyGen avatar id, talking photo id, or avatar look id")
    voice_provider = video.get("voice_provider")
    if voice_provider == "elevenlabs" and not env_or_config_value("ELEVENLABS_VOICE_ID", ids.get("elevenlabs_voice_id")):
        errors.append("config/video.json or .env must include a real elevenlabs_voice_id when voice_provider is elevenlabs")
    if voice_provider == "heygen" and not env_or_config_value("HEYGEN_VOICE_ID", ids.get("heygen_voice_id")):
        errors.append("config/video.json or .env must include a real heygen_voice_id when voice_provider is heygen")
    avatar_rotation = video.get("avatar_rotation", {})
    if avatar_rotation.get("enabled"):
        look_ids = avatar_rotation.get("avatar_look_ids", [])
        if len(look_ids) != 3:
            errors.append("config/video.json avatar_rotation.avatar_look_ids must contain exactly 3 avatar look ids")
        elif any(is_placeholder(str(item)) for item in look_ids):
            errors.append("config/video.json avatar_rotation.avatar_look_ids contains a placeholder value")
    layout = video.get("layout", {})
    if layout.get("top_half_source") != "hyperframes":
        errors.append("config/video.json layout.top_half_source must be hyperframes")
    if layout.get("bottom_half_source") != "heygen":
        errors.append("config/video.json layout.bottom_half_source must be heygen")
    if layout.get("hyperframes_frame") != "1:1":
        errors.append("config/video.json layout.hyperframes_frame must be 1:1")
    if video.get("captions_enabled") is not False:
        errors.append("config/video.json captions_enabled must be false for the current workflow")


def main() -> int:
    errors: list[str] = []
    load_dotenv(ENV_PATH)
    project = load_json(CONFIG_DIR / "project.json")
    research = load_json(CONFIG_DIR / "research.json")
    video = load_json(CONFIG_DIR / "video.json")
    _platforms = load_json(CONFIG_DIR / "platforms.json")

    check_env(video, research, errors)
    check_project(project, errors)
    check_research(research, errors)
    check_video(video, errors)

    if errors:
        print(json.dumps({"status": "blocked", "errors": errors}, indent=2))
        return 1

    print(json.dumps({"status": "success", "message": "Template config looks usable."}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

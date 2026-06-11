#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import shutil
import subprocess
import textwrap

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
WORKSPACE_ROOT = pathlib.Path(__file__).resolve().parents[5]
DEFAULT_TITLE_FONT = WORKSPACE_ROOT / "Helvetica75 Bold" / "Helvetica75 Bold.ttf"
DEFAULT_VIDEO_CONFIG_PATH = WORKSPACE_ROOT / "config" / "video.json"


def load_json_file(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def configured_binary(config_key: str, env_key: str, fallback: str) -> str:
    env_value = os.environ.get(env_key)
    if env_value:
        return env_value
    config = load_json_file(DEFAULT_VIDEO_CONFIG_PATH)
    assembly = config.get("assembly", {})
    value = assembly.get(config_key)
    return str(value).strip() if value else fallback


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assemble a 9:16 vertical master with Hyperframes on top and HeyGen on bottom.")
    parser.add_argument("--top-media", required=True, help="Hyperframes output. Image or video. Expected square/1:1.")
    parser.add_argument("--bottom-media", required=True, help="HeyGen talking-head render.")
    parser.add_argument("--output", required=True, help="Final assembled master path.")
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--top-height", type=int, default=960)
    parser.add_argument("--bottom-height", type=int, default=960)
    parser.add_argument("--title", help="Optional lower-third title to overlay over the talking-head bottom half.")
    parser.add_argument("--title-font", default=str(DEFAULT_TITLE_FONT), help="Font file for the lower-third title.")
    parser.add_argument("--title-band-width", type=int, default=940)
    parser.add_argument("--title-band-height", type=int, default=116)
    parser.add_argument("--title-outer-margin", type=int, default=70, help="Minimum left/right margin outside the title band.")
    parser.add_argument("--title-horizontal-padding", type=int, default=72, help="Minimum left/right padding between title text and the title band edges.")
    parser.add_argument("--title-vertical-padding", type=int, default=24, help="Minimum top/bottom padding between title text and the title band edges.")
    parser.add_argument("--title-line-spacing", type=int, default=18, help="Extra spacing between wrapped title lines.")
    parser.add_argument("--title-font-size", type=int, default=48)
    parser.add_argument("--title-min-font-size", type=int, default=34)
    parser.add_argument("--title-max-line-chars", type=int, default=22)
    parser.add_argument("--title-y", type=int, help="Top Y position of the lower-third title band. Defaults to under the face in the bottom half.")
    parser.add_argument("--ffmpeg", default=configured_binary("ffmpeg_path", "FFMPEG_PATH", "ffmpeg"), help="FFmpeg binary or path. Defaults to ffmpeg on PATH.")
    parser.add_argument("--ffprobe", default=configured_binary("ffprobe_path", "FFPROBE_PATH", "ffprobe"), help="FFprobe binary or path. Defaults to ffprobe on PATH.")
    return parser.parse_args()


def resolve_binary(binary: str, label: str) -> str:
    if "/" in binary or "\\" in binary:
        path = pathlib.Path(binary).expanduser()
        if path.exists():
            return str(path)
        raise SystemExit(f"Configured {label} path does not exist: {path}")
    found = shutil.which(binary)
    if found is None:
        raise SystemExit(f"Missing required binary: {binary}. Install FFmpeg or set {label.upper()}_PATH.")
    return found


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ffmpeg_has_drawtext(ffmpeg_bin: str) -> bool:
    result = subprocess.run(
        [ffmpeg_bin, "-hide_banner", "-filters"],
        check=True,
        capture_output=True,
        text=True,
    )
    return " drawtext " in result.stdout


def quote_filter_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def wrap_title(title: str, max_line_chars: int) -> str:
    title = " ".join(title.split())
    if not title:
        return title
    return "\n".join(
        textwrap.wrap(
            title,
            width=max(10, max_line_chars),
            break_long_words=True,
            break_on_hyphens=False,
        )
    )


def fit_title_font_size(title_lines: str, requested_font_size: int, min_font_size: int, band_width: int) -> int:
    lines = [line for line in title_lines.splitlines() if line.strip()]
    if not lines:
        return requested_font_size
    longest_line = max(len(line) for line in lines)
    available_width = max(200, band_width - 112)
    estimated_width = longest_line * requested_font_size * 0.62
    if estimated_width <= available_width:
        return requested_font_size
    fitted = math.floor(requested_font_size * available_width / max(1, estimated_width))
    return max(min_font_size, min(requested_font_size, fitted))


def probe_duration(path: pathlib.Path, ffprobe_bin: str) -> float | None:
    cmd = [
        ffprobe_bin, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    value = result.stdout.strip()
    return float(value) if value else None


def probe_dimensions(path: pathlib.Path, ffprobe_bin: str) -> tuple[int, int]:
    cmd = [
        ffprobe_bin, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    width_s, height_s = result.stdout.strip().split("x", 1)
    return int(width_s), int(height_s)


def bottom_filter(media_path: pathlib.Path, target_width: int, target_height: int, ffprobe_bin: str) -> str:
    source_width, source_height = probe_dimensions(media_path, ffprobe_bin)
    if source_height >= source_width * 1.5:
        active_height = round(source_width * 9 / 16)
        crop_y = max(0, round((source_height - active_height) / 2))
        return (
            f"crop={source_width}:{active_height}:0:{crop_y},"
            f"scale={target_width}:{target_height}:force_original_aspect_ratio=increase,"
            f"crop={target_width}:{target_height}"
        )
    return (
        f"scale={target_width}:{target_height}:force_original_aspect_ratio=increase,"
        f"crop={target_width}:{target_height}"
    )


def main() -> int:
    args = parse_args()
    ffmpeg_bin = resolve_binary(args.ffmpeg, "ffmpeg")
    ffprobe_bin = resolve_binary(args.ffprobe, "ffprobe")

    top_media = pathlib.Path(args.top_media)
    bottom_media = pathlib.Path(args.bottom_media)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if not top_media.exists():
        raise SystemExit(f"Top media not found: {top_media}")
    if not bottom_media.exists():
        raise SystemExit(f"Bottom media not found: {bottom_media}")

    top_is_image = top_media.suffix.lower() in IMAGE_EXTENSIONS
    if args.title:
        if not ffmpeg_has_drawtext(ffmpeg_bin):
            raise SystemExit(
                f"{ffmpeg_bin} does not support drawtext. Install an FFmpeg build with drawtext/libfreetype "
                "support, or pass --ffmpeg / set FFMPEG_PATH to one that has it."
            )
        if not pathlib.Path(args.title_font).exists():
            raise SystemExit(f"Title font not found: {args.title_font}")

    cmd = [ffmpeg_bin, "-y"]
    if top_is_image:
        duration = probe_duration(bottom_media, ffprobe_bin) or 15.0
        cmd += ["-loop", "1", "-framerate", str(args.fps), "-t", f"{duration:.3f}", "-i", str(top_media)]
    else:
        cmd += ["-i", str(top_media)]
    cmd += ["-i", str(bottom_media)]

    bottom_vf = bottom_filter(bottom_media, args.width, args.bottom_height, ffprobe_bin)
    filter_complex = (
        f"[0:v]scale={args.width}:{args.top_height}:force_original_aspect_ratio=increase,"
        f"crop={args.width}:{args.top_height}[top];"
        f"[1:v]{bottom_vf}[bottom];"
        f"[top][bottom]vstack=inputs=2[stacked]"
    )

    if args.title:
        title_text_path = output.with_suffix(".lower-third-title.txt")
        title_lines = wrap_title(args.title, args.title_max_line_chars)
        title_text_path.write_text(title_lines + "\n", encoding="utf-8")
        line_count = max(1, len(title_lines.splitlines()))
        max_band_width = max(320, args.width - (2 * max(0, args.title_outer_margin)))
        title_band_width = min(max_band_width, max(320, args.title_band_width))
        text_fit_width = max(180, title_band_width - (2 * max(0, args.title_horizontal_padding)))
        title_font_size = fit_title_font_size(title_lines, args.title_font_size, args.title_min_font_size, text_fit_width)
        title_line_spacing = max(0, args.title_line_spacing)
        estimated_text_height = round(line_count * title_font_size * 1.12) + max(0, line_count - 1) * title_line_spacing
        title_band_height = max(args.title_band_height, estimated_text_height + (2 * max(0, args.title_vertical_padding)))
        title_band_x = round((args.width - title_band_width) / 2)
        title_y = args.title_y
        if title_y is None:
            title_y = args.top_height + round(args.bottom_height * 0.57)
        title_y = max(args.top_height + 24, min(args.height - title_band_height - 24, title_y))
        filter_complex += (
            f";[stacked]drawbox=x={title_band_x}:y={title_y}:w={title_band_width}:h={title_band_height}:"
            "color=black@1.0:t=fill,"
            f"drawtext=fontfile='{quote_filter_value(str(pathlib.Path(args.title_font)))}':"
            f"textfile='{quote_filter_value(str(title_text_path))}':"
            f"fontcolor=white:fontsize={title_font_size}:line_spacing={title_line_spacing}:"
            f"x=(w-text_w)/2:y={title_y}+({title_band_height}-text_h)/2[v]"
        )
    else:
        filter_complex += ";[stacked]null[v]"

    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(args.fps),
        "-c:a", "aac",
        "-shortest",
        str(output),
    ]
    run(cmd)

    payload = {
        "output": str(output),
        "width": args.width,
        "height": args.height,
        "top_media": str(top_media),
        "bottom_media": str(bottom_media),
        "top_is_image": top_is_image,
        "lower_third_title": args.title,
        "lower_third_title_text_file": str(output.with_suffix(".lower-third-title.txt")) if args.title else None,
        "lower_third_title_font": str(pathlib.Path(args.title_font)) if args.title else None,
        "lower_third_title_font_size": title_font_size if args.title else None,
        "lower_third_title_band_width": title_band_width if args.title else None,
        "lower_third_title_band_height": title_band_height if args.title else None,
        "lower_third_title_horizontal_padding": args.title_horizontal_padding if args.title else None,
        "lower_third_title_vertical_padding": args.title_vertical_padding if args.title else None,
        "lower_third_title_line_spacing": title_line_spacing if args.title else None,
        "lower_third_title_outer_margin": args.title_outer_margin if args.title else None,
        "ffmpeg_binary": ffmpeg_bin,
        "ffprobe_binary": ffprobe_bin,
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

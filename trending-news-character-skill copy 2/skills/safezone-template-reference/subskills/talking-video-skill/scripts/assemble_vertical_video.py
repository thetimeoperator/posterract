#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


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
    parser.add_argument("--title", help="Optional centered title to overlay on the final video.")
    parser.add_argument("--title-band-height", type=int, default=88)
    parser.add_argument("--title-font-size", type=int, default=44)
    return parser.parse_args()


def ensure_binary(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Missing required binary: {name}")


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def probe_duration(path: pathlib.Path) -> float | None:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    value = result.stdout.strip()
    return float(value) if value else None


def probe_dimensions(path: pathlib.Path) -> tuple[int, int]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    width_s, height_s = result.stdout.strip().split("x", 1)
    return int(width_s), int(height_s)


def bottom_filter(media_path: pathlib.Path, target_width: int, target_height: int) -> str:
    source_width, source_height = probe_dimensions(media_path)
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
    ensure_binary("ffmpeg")
    ensure_binary("ffprobe")

    top_media = pathlib.Path(args.top_media)
    bottom_media = pathlib.Path(args.bottom_media)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if not top_media.exists():
        raise SystemExit(f"Top media not found: {top_media}")
    if not bottom_media.exists():
        raise SystemExit(f"Bottom media not found: {bottom_media}")

    top_is_image = top_media.suffix.lower() in IMAGE_EXTENSIONS
    cmd = ["ffmpeg", "-y"]
    if top_is_image:
        duration = probe_duration(bottom_media) or 15.0
        cmd += ["-loop", "1", "-framerate", str(args.fps), "-t", f"{duration:.3f}", "-i", str(top_media)]
    else:
        cmd += ["-i", str(top_media)]
    cmd += ["-i", str(bottom_media)]

    bottom_vf = bottom_filter(bottom_media, args.width, args.bottom_height)
    filter_complex = (
        f"[0:v]scale={args.width}:{args.top_height}:force_original_aspect_ratio=increase,"
        f"crop={args.width}:{args.top_height}[top];"
        f"[1:v]{bottom_vf}[bottom];"
        f"[top][bottom]vstack=inputs=2[stacked]"
    )

    if args.title:
        safe_title = args.title.replace("\\", r"\\").replace(":", r"\:").replace("'", r"\'")
        filter_complex += (
            f";[stacked]drawbox=x=0:y=(ih-{args.title_band_height})/2:w=iw:h={args.title_band_height}:color=black@1.0:t=fill,"
            f"drawtext=text='{safe_title}':fontcolor=white:fontsize={args.title_font_size}:x=(w-text_w)/2:y=(h-text_h)/2[v]"
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
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

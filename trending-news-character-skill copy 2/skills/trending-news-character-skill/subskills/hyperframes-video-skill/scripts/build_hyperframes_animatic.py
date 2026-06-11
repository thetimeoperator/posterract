#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import tempfile


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a square Hyperframes animatic proxy from timed prompt scenes.")
    parser.add_argument("--prompt-json", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", default="1080x1080")
    parser.add_argument("--fps", type=int, default=30)
    return parser.parse_args()


def ensure_binary(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Missing required binary: {name}")


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def scene_filter(slug: str, duration: float, width: int, height: int) -> str:
    base = [f"format=yuv420p"]
    if slug == "military-escalation":
        base += [
            f"drawbox=x=0:y=0:w={width}:h={height}:color=0x07131f:t=fill",
            f"drawbox=x='mod(t*220,{width})-180':y=120:w=180:h=18:color=0xff6b35@0.85:t=fill",
            f"drawbox=x='{width}-mod(t*260,{width}+220)':y=210:w=220:h=10:color=0xf4d35e@0.75:t=fill",
            f"drawbox=x=0:y='{height*0.68}':w={width}:h='{height*0.32}':color=0x0b2239@0.95:t=fill",
            f"drawbox=x='mod(t*140,{width})':y='{height*0.72}':w=90:h=26:color=0xff3b30@0.95:t=fill",
            f"drawbox=x='{width}-mod(t*170,{width}+120)':y='{height*0.77}':w=120:h=14:color=0xffffff@0.75:t=fill",
            f"drawgrid=width=160:height=160:thickness=2:color=0xffffff@0.05",
        ]
    elif slug == "strait-tension":
        base += [
            f"drawbox=x=0:y=0:w={width}:h={height}:color=0x10251a:t=fill",
            f"drawgrid=width=120:height=120:thickness=2:color=0xffffff@0.05",
            f"drawbox=x=220:y=0:w=14:h={height}:color=0xffd166@0.35:t=fill",
            f"drawbox=x=520:y=0:w=10:h={height}:color=0xffd166@0.28:t=fill",
            f"drawbox=x=820:y=0:w=14:h={height}:color=0xffd166@0.35:t=fill",
            f"drawbox=x=0:y='mod(t*130,{height})':w={width}:h=8:color=0xff595e@0.65:t=fill",
            f"drawbox=x='mod(t*110,{width})':y='{height*0.38}':w=180:h=18:color=0x8ac926@0.55:t=fill",
            f"drawbox=x='{width}-mod(t*150,{width}+200)':y='{height*0.56}':w=220:h=14:color=0x1982c4@0.55:t=fill",
        ]
    elif slug == "shipping-seizure":
        base += [
            f"drawbox=x=0:y=0:w={width}:h={height}:color=0x1b140d:t=fill",
            f"drawbox=x=0:y='{height*0.62}':w={width}:h='{height*0.38}':color=0x0a2236@0.96:t=fill",
            f"drawbox=x='mod(t*60,{width}+280)-280':y='{height*0.46}':w=280:h=120:color=0x5c3d2e@0.92:t=fill",
            f"drawbox=x='mod(t*60,{width}+280)-280+20':y='{height*0.49}':w=42:h=42:color=0xbc6c25@0.95:t=fill",
            f"drawbox=x='mod(t*60,{width}+280)-280+80':y='{height*0.49}':w=42:h=42:color=0xdda15e@0.95:t=fill",
            f"drawbox=x='mod(t*60,{width}+280)-280+140':y='{height*0.49}':w=42:h=42:color=0xa7c957@0.95:t=fill",
            f"drawbox=x='mod(t*60,{width}+280)-280+200':y='{height*0.49}':w=42:h=42:color=0x6a994e@0.95:t=fill",
            f"drawbox=x='{width}-mod(t*90,{width}+120)':y='{height*0.66}':w=120:h=8:color=0xffffff@0.7:t=fill",
        ]
    elif slug == "market-reaction":
        base += [
            f"drawbox=x=0:y=0:w={width}:h={height}:color=0x130f1f:t=fill",
            f"drawgrid=width=90:height=90:thickness=1:color=0xffffff@0.05",
            f"drawbox=x=140:y=650:w=70:h=250:color=0xff4d6d@0.85:t=fill",
            f"drawbox=x=250:y=600:w=70:h=300:color=0xff4d6d@0.88:t=fill",
            f"drawbox=x=360:y=690:w=70:h=210:color=0xff4d6d@0.82:t=fill",
            f"drawbox=x=470:y=560:w=70:h=340:color=0xff4d6d@0.9:t=fill",
            f"drawbox=x=640:y=760:w=70:h=140:color=0xffca3a@0.86:t=fill",
            f"drawbox=x=750:y=670:w=70:h=230:color=0xffca3a@0.9:t=fill",
            f"drawbox=x=860:y='880-mod(t*90,340)':w=70:h='mod(t*90,340)+40':color=0x8ac926@0.9:t=fill",
            f"drawbox=x='mod(t*180,{width})':y=180:w=220:h=8:color=0xffffff@0.6:t=fill",
        ]
    elif slug == "high-stakes-outlook":
        base += [
            f"drawbox=x=0:y=0:w='{width/2}':h={height}:color=0x1c1010:t=fill",
            f"drawbox=x='{width/2}':y=0:w='{width/2}':h={height}:color=0x111827:t=fill",
            f"drawbox=x='{width/2 - 4}':y=0:w=8:h={height}:color=0xffffff@0.25:t=fill",
            f"drawbox=x=110:y='300+40*sin(t*2.2)':w=240:h=140:color=0xff3b30@0.9:t=fill",
            f"drawbox=x=720:y='760-220*(t/{duration})':w=180:h='120+220*(t/{duration})':color=0xffd166@0.92:t=fill",
            f"drawbox=x='max(70,{width}-90-t*180)':y=120:w=20:h=20:color=0xffffff@0.9:t=fill",
        ]
    else:
        base += [
            f"drawbox=x=0:y=0:w={width}:h={height}:color=0x111827:t=fill",
            f"drawgrid=width=100:height=100:thickness=2:color=0xffffff@0.05",
            f"drawbox=x='mod(t*140,{width})':y='mod(t*90,{height})':w=180:h=24:color=0x60a5fa@0.5:t=fill",
        ]
    return ",".join(base)


def main() -> int:
    args = parse_args()
    ensure_binary('ffmpeg')
    prompt_path = pathlib.Path(args.prompt_json)
    payload = json.loads(prompt_path.read_text(encoding='utf-8'))
    scenes = payload.get('scenes', [])
    if not scenes:
        raise SystemExit('No scenes found in prompt JSON')

    width, height = [int(part) for part in args.size.split('x', 1)]
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = pathlib.Path(tmpdir)
        segments = []
        for idx, scene in enumerate(scenes, start=1):
            seg = tmp / f'scene-{idx:02d}.mp4'
            duration = max(1.0, float(scene['duration_seconds']))
            filter_chain = scene_filter(str(scene.get('slug', 'generic')), duration, width, height)
            cmd = [
                'ffmpeg','-y',
                '-f','lavfi','-i',f'color=c=black:s={args.size}:d={duration}:r={args.fps}',
                '-vf',filter_chain,
                '-c:v','libx264','-pix_fmt','yuv420p',
                str(seg)
            ]
            run(cmd)
            segments.append(seg)

        concat_file = tmp / 'concat.txt'
        concat_file.write_text(''.join(f"file '{path}'\n" for path in segments), encoding='utf-8')
        run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat_file),'-c','copy',str(output)])

    print(json.dumps({'output': str(output), 'scene_count': len(scenes)}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

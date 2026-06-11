#!/usr/bin/env python3
"""Validate short crypto/NFT scripts against the YourCharacter template rules."""

from __future__ import annotations

import argparse
import json
import re
import sys


EMOJI_PATTERN = re.compile(
    "["
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002700-\U000027BF"
    "]+"
)
OPENING_PATTERNS = (
    "the wallet",
    "the market",
    "the chain",
    "the tape",
    "attention is moving",
)
ACTION_VERBS = {
    "avoid",
    "build",
    "deploy",
    "hold",
    "keep",
    "learn",
    "move",
    "position",
    "prepare",
    "protect",
    "reduce",
    "save",
    "start",
    "stop",
    "study",
    "train",
    "use",
    "wait",
    "watch",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a 20-30 second YourCharacter crypto/NFT script.")
    parser.add_argument("--script", help="Script text to validate.")
    parser.add_argument("--file", help="Optional file path containing the script text.")
    parser.add_argument("--min-chars", type=int, default=180)
    parser.add_argument("--max-chars", type=int, default=520)
    parser.add_argument("--min-words", type=int, default=30)
    parser.add_argument("--max-words", type=int, default=80)
    return parser.parse_args()


def load_script(args: argparse.Namespace) -> str:
    if args.script:
        return args.script.strip()
    if args.file:
        with open(args.file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    raise ValueError("Provide --script or --file.")


def validate_script(script: str, min_chars: int, max_chars: int, min_words: int, max_words: int) -> dict:
    violations = []
    char_count = len(script)
    word_count = len(script.split())
    normalized = script.strip().lower()

    if char_count < min_chars:
        violations.append(f"Script is too short: {char_count} characters.")
    if char_count > max_chars:
        violations.append(f"Script is too long: {char_count} characters.")
    if word_count < min_words:
        violations.append(f"Script is too short: {word_count} words.")
    if word_count > max_words:
        violations.append(f"Script is too long: {word_count} words.")
    if "#" in script:
        violations.append("Script contains a hashtag.")
    if EMOJI_PATTERN.search(script):
        violations.append("Script contains emoji characters.")
    if re.search(r"https?://", script):
        violations.append("Script contains a URL.")
    if "\n" in script:
        violations.append("Script should stay in one block of copy.")
    if not normalized.startswith(OPENING_PATTERNS):
        violations.append("Script must open with a crypto-native framing line.")
    if not has_action_close(script):
        violations.append("Script must end with practical advice, not just commentary.")

    result = {
        "valid": not violations,
        "char_count": char_count,
        "word_count": word_count,
        "violations": violations,
    }
    return result


def has_action_close(script: str) -> bool:
    sentences = [part.strip() for part in re.split(r"[.!?]+", script) if part.strip()]
    if not sentences:
        return False
    tail = sentences[-1].lower()
    words = re.findall(r"[a-z']+", tail)
    if not words:
        return False
    return any(word in ACTION_VERBS for word in words)


def main() -> int:
    args = parse_args()
    try:
        script = load_script(args)
    except Exception as exc:
        print(json.dumps({"valid": False, "violations": [str(exc)]}))
        return 2

    result = validate_script(script, args.min_chars, args.max_chars, args.min_words, args.max_words)
    print(json.dumps(result, indent=2))
    return 0 if result["valid"] else 2


if __name__ == "__main__":
    sys.exit(main())

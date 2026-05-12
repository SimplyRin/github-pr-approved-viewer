#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 SimplyRin

import os
import re
import subprocess
import sys
from pathlib import Path


def find_codeowners(root: Path) -> Path | None:
    """CODEOWNERS ファイルを探す (.github/ -> docs/ -> ルート の優先順)"""
    candidates = [
        root / ".github" / "CODEOWNERS",
        root / "docs" / "CODEOWNERS",
        root / "CODEOWNERS",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def parse_codeowners(text: str) -> list[dict]:
    """CODEOWNERS テキストをルールリストに変換する"""
    rules = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        pattern = parts[0]
        owners = parts[1:]
        rules.append({"pattern": pattern, "owners": owners})
    return rules


def ensure_leading_slash(path: str) -> str:
    return path if path.startswith("/") else "/" + path


def pattern_to_regex(pattern: str) -> re.Pattern:
    """CODEOWNERS のグロブパターンを正規表現に変換する (content.js の patternToRegex 相当)"""
    normalized = re.sub(r"^/+", "/", pattern)

    # ** → プレースホルダー → .* 、* → [^/]*
    regex = normalized
    regex = regex.replace("**", "\x00GLOBSTAR\x00")
    regex = regex.replace(".", "\\.")
    regex = regex.replace("*", "[^/]*")
    regex = regex.replace("?", "[^/]")
    regex = regex.replace("\x00GLOBSTAR\x00", ".*")

    if normalized in ("/*", "/"):
        regex = "^/.*$"
    elif normalized.endswith("/"):
        regex = "^" + regex + ".*$"
    elif "/" not in normalized[1:]:
        regex = "^.*/" + regex.lstrip("/") + "$"
    else:
        regex = "^" + regex + "$"

    return re.compile(regex)


def decode_git_filename(name: str) -> str:
    """git が出力するクォート済みオクタルエスケープのファイル名をデコードする"""
    if name.startswith('"') and name.endswith('"'):
        name = name[1:-1]
        raw: list[int] = []
        i = 0
        while i < len(name):
            if name[i] == "\\" and i + 1 < len(name):
                next_ch = name[i + 1]
                if next_ch in "01234567" and i + 3 < len(name):
                    octal_str = name[i + 1 : i + 4]
                    try:
                        raw.append(int(octal_str, 8))
                        i += 4
                        continue
                    except ValueError:
                        pass
                escape_map = {"t": 9, "n": 10, "r": 13, "\\\\": 92, '"': 34}
                if next_ch in escape_map:
                    raw.append(escape_map[next_ch])
                    i += 2
                    continue
            raw.append(ord(name[i]))
            i += 1
        return bytes(raw).decode("utf-8", errors="replace")
    return name


def clean_file_name(name: str) -> str:
    """content.js の cleanFileName 相当: 方向制御文字を除去してトリムする"""
    return re.sub(r"[\u200e\u200f\u202a-\u202e]", "", name).strip()


def find_code_owners(rules: list[dict], changed_files: list[str]) -> list[dict]:
    """変更ファイルそれぞれに対してマッチする CODEOWNERS ルールを返す (最後にマッチしたルールが優先)"""
    result = []
    for file in changed_files:
        file = clean_file_name(file)
        file = ensure_leading_slash(file)

        matched_owners: list[str] = []
        matched_pattern: str | None = None
        matched_index: int = -1

        for i, rule in enumerate(rules):
            regex = pattern_to_regex(ensure_leading_slash(rule["pattern"]))
            if regex.search(file):
                matched_owners = rule["owners"]
                matched_pattern = rule["pattern"]
                matched_index = i

        result.append(
            {
                "file": file,
                "codeowner": matched_pattern,
                "owners": matched_owners,
                "rule_index": matched_index,
            }
        )
    return result


def get_changed_files() -> list[str]:
    """git diff --name-status main...HEAD から変更ファイル一覧を取得する"""
    try:
        output = subprocess.check_output(
            ["git", "diff", "--name-status", "main...HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] git diff に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)

    files = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            # R (renamed) の場合は parts[2] が新しいファイル名
            files.append(decode_git_filename(parts[-1]))
    return files


def group_by_pattern(result: list[dict]) -> list[dict]:
    """ファイルを CODEOWNERS パターンでグループ化し、ユニークオーナーをまとめる"""
    seen: dict[str, dict] = {}
    order: list[str] = []

    for row in result:
        key = row["codeowner"] or "(マッチなし)"
        if key not in seen:
            seen[key] = {
                "codeowner": row["codeowner"],
                "owners": list(row["owners"]),
                "files": [],
                "rule_index": row["rule_index"],
            }
            order.append(key)
        seen[key]["files"].append(row["file"])

    return [seen[k] for k in order]


def collect_all_owners(groups: list[dict]) -> list[str]:
    """全グループのオーナーをユニークにまとめる"""
    all_owners: list[str] = []
    for group in groups:
        for owner in group["owners"]:
            if owner not in all_owners:
                all_owners.append(owner)
    return all_owners


def main() -> None:
    root = Path(os.getcwd())

    # CODEOWNERS ファイルを探す
    codeowners_path = find_codeowners(root)
    if codeowners_path is None:
        print("CODEOWNERS ファイルが見つかりませんでした。")
        sys.exit(0)

    print(f"CODEOWNERS: {codeowners_path.relative_to(root)}")

    codeowners_text = codeowners_path.read_text(encoding="utf-8")
    rules = parse_codeowners(codeowners_text)
    print(f"ルール数: {len(rules)}\n")

    # 変更ファイルを取得
    changed_files = get_changed_files()
    if not changed_files:
        print("変更ファイルがありません (git diff --name-status main...HEAD)。")
        sys.exit(0)

    print(f"変更ファイル数: {len(changed_files)}\n")

    # マッチング
    result = find_code_owners(rules, changed_files)
    groups = group_by_pattern(result)

    # --- 結果表示 ---
    print("=" * 60)
    print("コードオーナーごとの対象ファイル")
    print("=" * 60)

    for group in groups:
        pattern_label = group["codeowner"] or "(マッチなし)"
        owners_label = "  ".join(group["owners"]) if group["owners"] else "(オーナーなし)"
        print(f"\nパターン : {pattern_label}")
        print(f"オーナー : {owners_label}")
        print(f"ファイル :")
        for f in group["files"]:
            print(f"  {f}")

    # --- サマリー ---
    all_owners = collect_all_owners(groups)

    print("\n" + "=" * 60)
    print("必要なコードオーナー一覧")
    print("=" * 60)
    if all_owners:
        for owner in all_owners:
            print(f"  {owner}")
    else:
        print("  (なし)")


if __name__ == "__main__":
    main()

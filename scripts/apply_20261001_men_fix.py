#!/usr/bin/env python3
"""2026-10-01 男性メニューの訂正を index.html / menu.config.js へ当てる（★冪等・★fail closed）。

★由来: ★司令 2026-10-01 12:02「男性メニュー色々間違えてるよ。★50円単位はなし。
  ★丸刈り関連の金額はカットと同じにする」／ ★12:04「①。★子供メニューも廃止。★大人と一緒。」
  （#ライズ関連 msg 1555052360496189541 / 1555052755691765771・★原文を大神が確認）
  ★①＝マリアの提示した「丸刈りをカットと同じ 1,400円に揃える」（msg 1555052496093843487）。

★やること
  ① 丸刈り金額（kariPrice）3件 → ★1400（＝men-cut-cut と同額）
  ② men-cut-kids（子供カットとシャンプー 1,850）を ★行ごと削除
     ★配列の末尾要素なので ★直前行の末尾カンマも外す

★設計（★fail closed）
  ・先に ★全件の現在値を読み、★期待と1つでも違えば ★何も書かずに止まる
  ・既に全部 新しい形なら ★「済み」として終わる（★冪等）
  ・書いた後に ★読み直して ★結果を確かめる
  ・★push はしない（★呼び出し側が判断する）

★使い方
  python3 scripts/apply_20261001_men_fix.py --dry-run
  python3 scripts/apply_20261001_men_fix.py --apply
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ["index.html", "menu.config.js"]

KARI_NEW = 1400
KARI_PLAN = {                      # id -> 現在の kariPrice
    "men-cut-cutshampoo": 1700,
    "men-cut-cutshaving": 1700,
    "men-cut-chouhatsu": 1950,
}
DROP_ID = "men-cut-kids"
DROP_PRICE = 1850                  # ★消す行の目印（別物を消さないため）
EXPECT_BEFORE, EXPECT_AFTER = 20, 19


def item_lines(text: str):
    """`{ id: "..." ... }` の行を (行番号, id) で返す。"""
    out = []
    for i, ln in enumerate(text.split("\n")):
        m = re.search(r'\{\s*id:\s*"([^"]+)"', ln)
        if m:
            out.append((i, m.group(1)))
    return out


def kari_of(line: str):
    m = re.search(r"kariPrice:\s*(null|\d+)", line)
    if not m or m.group(1) == "null":
        return None
    return int(m.group(1))


def price_of(line: str):
    m = re.search(r"\bprice:\s*(\d+)", line)
    return int(m.group(1)) if m else None


def inspect(path: pathlib.Path):
    lines = path.read_text(encoding="utf-8").split("\n")
    text = "\n".join(lines)
    items = item_lines(text)
    ids = [i for _, i in items]
    idx = {i: n for n, i in items}
    return lines, ids, idx


def main() -> int:
    apply = "--apply" in sys.argv
    dry = "--dry-run" in sys.argv or not apply
    if apply and dry:
        print("★--apply と --dry-run は同時に指定できません")
        return 2

    plans = []
    for name in TARGETS:
        p = HERE / name
        if not p.exists():
            print(f"★{name} がありません → 何もしません")
            return 2
        lines, ids, idx = inspect(p)

        done = (DROP_ID not in ids
                and all(kari_of(lines[idx[i]]) == KARI_NEW for i in KARI_PLAN if i in idx))
        if done and len(ids) == EXPECT_AFTER:
            print(f"  {name}: ★既に適用済み（{len(ids)}件・丸刈り{KARI_NEW}・{DROP_ID}なし）")
            plans.append((p, None))
            continue

        # ---- 前提の確認（★1つでも違えば 何も書かない）----
        if len(ids) != EXPECT_BEFORE:
            print(f"★{name}: メニューが {len(ids)}件（期待 {EXPECT_BEFORE}件）→ 止めます")
            return 2
        for mid, cur in KARI_PLAN.items():
            if mid not in idx:
                print(f"★{name}: {mid} が見つかりません → 止めます")
                return 2
            got = kari_of(lines[idx[mid]])
            if got != cur:
                print(f"★{name}: {mid} の丸刈りが {got}（期待 {cur}）→ 止めます")
                return 2
        if DROP_ID not in idx:
            print(f"★{name}: {DROP_ID} が見つかりません → 止めます")
            return 2
        got = price_of(lines[idx[DROP_ID]])
        if got != DROP_PRICE:
            print(f"★{name}: {DROP_ID} の価格が {got}（期待 {DROP_PRICE}）→ 止めます")
            return 2
        plans.append((p, (lines, idx)))

    for p, plan in plans:
        if plan is None:
            continue
        lines, idx = plan
        print(f"  {p.name}:")
        for mid, cur in KARI_PLAN.items():
            n = idx[mid]
            print(f"    丸刈り {mid}: {cur} → {KARI_NEW}")
            lines[n] = re.sub(r"kariPrice:\s*\d+", f"kariPrice: {KARI_NEW}", lines[n])
        drop = idx[DROP_ID]
        print(f"    削除 {DROP_ID}（{DROP_PRICE}円の行）")
        # ★末尾要素なら ★直前の要素行の末尾カンマを外す
        prev = drop - 1
        while prev >= 0 and not lines[prev].strip():
            prev -= 1
        nxt = drop + 1
        while nxt < len(lines) and not lines[nxt].strip():
            nxt += 1
        last_in_array = nxt >= len(lines) or not re.search(r'\{\s*id:\s*"', lines[nxt])
        if last_in_array and prev >= 0 and lines[prev].rstrip().endswith(","):
            lines[prev] = lines[prev].rstrip()[:-1]
            print(f"    直前行（{prev+1}行目）の末尾カンマを外しました")
        del lines[drop]
        if dry:
            print("    ★dry-run: 書いていません")
            continue
        p.write_text("\n".join(lines), encoding="utf-8")

    if dry:
        print("★dry-run のため書いていません（--apply で実行）")
        return 0

    # ---- 書いた後に 読み直して確かめる ----
    ok = True
    for name in TARGETS:
        p = HERE / name
        lines, ids, idx = inspect(p)
        bad = []
        if len(ids) != EXPECT_AFTER:
            bad.append(f"件数 {len(ids)}（期待 {EXPECT_AFTER}）")
        if DROP_ID in ids:
            bad.append(f"{DROP_ID} が残っています")
        for mid in KARI_PLAN:
            got = kari_of(lines[idx[mid]]) if mid in idx else "行なし"
            if got != KARI_NEW:
                bad.append(f"{mid} の丸刈りが {got}")
        print(f"  {name}: " + ("★確認OK" if not bad else "★★" + " / ".join(bad)))
        ok = ok and not bad
    print("★完了" if ok else "★★確認で食い違いました。手で見てください")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

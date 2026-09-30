#!/usr/bin/env python3
"""2026-10-01 料金改定を index.html へ当てる（★冪等・★先に全件突合してから書く）。

★由来: 2026-09-29 司令決定（女性「カットとシャンプー」¥2,800 / msg 1554479330292277261）。
  叩き台＝スプシ 1R9J34XgN6c7YKF5P_fQp5Fk2KoExJWCrhqPK4fRIbQI「価格表_BeforeAfter」。
  手順＝docs/20261001_料金改定_実行手順.md。

★設計（★fail closed）
  ① 先に ★19件すべての現在値を読み、★期待する「現行」と1件でも違えば ★何も書かずに止まる
     → ★人が手で直した直後などに ★黙って上書きしないため
  ② 既に全部「新」なら ★「済み」として終わる（★冪等。★二重実行で壊れない）
  ③ 書いた後に ★読み直して ★全件が「新」になったことを確かめる
  ④ ★push はしない（★呼び出し側が判断する）。★このスクリプトはファイルを直すだけ

★使い方
  python3 scripts/apply_20261001_prices.py --dry-run   # 何を変えるか出すだけ
  python3 scripts/apply_20261001_prices.py --apply     # 実際に書く
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ["index.html", "menu.config.js"]   # ★本番は index.html。★menu.config.js は履歴用に揃える

# メニューid → (現行, 新)。★叩き台「価格表_BeforeAfter」から起こし、
# ★2026-09-29 に index.html の20件と突合して現行が全件一致することを確認済み。
PLAN: dict[str, tuple[int, int]] = {
    "men-cut-cut":               (1300, 1400),
    "men-cut-cutshampoo":        (1950, 2100),
    "men-cut-cutshaving":        (1950, 2100),
    "men-cut-chouhatsu":         (2200, 2500),
    "men-color-shiragabokashi":  (1950, 2400),
    "men-color-shiragazome":     (3250, 3900),
    "men-color-color":           (3900, 3900),   # ★据え置き（叩き台も同額）
    "men-perma-perma":           (6500, 5900),
    "woman-cut-cut":             (1300, 1400),
    "woman-cut-shampoo":         (1300, 1400),
    "woman-cut-maegami":         (600,  800),
    "woman-cut-kaosori":         (2050, 2100),
    "woman-color-shiragabokashi":(1950, 2400),
    "woman-color-shiragazome":   (4550, 4900),
    "woman-color-oshare":        (5200, 4900),
    "woman-color-manicure":      (5200, 4900),
    "woman-perma-faceline":      (5200, 5900),
    "woman-perma-perma":         (6500, 5900),
    "woman-cut-cutshampoo":      (2600, 2800),   # ★司令決定 2026-09-29
}
# ★触らないもの（★叩き台に新価格の記載が無い）
#   men-cut-kids 1850 ／ kariPrice(丸刈り) ／ longAddPrice(ロング加算 600)


def entries(text: str) -> dict[str, tuple[int, int, int]]:
    """id → (price, 該当 price の開始位置, 終了位置)。★項目の並びに依存しない。

    ★2026-09-29: 当初 `name:` の直後に `price:` が来る前提で書き、★officialName が
      間に入る3件を ★黙って取りこぼした（★20件中16件）。★並びに依存させない。
    """
    out: dict[str, tuple[int, int, int]] = {}
    for m in re.finditer(r'\{\s*id:\s*"([^"]+)"(.*?)\}', text, re.S):
        body, base = m.group(2), m.start(2)
        pm = re.search(r'\bprice:\s*(\d+)', body)
        if not pm:
            continue
        out[m.group(1)] = (int(pm.group(1)), base + pm.start(1), base + pm.end(1))
    return out


def check(text: str, label: str) -> tuple[str, list[str]]:
    """(状態, 所見). 状態は 'todo'（要変更）／'done'（済み）／'ng'（止める）。"""
    cur = entries(text)
    missing = [k for k in PLAN if k not in cur]
    if missing:
        return "ng", [f"★{label}: id が見つかりません → {' '.join(missing)}"]
    old_ok = [k for k, (o, n) in PLAN.items() if cur[k][0] == o]
    new_ok = [k for k, (o, n) in PLAN.items() if cur[k][0] == n]
    if len(new_ok) == len(PLAN):
        return "done", [f"★{label}: 既に全{len(PLAN)}件が新価格です（★何もしません）"]
    if len(old_ok) == len(PLAN):
        return "todo", [f"★{label}: 全{len(PLAN)}件の現行が一致しました（★書けます）"]
    bad = [f"{k}: 実物{cur[k][0]} / 現行{o} / 新{n}"
           for k, (o, n) in PLAN.items() if cur[k][0] not in (o, n)]
    return "ng", [f"★★{label}: 現行とも新とも違う値が {len(bad)}件 → ★何も書きません"] + \
                 [f"   {b}" for b in bad]


def apply_to(text: str) -> tuple[str, int]:
    """後ろから置換する（★前から書くと位置がずれる）。"""
    cur = entries(text)
    edits = sorted(((cur[k][1], cur[k][2], n) for k, (o, n) in PLAN.items()
                    if cur[k][0] == o and o != n), reverse=True)
    for s, e, new in edits:
        text = text[:s] + str(new) + text[e:]
    return text, len(edits)


def main() -> int:
    if not ({"--dry-run", "--apply"} & set(sys.argv[1:])):
        print("★--dry-run か --apply を付けてください（★既定では何もしません）")
        return 2
    apply_mode = "--apply" in sys.argv

    plans = []
    for name in TARGETS:
        p = HERE / name
        if not p.exists():
            print(f"★{name}: ファイルがありません（★飛ばします）")
            continue
        text = p.read_text(encoding="utf-8")
        state, notes = check(text, name)
        for n in notes:
            print(n)
        if state == "ng":
            print("★★止めました。★1件でも想定外なら ★何も書きません。")
            return 1
        if state == "todo":
            plans.append((p, text))

    if not plans:
        print("★全部 済みです。")
        return 0
    if not apply_mode:
        for p, text in plans:
            _, n = apply_to(text)
            print(f"★dry-run: {p.name} に {n}件 書く予定（★書いていません）")
        return 0

    for p, text in plans:
        new_text, n = apply_to(text)
        p.write_text(new_text, encoding="utf-8")
        # ★書いた後に読み直して確かめる（★書けたことを ★書いた側の申告で終わらせない）
        state, notes = check(p.read_text(encoding="utf-8"), p.name)
        print(f"★{p.name}: {n}件 書きました → 読み直し: {notes[0]}")
        if state != "done":
            print("★★読み直しで全件一致になりませんでした。★手で確認してください。")
            return 1
    print("★★完了。★このスクリプトは push しません（★呼び出し側が判断）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

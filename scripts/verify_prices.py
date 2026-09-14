#!/usr/bin/env python3
"""menu.config.js（画面の料金）と スプシの料金表 を ★全項目 突き合わせる。

★なぜ要るか（2026-09-14）
  woman-cut-cutshampoo が ★画面1,950円 ／ ★シート2,600円 でずれていた。
  受け口(GAS checkPrice_)は ★値段が合わない記録を ★拒否ログへ落として捨てる。
  → ★お客様が1件目にその項目を選ぶと、★その1行だけ消える。
    複数メニューの改修後は「★後から押した分だけ残る」ように見えた（司令が発見）。
  ★押して確かめる方式では見つからない（★19項目×組み合わせを人は押しきれない）。
  ★★司令「こういうふうになるからさ、ちゃんとデバッグせんといかんやん」

使い方:
  # シートの「料金表」タブを TSV で保存して渡す（見出し行を含めてよい）
  python3 scripts/verify_prices.py --sheet /path/to/price.tsv
  → ★差分があれば終了コード1。無ければ0。

TSV に期待する列（GAS checkPrice_ が読むのと同じ順・A〜F）:
  メニューid / 名前 / 基本 / 丸刈り / ロング加算 / 備考
"""
import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
CONFIG = HERE.parent / "menu.config.js"


def load_config_items():
    """menu.config.js から ★全項目を機械的に抜く（★手で並べない）"""
    txt = CONFIG.read_text(encoding="utf-8")
    items = {}
    for m in re.finditer(r'\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"(.*?)\}', txt, re.S):
        iid, name, rest = m.group(1), m.group(2), m.group(3)

        def num(key):
            mm = re.search(rf"{key}:\s*(null|\d+)", rest)
            return None if (not mm or mm.group(1) == "null") else int(mm.group(1))

        items[iid] = {"name": name, "price": num("price"),
                      "kari": num("kariPrice"), "long": num("longAddPrice")}
    return items


def load_sheet(path):
    rows = {}
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        cells = line.rstrip("\n").split("\t")
        if len(cells) < 3:
            continue
        iid = cells[0].strip()
        if not iid or iid in ("メニューid", "メニューID", "id"):
            continue

        def num(i):
            if i >= len(cells):
                return None
            v = cells[i].strip().replace(",", "").replace("円", "")
            return int(v) if v.isdigit() else None

        rows[iid] = {"name": cells[1].strip() if len(cells) > 1 else "",
                     "price": num(2), "kari": num(3), "long": num(4)}
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="料金表タブの TSV")
    args = ap.parse_args()

    cfg = load_config_items()
    sh = load_sheet(args.sheet)
    print(f"★画面(menu.config.js) {len(cfg)}項目 ／ ★シート(料金表) {len(sh)}項目\n")

    diffs = []
    for iid, c in sorted(cfg.items()):
        s = sh.get(iid)
        if s is None:
            diffs.append((iid, "シートに無い", c["price"], "—"))
            continue
        for key, label in (("price", "基本"), ("kari", "丸刈り"), ("long", "ロング加算")):
            if c[key] != s[key]:
                diffs.append((iid, label, c[key], s[key]))
    for iid in sorted(set(sh) - set(cfg)):
        diffs.append((iid, "画面に無い", "—", sh[iid]["price"]))

    # ★★「差分0」を出す時は ★必ず母数も出す（マリア提案 2026-09-14）。
    #   正規表現が壊れて ★0件抽出になっても「差分0」に見えてしまうため。
    #   ★両方に居るidの数＝陽性対照。★ここが0なら突合そのものが壊れている。
    both = sorted(set(cfg) & set(sh))
    print(f"★両方に居るメニューid ★{len(both)}件（★0なら突合が壊れています）")
    print(f"★比較した値 ★{len(both)}項目 × 3（基本／丸刈り／ロング加算）＝ ★{len(both)*3}個\n")
    if not both:
        print("★★突合できていません。抽出が壊れています（差分0ではありません）。")
        return 2

    if not diffs:
        print(f"★★差分なし。{len(both)}項目×3値、すべて一致しています。")
        return 0

    print(f"★★差分 {len(diffs)}件（★画面 → シート）")
    print(f"  {'メニューid':<30}{'項目':<12}{'画面':>8}{'シート':>8}")
    for iid, label, a, b in diffs:
        print(f"  {iid:<30}{label:<12}{str(a):>8}{str(b):>8}")
    print("\n★シート側が正です（★店の料金表・受け口もこれで検査しています）。")
    return 1


if __name__ == "__main__":
    sys.exit(main())

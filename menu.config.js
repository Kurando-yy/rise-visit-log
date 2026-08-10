/*
 * RISE南関町 来店記録タブレット — メニュー・料金 定義ファイル
 *
 * ★このファイルが唯一の料金マスタです。10/1 の値段改定時は、このファイル内の
 *   price / kariPrice の数値だけを書き換えてください。画面(HTML/CSS/JS)は一切
 *   触る必要がありません。
 *
 * 有効期間: 2026-08-09 〜 2026-09-30（現行価格）
 * ★2026-10-01 から値段改定の予定（2026-08-09時点で改定内容は未定）。
 *   改定が来たら effective.from / effective.to と各 price を書き換えること。
 *
 * 出典: 20260808_来店記録タブレット化_計画_大神.md §実物のメニュー表
 *       （2026-08-09 司令が現地で撮影・受領 msg 1535914594772590612）
 *
 * ★2026-08-10 司令が男性CUTの表示名を書き換え（msg 1536186655256354898・画像で指定）。
 *   店頭メニュー表の名称は「調髪」等のままなので、officialName に元の名称を残してある。
 *   name(画面表示) と officialName(店頭メニュー表) は別物として扱うこと。
 *   ★この書き換えで「調髪＝カット＋シャンプー＋顔剃り」「子供調髪＝子供カット＋シャンプー
 *     （顔剃りは含まない）」が確定した。旧5区分への寄せ表はこれに従う。
 *
 * ★2026-08-10 「ロング増し」を単独メニューから加算方式へ変更（司令指示 msg 1536189024287334431）。
 *   司令の言葉:「女性→カット→ロング増しだけど、これはパーマとカラーにかかってくる料金だね。
 *   カットは関係ない」
 *   旧実装は woman-cut-longmashi（ロング増し）と woman-perma-permalongmashi（パーマロング増し）
 *   を「単独メニュー」として一覧に並べており、お客様がそれだけをタップして600円で確定できて
 *   しまう誤りがあった。この2項目を削除し、代わりに女性 COLOR 全4項目・PERMA 全2項目
 *   （フェイスラインパーマ／パーマ）に加算フラグ hasLong / longAddPrice を付与する方式へ変更。
 *   ★店頭メニュー表には「ロング増し」「パーマロング増し」が今も別項目として印刷されているが、
 *   実態はどちらも同じ600円の加算であり、画面上は各メニュー選択後の画面4c（髪の長さは？）で
 *   「長い（＋600円）」を選ぶことで同じ600円が加算される。男性・女性のカット系（CUT区分）
 *   には一切付けない（司令明示「カットは関係ない」）。
 *
 * データ構造:
 *   id           : 一意キー（gas送信・検証スクリプトで使用）
 *   name         : 画面に表示するメニュー名（お客様が読む文言）
 *   officialName : 店頭メニュー表の名称。name と異なる項目にのみ付与（集計・突合用）
 *   price        : 円（丸刈り価格を持つ項目は「通常」側の価格。ロング加算は含まない基準額）
 *   hasKari      : true の場合、選択後に画面4b（ふつう／丸刈り）を挟む
 *   kariPrice    : 丸刈り選択時の価格（hasKari が false の項目は null）
 *   hasLong      : true の場合、選択後に画面4c（ふつう／長い）を挟み、「長い」選択時に
 *                  longAddPrice を price に加算する
 *   longAddPrice : 「長い」選択時に price へ加算する金額（hasLong が false の項目は null）
 *   isMinimum    : true の場合、表記が「〜」付きで下限値を記録していることを示す
 *                  （フェイスラインパーマ／パーマ(女性) の2項目のみ true。ロング加算後も維持）
 *
 * 丸刈り価格を持つのは MEN'S CUT の3項目のみ（店頭表記→画面表示）:
 *   カットシャンプー   → カットとシャンプー(1,950 / 丸刈り1,700)
 *   カットシェービング → カットと顔剃り(1,950 / 丸刈り1,700)
 *   調髪             → カットとシャンプーと顔剃り(2,200 / 丸刈り1,950)
 *
 * ロング加算(hasLong)を持つのは WOMAN'S COLOR 全4項目・WOMAN'S PERMA 全2項目のみ:
 *   白髪ぼかし／白髪染め／おしゃれ染め／マニキュア（女性COLOR）
 *   フェイスラインパーマ／パーマ（女性PERMA）
 *   いずれも longAddPrice は 600（店頭表記「ロング増し」「パーマロング増し」と同額）。
 */
(function (root) {
  var RISE_MENU_CONFIG = {
    effective: {
      from: "2026-08-09",
      to: "2026-09-30",
      note: "10/1 改定予定。改定内容は2026-08-09時点で未定。改定時は本ファイルの price / kariPrice のみ書き換える。"
    },
    genders: {
      MEN: {
        label: "男性",
        sections: {
          CUT: [
            { id: "men-cut-cut", name: "カット", price: 1300, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-cut-cutshampoo", name: "カットとシャンプー", officialName: "カットシャンプー", price: 1950, hasKari: true, kariPrice: 1700, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-cut-cutshaving", name: "カットと顔剃り", officialName: "カットシェービング", price: 1950, hasKari: true, kariPrice: 1700, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-cut-chouhatsu", name: "カットとシャンプーと顔剃り", officialName: "調髪", price: 2200, hasKari: true, kariPrice: 1950, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-cut-kids", name: "子供カットとシャンプー（0〜15）", officialName: "子供調髪（0〜15）", price: 1850, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false }
          ],
          COLOR: [
            { id: "men-color-shiragabokashi", name: "白髪ぼかし", price: 1950, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-color-shiragazome", name: "白髪染め", price: 3250, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "men-color-color", name: "カラー", price: 3900, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false }
          ],
          PERMA: [
            { id: "men-perma-perma", name: "パーマ", price: 6500, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false }
          ]
        }
      },
      WOMAN: {
        label: "女性",
        sections: {
          CUT: [
            { id: "woman-cut-cut", name: "カット", price: 1300, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "woman-cut-shampoo", name: "シャンプー", price: 1300, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "woman-cut-maegami", name: "前髪カット", price: 600, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false },
            { id: "woman-cut-kaosori", name: "お顔剃り", price: 2050, hasKari: false, kariPrice: null, hasLong: false, longAddPrice: null, isMinimum: false }
          ],
          COLOR: [
            { id: "woman-color-shiragabokashi", name: "白髪ぼかし", price: 1950, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: false },
            { id: "woman-color-shiragazome", name: "白髪染め", price: 4550, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: false },
            { id: "woman-color-oshare", name: "おしゃれ染め", price: 5200, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: false },
            { id: "woman-color-manicure", name: "マニキュア", price: 5200, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: false }
          ],
          PERMA: [
            { id: "woman-perma-faceline", name: "フェイスラインパーマ", price: 5200, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: true },
            { id: "woman-perma-perma", name: "パーマ", price: 6500, hasKari: false, kariPrice: null, hasLong: true, longAddPrice: 600, isMinimum: true }
          ]
        }
      }
    }
  };

  if (typeof module === "object" && module.exports) {
    module.exports = RISE_MENU_CONFIG;
  } else {
    root.RISE_MENU_CONFIG = RISE_MENU_CONFIG;
  }
})(typeof self !== "undefined" ? self : this);

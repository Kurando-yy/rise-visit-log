/*
 * RISE南関町 来店記録タブレット — UI挙動フラグ
 *
 * 計画書 §画面設計 L152:
 *  「男性×パーマは1択なので画面4を飛ばして画面5へ。★操作感が他と変わるので
 *    実機で違和感を確認。不自然なら1択でも画面を出す」
 *
 * この分岐を定数1つで切り替えられるようにする。
 */
(function (root) {
  var RISE_UI_FLAGS = {
    // true  : 該当メニューが1件のみの場合、画面4（一覧）を飛ばして画面5（確定）へ直行する
    // false : 1件のみでも画面4を表示し、1項目だけのボタンをタップさせてから画面5へ進む
    // 2026-08-09時点は true（計画書の既定どおり）。実機テストで違和感があれば false に変更するだけでよい。
    SKIP_SCREEN4_WHEN_SINGLE_ITEM: true,

    // 確定後、自動的に画面1へ戻るまでの待機時間（ミリ秒）
    AUTO_RETURN_MS: 3000,

    // ★送信先タブの切替。
    //   "test" → 試験タブ ／ "live" → 本番タブ
    //   2026-08-10 13:2x 端末→受け口→シートの疎通確認が通ったため live へ切替。
    //   戻す時は "test" に変え、index.html の ?v= も必ず上げること。
    SUBMIT_MODE: "live",

    // ★「他のメニューを追加」を出すか（2026-09-14）。
    //   ★false の間は ★今までどおり1人1メニュー。ボタンは出ない。
    //
    //   ★なぜ既定を false にしたか:
    //     画面を上げた直後、★「visit_id を読む側」が ★実運用では居ないと判明した。
    //     毎晩23時に実際に走るのは ★GAS の dailyRollup で、これは ★行数で客数を数える
    //     （gas/Code_production.gs:333 `g.n++` ／ 初めて・2回目〜・男・女 も同じ）。
    //     マリアが直した Python 版（rise_daily_rollup.py）は ★停止済みのジョブだった。
    //   → ★このまま使えると、★1人が2メニュー選んだ日だけ ★客数が水増しされる。
    //   ★GAS の dailyRollup が visit_id で数えるようになったら true にする。
    //     （★true にするのはそれだけ。画面のコードは触らない）
    //   ★2026-09-14 02:30 true へ。受け口側の確認が取れたため:
    //     司令がデプロイ → 実機で ?mode=test を1タップ → 試験タブ行2に
    //     visit_id=8bc3404c… / visit_seq=1 / visit_size=1 が入ったのをマリアが確認
    //     （Sheets API で 試験!A1:P100 を直接読んで16列とも突合）
    MULTI_MENU_ENABLED: true
  };

  if (typeof module === "object" && module.exports) {
    module.exports = RISE_UI_FLAGS;
  } else {
    root.RISE_UI_FLAGS = RISE_UI_FLAGS;
  }
})(typeof self !== "undefined" ? self : this);

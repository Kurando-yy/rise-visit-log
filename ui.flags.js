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
    SUBMIT_MODE: "live"
  };

  if (typeof module === "object" && module.exports) {
    module.exports = RISE_UI_FLAGS;
  } else {
    root.RISE_UI_FLAGS = RISE_UI_FLAGS;
  }
})(typeof self !== "undefined" ? self : this);

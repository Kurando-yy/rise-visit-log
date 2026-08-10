/**
 * RISE南関町 来店記録タブレット — GAS 受け口（コードのみ／未デプロイ）
 *
 * ★★重要: このファイルはコードを書いただけで、デプロイ・スプレッドシートへの
 *   接続・認証は一切行っていない（Hanabi/大神ともにライズのシートへのアクセス権を
 *   持たないため）。デプロイは後日、権限を持つ者（司令）が行うこと。
 *
 * 役割: iPad から送られてくる1件＝1来店のレコードを、明細シート（正本）へ
 *       追記(append)する。既存の「来店記録02」タブへは直接書かない。
 *       （理由: 計画書 §データの置き場所 ★★粒度の段差。
 *        既存タブは「1日1行の日次集計」、明細シートは「1件ごとに1行」で
 *        粒度が異なるため、直接統合すると既存の集計・グラフが壊れる。
 *        既存タブの更新は本ファイルの範囲外＝別途「日次集計バッチ」で行う想定。
 *        下部の DAILY AGGREGATION（未実装）コメントを参照）
 *
 * デプロイ時に権限保持者が行うこと（このファイルの外の作業）:
 *   1. SPREADSHEET_ID を実際のスプレッドシートIDに置き換える
 *   2. SHEET_NAME が実シートのタブ名と一致しているか確認する（無ければ作成）
 *   3. ウェブアプリとしてデプロイし、発行された実行URLを
 *      submit.js の SUBMIT_URL に反映する（この作業もこのファイルの外）
 *   4. シートの共有設定＝閲覧・編集は司令のみ。追記はこのAPI経由のみに限定する
 */

// ★プレースホルダ。デプロイ時に権限保持者が実IDへ差し替える。
var SPREADSHEET_ID = "PLACEHOLDER_SPREADSHEET_ID";

// 明細シート（正本）のタブ名。既存「来店記録02」とは別タブにすること。
var DETAIL_SHEET_NAME = "来店記録_明細";

// 明細シートの列順（1行目にヘッダーとして書く想定）
// ★2026-08-10 long_applied / long_add_price を追加（司令指示 msg 1536189024287334431）。
//   「ロング増し」「パーマロング増し」を単独メニューから加算方式へ変更したのに伴い、
//   submit.js buildRecord() が返すレコードに合わせて列を追加した。列順は末尾に追加のため
//   既存の A〜I 列（received_at含む）はそのまま。received_at は依然として最終列。
var COLUMNS = [
  "timestamp_iso",   // A: 来店時刻（ISO・JST）
  "visit_type",      // B: "first" | "repeat"
  "gender",          // C: "MEN" | "WOMAN"
  "section",         // D: "CUT" | "COLOR" | "PERMA"
  "menu_name",       // E: メニュー名
  "kari_applied",    // F: 丸刈り適用の有無（true/false）
  "price",           // G: 金額（円・丸刈り/ロング加算を反映した最終金額）
  "is_minimum",      // H: 「〜」表記の下限値で記録した場合 true
  "long_applied",    // I: ロング加算（旧「ロング増し」「パーマロング増し」相当）適用の有無（true/false）
  "long_add_price",  // J: ロング加算額（未適用時は0）
  "received_at"      // K: サーバー受信時刻（サーバー側 new Date()。突合・遅延検知用）
];

/**
 * iPad からの POST を受け、明細シートへ1行追記する。
 * リクエストボディは submit.js の buildRecord() が生成する JSON と一致させること。
 */
function doPost(e) {
  var result = { ok: false };
  try {
    var payload = JSON.parse(e.postData.contents);
    appendDetailRow(payload);
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = String(err);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function appendDetailRow(payload) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DETAIL_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DETAIL_SHEET_NAME);
    sheet.appendRow(COLUMNS);
  }
  var row = COLUMNS.map(function (col) {
    if (col === "received_at") return new Date();
    return payload[col] !== undefined ? payload[col] : "";
  });
  // 追記専用: appendRow のみを使用し、既存行の書き換えは一切行わない
  sheet.appendRow(row);
}

/* =========================================================================
 * DAILY AGGREGATION（日次集計・今回は実装しない／設計メモのみ）
 * =========================================================================
 * 目的: 明細シート（正本・1件1行）から「来店記録02」（既存・1日1行の集計）
 *       への反映を自動化し、二重入力を無くす。
 *
 * 想定設計（未実装）:
 *   1. 時間主導トリガー（例: 毎日 23:55 JST）で aggregateDaily() を実行
 *   2. 明細シートを timestamp_iso の日付でフィルタし、その日の行を集計:
 *        - 来店客数 = 行数
 *        - 初めて / 2回目〜 の内訳 = visit_type で集計
 *        - 男 / 女 の内訳 = gender で集計
 *        - カット / カット&顔剃り / カット&シャンプー / カラー / パーマ の内訳
 *          = section（と menu_name の一部）から旧5区分へマッピングして集計
 *          ※ 旧5区分と新21項目のマッピング表は未確定（計画書 §未確定 参照）。
 *            ここは司令・マリアと合意の上で別途実装すること。
 *   3. 「来店記録02」シートの該当日付の行を探し、A〜K列を更新
 *      （★行の「追加」ではなく「その日の合計値の更新」。既存の集計・グラフの
 *        列構成を変えないこと）
 *
 * 本ファイルでは aggregateDaily() を実装しない。理由:
 *   - 旧5区分と新21項目のマッピングが未確定（司令確認待ち）
 *   - 「来店記録02」への書き込み権限・シート構造の最終確認が必要
 *   実装は上記が確定してから、明細シートの運用実績を見た上で行う。
 * ========================================================================= */

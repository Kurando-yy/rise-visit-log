#!/usr/bin/env node
/*
 * 19項目 到達可能性 検証スクリプト
 *
 * menu.config.js（メニュー定義）と menu.logic.js / ui.flags.js（app.js が実際に
 * 使う画面遷移ロジック本体）を Node から直接 require し、
 * 「設定ファイルに存在する全項目が、実装の画面遷移ロジック上どの経路で
 *   到達するか」を機械的に列挙する。
 *
 * 手で数件チェックするのではなく、config を全走査して 19/19 を確認する。
 *
 * ★2026-08-10 21→19件に変更（司令指示 msg 1536189024287334431）。
 *   「ロング増し」woman-cut-longmashi と「パーマロング増し」woman-perma-permalongmashi の
 *   2項目を単独メニューから削除し、女性COLOR全4項目・女性PERMA全2項目に
 *   hasLong/longAddPrice（画面4c経由の加算方式）を付与した。
 *   このスクリプトでも hasLong 対象6項目が画面4c経由で +600円になることを機械的に確認する。
 */
var path = require("path");
var CONFIG = require(path.join(__dirname, "..", "menu.config.js"));
var LOGIC = require(path.join(__dirname, "..", "menu.logic.js"));
var FLAGS = require(path.join(__dirname, "..", "ui.flags.js"));

var total = 0;
var rows = [];
var screen4CountTable = {}; // { MEN: {CUT:n,...}, WOMAN: {...} } — 計画書の表と突合するため

Object.keys(CONFIG.genders).forEach(function (genderKey) {
  var genderDef = CONFIG.genders[genderKey];
  screen4CountTable[genderKey] = {};
  Object.keys(genderDef.sections).forEach(function (sectionKey) {
    var items = LOGIC.getItemsFor(CONFIG, genderKey, sectionKey);
    screen4CountTable[genderKey][sectionKey] = items.length;
    items.forEach(function (item) {
      total++;
      var pathDesc = LOGIC.describePath(CONFIG, FLAGS, genderKey, sectionKey, item);
      rows.push({
        id: item.id,
        gender: genderDef.label,
        section: sectionKey,
        name: item.name,
        price: item.price,
        isMinimum: item.isMinimum,
        hasKari: item.hasKari,
        kariPrice: item.kariPrice,
        hasLong: item.hasLong,
        longAddPrice: item.longAddPrice,
        path: pathDesc
      });
    });
  });
});

console.log("=== 19項目 到達経路 一覧 ===");
rows.forEach(function (r) {
  var priceNote = r.isMinimum ? r.price + "円〜(下限で記録)" : r.price + "円";
  var kariNote = r.hasKari ? " [丸刈り時" + r.kariPrice + "円]" : "";
  var longNote = r.hasLong ? " [長い選択時+" + r.longAddPrice + "円=" + (r.price + r.longAddPrice) + "円]" : "";
  console.log("[" + r.id + "] " + r.gender + "/" + r.section + "/" + r.name + " : " + priceNote + kariNote + longNote);
  console.log("   経路: " + r.path);
});

console.log("");
console.log("=== 画面4に並ぶ件数（計画書の表と突合） ===");
console.log(JSON.stringify(screen4CountTable, null, 2));

var expectedTable = {
  MEN: { CUT: 5, COLOR: 3, PERMA: 1 },
  WOMAN: { CUT: 5, COLOR: 4, PERMA: 2 }
};

var tableMismatch = [];
Object.keys(expectedTable).forEach(function (g) {
  Object.keys(expectedTable[g]).forEach(function (s) {
    var expected = expectedTable[g][s];
    var actual = screen4CountTable[g] && screen4CountTable[g][s];
    if (actual !== expected) {
      tableMismatch.push(g + "/" + s + " expected=" + expected + " actual=" + actual);
    }
  });
});

console.log("");
console.log("=== 集計結果 ===");
console.log("config内の総項目数: " + total);
console.log("到達経路が算出できた項目数: " + rows.length);
console.log("到達不能(unreachable): " + (total - rows.length) + " 件");

var ok = true;

if (total !== 20) {
  console.error("NG: 総項目数が20件ではありません（" + total + "件）");
  ok = false;
}

if (rows.length !== total) {
  console.error("NG: 到達不能な項目があります（" + (total - rows.length) + "件）");
  ok = false;
}

// 全項目のidがユニークか
var idSet = {};
var dupIds = [];
rows.forEach(function (r) {
  if (idSet[r.id]) dupIds.push(r.id);
  idSet[r.id] = true;
});
if (dupIds.length > 0) {
  console.error("NG: id重複あり: " + dupIds.join(", "));
  ok = false;
}

if (tableMismatch.length > 0) {
  console.error("NG: 計画書の画面4件数表と不一致: " + tableMismatch.join(" / "));
  ok = false;
}

// 丸刈り対象は MEN/CUT の3項目のみであることを確認
var kariItems = rows.filter(function (r) {
  return r.hasKari;
});
var kariIdsExpected = ["men-cut-cutshampoo", "men-cut-cutshaving", "men-cut-chouhatsu"].sort();
var kariIdsActual = kariItems.map(function (r) { return r.id; }).sort();
if (JSON.stringify(kariIdsExpected) !== JSON.stringify(kariIdsActual)) {
  console.error("NG: 丸刈り対象項目が想定と不一致。期待=" + kariIdsExpected.join(",") + " 実際=" + kariIdsActual.join(","));
  ok = false;
}

// 下限フラグ(isMinimum)は女性PERMAの2項目のみであることを確認
var minItems = rows.filter(function (r) { return r.isMinimum; });
var minIdsExpected = ["woman-perma-faceline", "woman-perma-perma"].sort();
var minIdsActual = minItems.map(function (r) { return r.id; }).sort();
if (JSON.stringify(minIdsExpected) !== JSON.stringify(minIdsActual)) {
  console.error("NG: 下限フラグ項目が想定と不一致。期待=" + minIdsExpected.join(",") + " 実際=" + minIdsActual.join(","));
  ok = false;
}

// ★2026-08-10 追加: 「ロング増し」「パーマロング増し」の旧・単独メニュー2件が
// 一覧から消えていることを確認（id・表示名の両方）
var removedIds = ["woman-cut-longmashi", "woman-perma-permalongmashi"];
var stillPresentIds = removedIds.filter(function (id) { return idSet[id]; });
if (stillPresentIds.length > 0) {
  console.error("NG: 削除されたはずの単独メニューがまだ存在します: " + stillPresentIds.join(", "));
  ok = false;
}
var removedNames = ["ロング増し", "パーマロング増し"];
var stillPresentNames = rows.filter(function (r) { return removedNames.indexOf(r.name) !== -1; });
if (stillPresentNames.length > 0) {
  console.error("NG: 削除されたはずの表示名がまだ存在します: " + stillPresentNames.map(function (r) { return r.id + "(" + r.name + ")"; }).join(", "));
  ok = false;
}

// ★2026-08-10 追加: hasLong 対象は 女性COLOR全4項目・女性PERMA全2項目の計6件であり、
// それぞれ画面4c を経由して longAddPrice(600円) が price に加算されることを機械的に確認する
console.log("");
console.log("=== ロング加算(hasLong)対象6項目の 画面4c経由 +600円 検証 ===");
var longItemsExpectedIds = [
  "woman-color-shiragabokashi", "woman-color-shiragazome", "woman-color-oshare", "woman-color-manicure",
  "woman-perma-faceline", "woman-perma-perma"
].sort();
var longItems = rows.filter(function (r) { return r.hasLong; });
var longItemsActualIds = longItems.map(function (r) { return r.id; }).sort();
if (JSON.stringify(longItemsExpectedIds) !== JSON.stringify(longItemsActualIds)) {
  console.error("NG: hasLong対象項目が想定と不一致。期待=" + longItemsExpectedIds.join(",") + " 実際=" + longItemsActualIds.join(","));
  ok = false;
}
var LONG_ADD_PRICE_EXPECTED = 600;
longItems.forEach(function (r) {
  var passesScreen4c = r.path.indexOf("画面4c(") !== -1;
  var addOk = r.longAddPrice === LONG_ADD_PRICE_EXPECTED;
  var finalPrice = r.price + r.longAddPrice;
  var line = "[" + r.id + "] " + r.name + " : ふつう" + r.price + "円 → 長い" + finalPrice + "円"
    + " / 画面4c経由=" + passesScreen4c + " / 加算額600円=" + addOk;
  console.log(line);
  if (!passesScreen4c || !addOk) {
    console.error("NG: " + r.id + " は画面4c経由で+600円になっていません");
    ok = false;
  }
});
if (longItems.length !== 6) {
  console.error("NG: hasLong対象が6件ではありません（" + longItems.length + "件）");
  ok = false;
}
// カット系(CUT区分)には hasLong が一切付いていないことを確認（司令明示「カットは関係ない」）
var cutSectionHasLong = rows.filter(function (r) { return r.section === "CUT" && r.hasLong; });
if (cutSectionHasLong.length > 0) {
  console.error("NG: CUT区分にhasLongが付いています（あってはならない）: " + cutSectionHasLong.map(function (r) { return r.id; }).join(","));
  ok = false;
}

console.log("");
if (ok) {
  console.log("OK: " + total + "/" + total + " 到達可能。到達不能0件。id重複0件。計画書の件数表と一致。丸刈り対象3件・下限フラグ2件も想定どおり。ロング増し/パーマロング増しの単独メニューは削除済み。hasLong対象6件は画面4c経由で+600円。");
  process.exit(0);
} else {
  console.log("FAIL: 上記 NG を確認してください。");
  process.exit(1);
}

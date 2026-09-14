#!/usr/bin/env node
/*
 * 1来店で複数メニューを選べるようにした分の検証（2026-09-14 司令ご依頼）。
 *
 * ★確かめたいこと（これが崩れると ★客数が水増しされる）
 *   1. 同じ来店の行は ★全部 同じ visit_id を持つ
 *   2. 違う来店どうしは ★必ず違う visit_id になる
 *   3. 行ごとの menu_id / price は ★それぞれ別（売上とメニュー別集計を壊さない）
 *   4. メニュー1つの時も ★visit_id が入る（空の意味を1つに保つ）
 *   5. ?mode=test を付けたら ★必ず試験タブ側になる／★live へは上げられない
 *
 * ★「止まること」だけでなく「通ること」も見る。全部落ちる作りでも合格に見えるため。
 *
 * 使い方: node scripts/verify_multi_menu.js
 */
var path = require("path");

// submit.js は window 前提の箇所があるため、最低限の器を先に用意する
global.self = global;
global.window = global;
var LOCATION = { search: "" };
global.location = LOCATION;
var STORE = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null; },
  setItem: function (k, v) { STORE[k] = String(v); },
  removeItem: function (k) { delete STORE[k]; }
};

var SUBMIT = require(path.join(__dirname, "..", "submit.js"));
var FLAGS = require(path.join(__dirname, "..", "ui.flags.js"));
global.RISE_UI_FLAGS = FLAGS;

var ng = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ○ " + name);
  } else {
    ng++;
    console.log("  ★NG " + name + (detail ? "  → " + detail : ""));
  }
}

function sel(id, name, price) {
  return {
    visitType: "first", gender: "MEN", section: "CUT",
    item: { id: id, name: name }, kariApplied: false, longApplied: false,
    longAddPrice: 0, price: price, isMinimum: false
  };
}

console.log("★① 1来店で2メニュー（カット＋カラー）");
var cart = [sel("men-cut", "カット", 4000), sel("men-color", "カラー", 3150)];
var recs = SUBMIT.buildRecords(cart[0], cart);
check("2行できる", recs.length === 2, "実際 " + recs.length);
check("visit_id が同じ", recs[0].visit_id === recs[1].visit_id,
      recs[0].visit_id + " / " + recs[1].visit_id);
check("visit_seq が 1,2", recs[0].visit_seq === 1 && recs[1].visit_seq === 2);
check("visit_size が 2", recs.every(function (r) { return r.visit_size === 2; }));
check("menu_id は別々", recs[0].menu_id === "men-cut" && recs[1].menu_id === "men-color");
check("price は別々", recs[0].price === 4000 && recs[1].price === 3150);
check("record_id は行ごとに別", recs[0].record_id !== recs[1].record_id);

console.log("★② 別の来店とは visit_id が違う（★同じだと2人が1人に潰れる）");
var other = SUBMIT.buildRecords(cart[0], [sel("men-cut", "カット", 4000)]);
check("違う来店＝違う visit_id", other[0].visit_id !== recs[0].visit_id);

console.log("★③ メニュー1つの時（今までと同じ使い方）");
var one = SUBMIT.buildRecords(sel("men-cut", "カット", 4000), [sel("men-cut", "カット", 4000)]);
check("1行だけできる", one.length === 1);
check("★visit_id が入っている", !!one[0].visit_id, "空だと古い行と見分けが付かない");
check("visit_size が 1", one[0].visit_size === 1);

console.log("★④ cart を渡さない旧い呼び方でも壊れない");
var legacy = SUBMIT.buildRecords(sel("men-cut", "カット", 4000), []);
check("1行できる", legacy.length === 1 && legacy[0].menu_id === "men-cut");

console.log("★⑤ 送信先モード");
LOCATION.search = "";
check("既定は ui.flags.js のとおり（いま live）", SUBMIT.getMode() === "live",
      "実際 " + SUBMIT.getMode());
LOCATION.search = "?mode=test";
check("★?mode=test なら test", SUBMIT.getMode() === "test", "実際 " + SUBMIT.getMode());
LOCATION.search = "?mode=live";
check("★?mode=live では本番に上げられない（flags が live の時だけ live）",
      SUBMIT.getMode() === "live");
LOCATION.search = "?x=1&mode=test&y=2";
check("他の引数と混ざっていても効く", SUBMIT.getMode() === "test");
LOCATION.search = "?mode=testing";
check("★mode=testing のような紛らわしい値では外れない",
      SUBMIT.getMode() === "live", "実際 " + SUBMIT.getMode());
LOCATION.search = "";

console.log("");
if (ng === 0) {
  console.log("★★全部 期待どおりです");
  process.exit(0);
}
console.log("★★" + ng + "件 ずれています");
process.exit(1);

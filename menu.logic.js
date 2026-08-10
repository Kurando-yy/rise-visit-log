/*
 * RISE南関町 来店記録タブレット — 画面遷移の純粋ロジック
 *
 * DOM に依存しない純粋関数のみを置く。ブラウザ（<script>読み込み）と
 * Node（検証スクリプト scripts/verify_reachability.js）の両方から同じ関数を
 * 呼び出すことで、「実装の到達可否」と「検証結果」が食い違わないようにする。
 */
(function (root) {
  /**
   * 性別×区分に該当するメニュー項目の配列を返す（= 画面4に並ぶ候補、または1件のみの場合の対象）
   */
  function getItemsFor(config, genderKey, sectionKey) {
    var genderDef = config.genders[genderKey];
    if (!genderDef) throw new Error("unknown gender: " + genderKey);
    var items = genderDef.sections[sectionKey];
    if (!items) throw new Error("unknown section: " + sectionKey + " for gender " + genderKey);
    return items;
  }

  /**
   * 画面3(区分選択)完了後、画面4を表示するかどうかを判定する。
   * uiFlags.SKIP_SCREEN4_WHEN_SINGLE_ITEM が true かつ該当項目が1件のみの場合は false（スキップ）。
   */
  function shouldShowScreen4(config, uiFlags, genderKey, sectionKey) {
    var items = getItemsFor(config, genderKey, sectionKey);
    if (items.length === 1 && uiFlags.SKIP_SCREEN4_WHEN_SINGLE_ITEM) return false;
    return true;
  }

  /**
   * 画面4b（ふつう／丸刈り）を表示するかどうか
   */
  function shouldShowScreen4b(item) {
    return !!item.hasKari;
  }

  /**
   * 画面4c（ふつう／長い＝ロング加算）を表示するかどうか
   * ★2026-08-10 追加。hasKari(丸刈り)対象＝男性CUTのみ、hasLong(ロング加算)対象＝
   *   女性COLOR/PERMAのみで互いに排他だが、念のため両方の判定を独立して行う
   *   （画面4b→4c の順で判定・表示する。app.js 側の遷移順もこれに合わせる）。
   */
  function shouldShowScreen4c(item) {
    return !!item.hasLong;
  }

  /**
   * 選択結果から最終金額と「下限フラグ」を確定する。
   * kariChoice: "normal" | "kari" | null（hasKari が false の項目では null）
   * longChoice: "normal" | "long" | null（hasLong が false の項目では null）
   * ロング加算は price に対する加算方式（単独メニューではない）。
   */
  function resolvePrice(item, kariChoice, longChoice) {
    var price = item.price;
    var kariApplied = false;
    if (item.hasKari && kariChoice === "kari") {
      price = item.kariPrice;
      kariApplied = true;
    }
    var longApplied = false;
    if (item.hasLong && longChoice === "long") {
      price = price + item.longAddPrice;
      longApplied = true;
    }
    return { price: price, isMinimum: !!item.isMinimum, kariApplied: kariApplied, longApplied: longApplied };
  }

  /**
   * 1メニュー項目が、実際にどの画面経路で到達するかを文字列で表す（検証・ログ用）
   */
  function describePath(config, uiFlags, genderKey, sectionKey, item) {
    var genderDef = config.genders[genderKey];
    var showScreen4 = shouldShowScreen4(config, uiFlags, genderKey, sectionKey);
    var parts = [
      "画面1(来店回数)",
      "画面2(" + genderDef.label + ")",
      "画面3(" + sectionKey + ")",
      showScreen4 ? "画面4(" + item.name + "選択)" : "画面4スキップ(1択自動確定)"
    ];
    if (shouldShowScreen4b(item)) parts.push("画面4b(ふつう/丸刈り)");
    if (shouldShowScreen4c(item)) parts.push("画面4c(ふつう/長い+" + item.longAddPrice + "円)");
    parts.push("画面5(確定)");
    return parts.join("→");
  }

  var RISE_MENU_LOGIC = {
    getItemsFor: getItemsFor,
    shouldShowScreen4: shouldShowScreen4,
    shouldShowScreen4b: shouldShowScreen4b,
    shouldShowScreen4c: shouldShowScreen4c,
    resolvePrice: resolvePrice,
    describePath: describePath
  };

  if (typeof module === "object" && module.exports) {
    module.exports = RISE_MENU_LOGIC;
  } else {
    root.RISE_MENU_LOGIC = RISE_MENU_LOGIC;
  }
})(typeof self !== "undefined" ? self : this);

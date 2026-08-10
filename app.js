/*
 * RISE南関町 来店記録タブレット — 画面制御（DOM操作）
 * サーバー不要・ビルド不要。index.html から classic <script> で読み込む。
 * 依存: menu.config.js(RISE_MENU_CONFIG) / menu.logic.js(RISE_MENU_LOGIC)
 *       ui.flags.js(RISE_UI_FLAGS) / submit.js(RISE_SUBMIT)
 */
(function () {
  "use strict";

  var CONFIG = window.RISE_MENU_CONFIG;
  var LOGIC = window.RISE_MENU_LOGIC;
  var FLAGS = window.RISE_UI_FLAGS;
  var SUBMIT = window.RISE_SUBMIT;

  var screens = {
    s1: document.getElementById("screen-1"),
    s2: document.getElementById("screen-2"),
    s3: document.getElementById("screen-3"),
    s4: document.getElementById("screen-4"),
    s4b: document.getElementById("screen-4b"),
    s4c: document.getElementById("screen-4c"),
    s5: document.getElementById("screen-5")
  };

  var SECTION_LABEL = { CUT: "カット", COLOR: "カラー", PERMA: "パーマ" };

  // 現在の来店者の選択状態（確定後にリセットする）
  var state = {};

  function resetState() {
    state = {
      visitType: null, // "first" | "repeat"
      gender: null, // "MEN" | "WOMAN"
      section: null, // "CUT" | "COLOR" | "PERMA"
      item: null, // メニュー項目オブジェクト
      kariChoice: null, // "normal" | "kari" | null（画面4bで選択）
      longChoice: null, // "normal" | "long" | null（画面4cで選択）
      kariApplied: false,
      longApplied: false,
      longAddPrice: 0,
      price: null,
      isMinimum: false
    };
  }
  resetState();

  function showOnly(key) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle("active", k === key);
    });
  }

  function goScreen1() {
    resetState();
    showOnly("s1");
  }

  function goScreen2() {
    showOnly("s2");
  }

  function goScreen3() {
    showOnly("s3");
  }

  function renderScreen4() {
    var items = LOGIC.getItemsFor(CONFIG, state.gender, state.section);
    var container = document.getElementById("screen-4-buttons");
    container.innerHTML = "";
    items.forEach(function (item) {
      var btn = document.createElement("button");
      btn.className = "tap-btn menu-btn";
      btn.type = "button";
      btn.textContent = item.name;
      btn.addEventListener("click", function () {
        chooseItem(item);
      });
      container.appendChild(btn);
    });
    showOnly("s4");
  }

  function goScreen4b() {
    showOnly("s4b");
  }

  function goScreen4c() {
    showOnly("s4c");
  }

  // 画面4で項目を選んだ直後。画面4b(丸刈り)→画面4c(ロング加算) の順で判定する。
  // hasKari(男性CUT)とhasLong(女性COLOR/PERMA)は互いに排他だが、両方立った場合でも
  // 順序が固定されていれば壊れない構成にしてある。
  function chooseItem(item) {
    state.item = item;
    state.kariChoice = null;
    state.longChoice = null;
    proceedAfterKari();
  }

  function proceedAfterKari() {
    if (LOGIC.shouldShowScreen4b(state.item)) {
      goScreen4b();
      return;
    }
    proceedAfterLong();
  }

  function proceedAfterLong() {
    if (LOGIC.shouldShowScreen4c(state.item)) {
      goScreen4c();
      return;
    }
    finalizePrice();
  }

  function finalizePrice() {
    var resolved = LOGIC.resolvePrice(state.item, state.kariChoice, state.longChoice);
    state.price = resolved.price;
    state.isMinimum = resolved.isMinimum;
    state.kariApplied = resolved.kariApplied;
    state.longApplied = resolved.longApplied;
    state.longAddPrice = resolved.longApplied ? state.item.longAddPrice : 0;
    renderScreen5();
  }

  function renderScreen5() {
    document.getElementById("screen-5-price").textContent = state.price.toLocaleString("ja-JP") + " 円です";
    showOnly("s5");
  }

  function confirmAndSubmit() {
    var confirmBtn = document.getElementById("btn-confirm");
    confirmBtn.disabled = true;

    var record = SUBMIT.buildRecord(state);
    SUBMIT.submitRecord(record);
    SUBMIT.retryPending(); // ついでに未送信キューの再送も試みる

    setTimeout(function () {
      confirmBtn.disabled = false;
      goScreen1();
    }, FLAGS.AUTO_RETURN_MS);
  }

  // ---- イベント登録 ----

  document.getElementById("btn-first").addEventListener("click", function () {
    state.visitType = "first";
    goScreen2();
  });
  document.getElementById("btn-repeat").addEventListener("click", function () {
    state.visitType = "repeat";
    goScreen2();
  });

  document.getElementById("btn-men").addEventListener("click", function () {
    state.gender = "MEN";
    goScreen3();
  });
  document.getElementById("btn-woman").addEventListener("click", function () {
    state.gender = "WOMAN";
    goScreen3();
  });

  ["CUT", "COLOR", "PERMA"].forEach(function (sectionKey) {
    document.getElementById("btn-section-" + sectionKey.toLowerCase()).addEventListener("click", function () {
      state.section = sectionKey;
      var items = LOGIC.getItemsFor(CONFIG, state.gender, state.section);
      if (LOGIC.shouldShowScreen4(CONFIG, FLAGS, state.gender, state.section)) {
        renderScreen4();
      } else {
        // 1択かつスキップ設定＝画面4を飛ばして直接選択確定
        chooseItem(items[0]);
      }
    });
  });

  document.getElementById("btn-kari-normal").addEventListener("click", function () {
    state.kariChoice = "normal";
    proceedAfterLong();
  });
  document.getElementById("btn-kari-kari").addEventListener("click", function () {
    state.kariChoice = "kari";
    proceedAfterLong();
  });

  document.getElementById("btn-long-normal").addEventListener("click", function () {
    state.longChoice = "normal";
    finalizePrice();
  });
  document.getElementById("btn-long-long").addEventListener("click", function () {
    state.longChoice = "long";
    finalizePrice();
  });

  document.getElementById("btn-confirm").addEventListener("click", confirmAndSubmit);

  // 起動時に未送信キューがあれば再送を試みる（Wi-Fi復帰後などを想定）
  SUBMIT.retryPending();

  goScreen1();
})();

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

  /*
   * ── 画面1上部の帯 ────────────────────────────────────────────
   * 目的（司令 2026-08-16）: ①入力し忘れの防止 ②レジとの突合
   * ★数字はサーバ（GAS）が数えたものをそのまま出す。端末では数え直さない。
   *   取得できない時は、前の数字も 0 も出さず「取得できません」と出す。
   *   古い数字を正しい顔で見せると、突合しているつもりで合っていない状態になる。
   */
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /*
   * ★受け口の公開版が古い（action:"today" を知らない）場合の自衛。
   *   古い版はこの要求を「record_id の無い記録」とみなして拒否し、★拒否ログに1行書く。
   *   画面1に戻るたびに呼ぶので、放っておくと拒否ログが客数ぶん溜まる。
   *   一度そう分かったら、その場で呼ぶのをやめる（記録の送信そのものには影響しない）。
   */
  var todayDisabled = false;
  var todayDisabledNote = "";

  function renderTodayBar(data) {
    var bar = document.getElementById("today-bar");
    var alertEl = document.getElementById("today-alert");
    var notes = [];

    var pending = 0;
    try { pending = SUBMIT.pendingCount(); } catch (e) { pending = 0; }
    if (pending > 0) notes.push("未送信 " + pending + " 件");

    if (!data || data.ok !== true) {
      // ★ここで 0 を出さない。「0人」と「分からない」は別物。
      setText("today-last", "—");
      setText("today-count", "—");
      setText("today-amount", "");
      if (bar) bar.classList.remove("is-closed");
      if (data && data.reason === "no_token") {
        notes.unshift("この端末は未登録です");
      } else if (data && data.reason === "server" && data.msg === "no_record_id") {
        // 公開版が古い。呼び続けると拒否ログが溜まるので、この画面では以降呼ばない。
        todayDisabled = true;
        todayDisabledNote = "受け口が未更新です（デプロイし直してください）";
        notes.unshift(todayDisabledNote);
      } else if (todayDisabled) {
        notes.unshift(todayDisabledNote);
      } else {
        notes.unshift("数字を取得できません（通信）");
      }
    } else if (data.closed) {
      setText("today-last", data.last || "—");
      setText("today-count", "本日休業");
      setText("today-amount", "");
      if (bar) bar.classList.add("is-closed");
    } else {
      // ★時刻だけだと、見た人が引き算をしないと「空きすぎ」に気づけない。
      //   経過分をそのまま添える（司令の意図＝入力し忘れの防止）。
      var last = data.last || "";
      var mins = (data.since_min === null || data.since_min === undefined) ? null : Number(data.since_min);
      setText("today-last", last ? (mins === null ? last : last + "（" + mins + "分前）") : "まだありません");
      setText("today-count", (Number(data.count) || 0) + " 人");
      setText("today-amount", (Number(data.amount) || 0).toLocaleString("ja-JP") + " 円");
      if (bar) bar.classList.remove("is-closed");

      // ★「何分空いたら警告か」はサーバ（設定シート しきい値_分）が決める。
      //   ここに分数を書くと、設定を変えた時に画面とGASで基準が2つになる。
      if (data.alert === true) {
        notes.unshift(mins === null ? "入力が空いています" : mins + "分 入力がありません");
      }
    }

    if (alertEl) {
      alertEl.textContent = notes.join(" ／ ");
      alertEl.hidden = notes.length === 0;
    }
  }

  function refreshTodayBar() {
    if (todayDisabled) { renderTodayBar(null); return; }
    // 取りに行っている間は、前の数字を残さない（古い値を突合に使わせない）
    renderTodayBar(null);
    setText("today-last", "…");
    setText("today-count", "…");
    setText("today-amount", "…");
    var alertEl = document.getElementById("today-alert");
    if (alertEl) alertEl.hidden = true;

    SUBMIT.fetchToday().then(renderTodayBar).catch(function () { renderTodayBar(null); });
  }

  function goScreen1() {
    resetState();
    showOnly("s1");
    refreshTodayBar();
  }

  /*
   * ── 本日の一覧（ダイアログ） ──────────────────────────────────
   * 司令 2026-08-16: 入力時間 / 来店回数 / 性別 / メニュー名 / 金額 を一覧で。
   * ★中身はサーバが並べて整形したものをそのまま出す。端末で数えも並べ替えもしない。
   *   受信日時はシート上で 0埋めが落ちるため、端末で時刻を解釈すると午前10時以降に狂う。
   */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderTodayList(data) {
    var body = document.getElementById("list-body");
    if (!body) return;

    if (!data || data.ok !== true) {
      var msg = "一覧を取得できません（通信）";
      if (data && data.reason === "no_token") {
        msg = "この端末は未登録です";
      } else if (data && data.reason === "server" && data.msg === "no_record_id") {
        // ★帯と同じ自衛。古い受け口はこの要求を拒否ログに1行書くので、以降は叩かない。
        todayDisabled = true;
        todayDisabledNote = "受け口が未更新です（デプロイし直してください）";
        msg = todayDisabledNote;
      } else if (data && data.reason === "server") {
        msg = "一覧を取得できません（" + esc(data.msg) + "）";
      }
      body.innerHTML = '<div class="list-msg">' + esc(msg) + "</div>";
      return;
    }

    var rows = data.rows || [];
    if (rows.length === 0) {
      body.innerHTML = '<div class="list-msg">' +
        (data.closed ? "本日は休業日です" : "まだ1件も入力されていません") + "</div>";
      return;
    }

    var total = 0;
    var html = '<table class="list-table"><thead><tr>' +
      "<th>入力時間</th><th>来店</th><th>性別</th><th>メニュー</th><th>金額</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var price = Number(r.price) || 0;
      total += price;
      html += "<tr>" +
        "<td>" + esc(r.time) + "</td>" +
        "<td>" + esc(r.visit) + "</td>" +
        "<td>" + esc(r.gender) + "</td>" +
        "<td>" + esc(r.menu) + "</td>" +
        '<td class="num">' + price.toLocaleString("ja-JP") + "</td>" +
        "</tr>";
    });
    html += "</tbody></table>";
    // ★合計は受け取った行から出す（帯の数字と別経路にしない）。
    //   ここがずれていたら、行と合計のどちらかがおかしいと画面で分かる。
    html += '<div class="list-total">合計 ' + rows.length + " 人 ／ " +
      total.toLocaleString("ja-JP") + " 円</div>";
    body.innerHTML = html;
  }

  function openTodayList() {
    var ov = document.getElementById("list-overlay");
    var body = document.getElementById("list-body");
    if (!ov || !body) return;
    ov.hidden = false;
    if (todayDisabled) {
      // 受け口が古いと分かっている間は叩かない（拒否ログを増やさない）
      body.innerHTML = '<div class="list-msg">' + esc(todayDisabledNote) + "</div>";
      return;
    }
    body.textContent = "読み込み中…";
    SUBMIT.fetchTodayList().then(renderTodayList).catch(function () { renderTodayList(null); });
  }

  function closeTodayList() {
    var ov = document.getElementById("list-overlay");
    if (ov) ov.hidden = true;
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
    // ★送信の完了を待ってから画面1へ戻す。待たずに戻すと、上部の帯が
    //   「1件前」の数字を取りに行き、押した直後だけ数が合わないように見える。
    var sent = SUBMIT.submitRecord(record).catch(function () { /* 画面は止めない */ });
    SUBMIT.retryPending(); // ついでに未送信キューの再送も試みる

    var waited = new Promise(function (r) { setTimeout(r, FLAGS.AUTO_RETURN_MS); });
    Promise.all([sent, waited]).then(function () {
      confirmBtn.disabled = false;
      goScreen1();
    });
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

  // 本日の一覧（開く／閉じる）
  document.getElementById("btn-today-list").addEventListener("click", openTodayList);
  document.getElementById("btn-list-close").addEventListener("click", closeTodayList);
  // ★暗い部分を押しても閉じる（バツを探せない時の逃げ道）。中身を押した時は閉じない。
  document.getElementById("list-overlay").addEventListener("click", function (e) {
    if (e.target === this) closeTodayList();
  });

  // 起動時に未送信キューがあれば再送を試みる（Wi-Fi復帰後などを想定）
  SUBMIT.retryPending();

  goScreen1();
})();

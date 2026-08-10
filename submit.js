/*
 * RISE南関町 来店記録タブレット — 送信部（送信先はダミー定数のまま）
 *
 * ★禁止事項遵守: ここから実際の外部送信は行わない。SUBMIT_URL は未デプロイの
 *   プレースホルダであり、fetch は実運用時に権限保持者が正しいURLへ差し替えるまで
 *   動作確認以外の目的で呼び出さないこと。
 *
 * 実装するのは「送信失敗時の再送のみ」（計画書 §通信の扱い）。
 * 本格的なオフライン同期は作らない。localStorage に未送信キューを1つ持ち、
 * 次の送信タイミング（次のお客様の確定時、またはページ読み込み時）にまとめて再試行する。
 */
(function (root) {
  // ★未デプロイ・プレースホルダ。".invalid" は RFC 2606 で「実在しないことが保証されたドメイン」
  //   として予約されているため、このURLに対する fetch は実サーバーへ到達せず必ず失敗する
  //   （＝禁止事項「外部への送信を伴う実行をしない」を実装レベルで担保する）。
  //   デプロイ時に権限保持者が GAS の実際の Web アプリURL（script.google.com/macros/s/xxx/exec）へ差し替える。
  var SUBMIT_URL = "https://SET-GAS-DEPLOYMENT-URL-HERE.invalid/exec";
  var QUEUE_KEY = "rise_visit_log_pending_queue_v1";
  var TOKEN_KEY = "rise_visit_log_token_v1";
  var DEVICE_KEY = "rise_visit_log_device_v1";

  /*
   * ── 端末の登録（トークン） ─────────────────────────────────────────
   * 店の端末で 1 回だけ次の形で開くと、端末内に保存され、以降は普通のURLで動く。
   *     https://<公開URL>/#t=<トークン>&d=<端末名>
   *
   * ★トークンの値は受け口（GAS）のスクリプトプロパティに司令が直接入力するもので、
   *   このリポジトリにも画面のソースにも書かない。大神も値を知らない。
   * ★読み取った直後にURLのハッシュを消す（画面に残さない／履歴に残さない）。
   */
  function readHashParams() {
    var out = {};
    try {
      var h = (root.location && root.location.hash) ? root.location.hash.replace(/^#/, "") : "";
      if (!h) return out;
      h.split("&").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
    } catch (e) { /* 解析に失敗しても画面は止めない */ }
    return out;
  }

  function registerFromHash() {
    var p = readHashParams();
    var changed = false;
    try {
      if (p.t && root.localStorage) { root.localStorage.setItem(TOKEN_KEY, p.t); changed = true; }
      if (p.d && root.localStorage) { root.localStorage.setItem(DEVICE_KEY, p.d); changed = true; }
    } catch (e) { /* 保存に失敗しても画面は止めない */ }
    if (changed) {
      // URLからトークンを消す（表示・履歴・共有からの漏れを防ぐ）
      try {
        if (root.history && root.history.replaceState) {
          root.history.replaceState(null, "", root.location.pathname + root.location.search);
        }
      } catch (e) { /* 消せなくても動作は継続 */ }
    }
    return changed;
  }

  function getToken() {
    try { return (root.localStorage && root.localStorage.getItem(TOKEN_KEY)) || ""; }
    catch (e) { return ""; }
  }

  function getDevice() {
    try {
      var d = root.localStorage && root.localStorage.getItem(DEVICE_KEY);
      if (d) return d;
    } catch (e) { /* fallthrough */ }
    // 登録時に端末名を渡していない場合の控えめな推定（識別用であって判定には使わない）
    try {
      var ua = (root.navigator && root.navigator.userAgent) || "";
      if (/iPad|Macintosh/i.test(ua) && "ontouchend" in (root.document || {})) return "ipad";
      if (/iPad/i.test(ua)) return "ipad";
      if (/Android/i.test(ua)) return "android";
    } catch (e) { /* fallthrough */ }
    return "unknown";
  }

  /**
   * 送信モード。既定は "test"（＝試験タブ行き）。
   * ★本番へ切り替える時だけ ui.flags.js の SUBMIT_MODE を "live" にする。
   *   既定を test にしてあるのは、設定し忘れた状態で本番タブを汚さないため。
   */
  function getMode() {
    try {
      var f = root.RISE_UI_FLAGS;
      if (f && f.SUBMIT_MODE === "live") return "live";
    } catch (e) { /* fallthrough */ }
    return "test";
  }

  function loadQueue() {
    try {
      var raw = root.localStorage ? root.localStorage.getItem(QUEUE_KEY) : null;
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveQueue(queue) {
    try {
      if (root.localStorage) root.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      /* 保存に失敗しても画面は止めない */
    }
  }

  function enqueue(record) {
    var queue = loadQueue();
    queue.push(record);
    saveQueue(queue);
  }

  function sendOne(record) {
    return fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res;
    });
  }

  /**
   * 1件送信する。失敗した場合はキューへ積んで後で再送する（例外は投げない＝画面は止めない）。
   */
  function submitRecord(record) {
    return sendOne(record)
      .catch(function () {
        enqueue(record);
      });
  }

  /**
   * 未送信キューの再送を試みる。呼び出しごとに全件試行し、成功したものだけキューから外す。
   */
  function retryPending() {
    var queue = loadQueue();
    if (queue.length === 0) return Promise.resolve({ attempted: 0, succeeded: 0 });
    var remaining = [];
    var succeeded = 0;
    var attempts = queue.map(function (record) {
      return sendOne(record)
        .then(function () {
          succeeded++;
        })
        .catch(function () {
          remaining.push(record);
        });
    });
    return Promise.all(attempts).then(function () {
      saveQueue(remaining);
      return { attempted: queue.length, succeeded: succeeded };
    });
  }

  /**
   * 端末のタイムゾーン設定に関係なく JST(+09:00) の ISO 8601 文字列を返す。
   * 記録要件「日時（ISO・JST）」に対応（計画書 §送信部）。
   */
  function toJstIsoString(date) {
    var jstMs = date.getTime() + 9 * 60 * 60 * 1000; // UTCミリ秒 + 9時間
    var jst = new Date(jstMs);
    var pad = function (n, len) {
      len = len || 2;
      var s = String(n);
      while (s.length < len) s = "0" + s;
      return s;
    };
    return (
      jst.getUTCFullYear() + "-" + pad(jst.getUTCMonth() + 1) + "-" + pad(jst.getUTCDate()) +
      "T" + pad(jst.getUTCHours()) + ":" + pad(jst.getUTCMinutes()) + ":" + pad(jst.getUTCSeconds()) +
      "." + pad(jst.getUTCMilliseconds(), 3) + "+09:00"
    );
  }

  /**
   * 1レコードに一意のIDを振る。
   * ★再送キューに積まれた後も同じIDのまま送り直されるため、受け口側は
   *   「同じ record_id が既にあればスキップ」で二重計上を防げる。
   *   ここで毎回振り直すと、通信が不安定な日に件数が水増しされる。
   */
  function newRecordId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === "function") {
        return root.crypto.randomUUID();
      }
    } catch (e) {
      /* 古い端末では下のフォールバックへ */
    }
    // フォールバック: 時刻 + 乱数。端末1台・1秒に1件未満の運用では十分に衝突しない。
    return "r-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 1e12).toString(36);
  }

  function buildRecord(state) {
    var now = new Date();
    return {
      record_id: newRecordId(), // ★受け口側の重複排除キー
      token: getToken(), // ★端末登録トークン。未登録なら空＝受け口が拒否する
      mode: getMode(), // "test"（既定・試験タブ）/ "live"（本番タブ）
      device: getDevice(), // 端末の識別名（判定には使わない・後から追う用）
      timestamp_iso: toJstIsoString(now), // JST固定（端末のタイムゾーン設定に非依存）
      visit_type: state.visitType, // "first" | "repeat"
      gender: state.gender, // "MEN" | "WOMAN"
      section: state.section, // "CUT" | "COLOR" | "PERMA"
      menu_id: state.item.id, // ★受け口側が料金表と突き合わせるキー
      menu_name: state.item.name,
      kari_applied: !!state.kariApplied, // 丸刈り選択の有無
      long_applied: !!state.longApplied, // ロング加算（旧「ロング増し」「パーマロング増し」相当）選択の有無
      long_add_price: state.longApplied ? (state.longAddPrice || 0) : 0, // ロング加算額（未選択時は0）
      price: state.price, // ★丸刈り・ロング加算を反映した最終金額
      is_minimum: !!state.isMinimum // 「〜」表記の下限値で記録した場合 true
    };
  }

  // ページ読み込み時に、ハッシュにトークンがあれば登録して即座にURLから消す
  try { registerFromHash(); } catch (e) { /* 画面は止めない */ }

  // ★既に開いている画面のURL末尾に #t=… を足しただけの場合、ページは再読み込みされず
  //   上の初期化は走らない。hashchange でも拾う（登録できずに全件拒否される事故を防ぐ）。
  try {
    if (root.addEventListener) {
      root.addEventListener("hashchange", function () {
        try { registerFromHash(); } catch (e) { /* 画面は止めない */ }
      });
    }
  } catch (e) { /* 画面は止めない */ }

  var RISE_SUBMIT = {
    SUBMIT_URL: SUBMIT_URL,
    registerFromHash: registerFromHash,
    getToken: getToken,
    getDevice: getDevice,
    getMode: getMode,
    submitRecord: submitRecord,
    retryPending: retryPending,
    buildRecord: buildRecord,
    toJstIsoString: toJstIsoString,
    _loadQueue: loadQueue // テスト用
  };

  if (typeof module === "object" && module.exports) {
    module.exports = RISE_SUBMIT;
  } else {
    root.RISE_SUBMIT = RISE_SUBMIT;
  }
})(typeof self !== "undefined" ? self : this);

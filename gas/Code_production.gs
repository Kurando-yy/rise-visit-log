/**
 * ライズ南関町 来店記録 受け口（Google Apps Script）
 * 作成: Maria(CSO) 2026-08-10
 *
 * 【この中にトークンは書きません】
 *   Apps Script の「プロジェクトの設定 → スクリプトプロパティ」に
 *   RISE_TOKEN という名前で値を入れてください（司令の操作）。
 *
 * 【列は名前で振り分けます】
 *   シートの1行目（見出し）を読んで対応づけるので、
 *   列を足しても順番を変えても、端末側は変更不要です。
 */

var SHEET_ID  = '1vMgPbBSpPNTXiYrBCAasQlBpJAP2mO26_bblbv5ueRg'; // ライズ南関町_来店記録明細
var PROP_NAME = 'RISE_TOKEN';
var TZ        = 'Asia/Tokyo';
var TAB_PRICE  = '料金表';
var TAB_REJECT = '拒否ログ';

/**
 * 端末から送られてくる項目名 → シートの見出し名
 * ★ 金額・丸刈り・ロング加算は端末の値を書きません。
 *    料金表から求めた値をサーバ側で入れます（改ざん防止）。
 */
var FIELD_MAP = {
  record_id:     'record_id',
  timestamp_iso: '端末送信日時',
  visit_type:    '来店回数',
  gender:        '性別',
  section:       '区分',
  menu_id:       'メニューid',
  menu_name:     'メニュー名',
  device:        '端末'
};

/**
 * 端末が送る英語の値 → 日本語表記
 * ★ 表記は既存タブ「来店記録02」の見出しに合わせています。
 *   （2026-08-10 に実シートのA1:K1を読んで確認：初めて / 2回目〜 / 男 / 女）
 *   一覧に無い値が来たら、変換せずそのまま書きます（取りこぼさないため）。
 */
var VALUE_MAP = {
  visit_type: { first: '初めて', repeat: '2回目〜' },
  gender:     { MEN: '男', WOMAN: '女' },
  section:    { CUT: 'カット', COLOR: 'カラー', PERMA: 'パーマ' }
};

function ja_(field, value) {
  var m = VALUE_MAP[field];
  if (!m) return value;
  var v = (value === null || value === undefined) ? '' : String(value);
  return (m[v] !== undefined) ? m[v] : value;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // 同時に届いても取りこぼさない
  } catch (err) {
    return reply(false, 'busy');
  }
  try {
    if (!e || !e.postData || !e.postData.contents) return reply(false, 'no_body');

    var body;
    try { body = JSON.parse(e.postData.contents); }
    catch (err) { return reply(false, 'bad_json'); }

    // --- ① トークン照合 ---
    var token = PropertiesService.getScriptProperties().getProperty(PROP_NAME);
    // ★トークン失敗も記録する。司令がトークンを変えて端末の再登録を忘れた場合、
    //   本物のお客様の記録がここで弾かれるため、気づけるようにしておく。
    //   ただし本文は残さない（トークンらしき文字列を書き込まないため）。
    if (!token)               return ng_('token_not_configured', '', body, null);
    if (body.token !== token) return ng_('bad_token', '', body, null);

    // --- ② 必須項目 ---
    // --- ①-b 記録ではなく「今日の状況を教えて」という問い合わせ（司令ご依頼 2026-08-16）---
    //   ★doGet ではなく doPost に相乗りさせる。理由は大神の指摘（2026-08-16）：
    //     ・doPost は本番で通っている唯一の経路（text/plain・プリフライト無し）
    //     ・トークンが本文に入るのでURLや履歴に残らない
    //     ・doGet は一度も通したことがない経路で、8/10に「届かない」を踏んでいる
    if (body.action === 'today') return todaySummary_();
    if (body.action === 'today_list') return todayList_();   // 当日の来店一覧（司令ご依頼 2026-08-16）

    if (!body.record_id) return ng_('no_record_id', '', body, e.postData.contents);
    if (!body.menu_id)   return ng_('no_menu_id', '', body, e.postData.contents);

    var ss = SpreadsheetApp.openById(SHEET_ID);
    // ★ 本番タブへ入るのは mode が 'live' のときだけ。
    //    未指定・打ち間違いは「試験」へ落とす（本番を汚さない側に倒す）。
    var tab = (body.mode === 'live') ? '本番' : '試験';
    var sh  = ss.getSheetByName(tab);
    if (!sh) return ng_('no_sheet:' + tab, tab, body, e.postData.contents);

    // --- ③ 金額をサーバ側の料金表と照合 ---
    var priceCheck = checkPrice_(ss, body);
    if (!priceCheck.ok) return ng_(priceCheck.reason, tab, body, e.postData.contents);

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // --- ④ record_id の重複はスキップ（通信が不安定な日の水増し防止）---
    var idCol = headers.indexOf('record_id') + 1;
    if (idCol < 1) return ng_('no_record_id_column', tab, body, e.postData.contents);
    var last = sh.getLastRow();
    if (last >= 2) {
      var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(body.record_id)) {
          return reply(true, 'duplicate_skipped'); // 端末には成功として返す（再送を止める）
        }
      }
    }

    // --- ⑤ 受信時刻はサーバで採番（端末の時計は信用しない）---
    var now  = new Date();
    var vals = {};
    vals['日付']           = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    vals['受信日時(サーバ)'] = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');
    for (var key in FIELD_MAP) {
      var raw = (body[key] === undefined) ? '' : body[key];
      vals[FIELD_MAP[key]] = ja_(key, raw);   // 日本語表記に直して書く
    }
    // ★ 金額まわりはサーバ側で確定した値を書く（端末の値は書かない）
    vals['金額']       = priceCheck.price;
    vals['丸刈り']     = priceCheck.kari ? '丸刈り' : '';
    vals['ロング加算'] = priceCheck.longAdd ? priceCheck.longAdd : '';

    // --- ⑥ 見出し名を見て列に振り分けて追記 ---
    var row = headers.map(function (h) {
      return (vals[h] === undefined) ? '' : vals[h];
    });
    sh.appendRow(row);

    return reply(true, 'ok');
  } catch (err) {
    return reply(false, 'error:' + err);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 料金表タブと突き合わせる
 *   列 = メニューid / メニュー名 / 金額 / 丸刈り金額 / ロング加算 / 備考
 * ★ 金額はすべてシートの値から組み立てます。端末が送ってきた
 *    long_add・price は計算に一切使いません（改ざん防止）。
 */
function checkPrice_(ss, body) {
  var ps = ss.getSheetByName(TAB_PRICE);
  if (!ps) return { ok: false, reason: 'no_price_sheet' };
  var last = ps.getLastRow();
  if (last < 2) return { ok: false, reason: 'price_table_empty' };

  var rows = ps.getRange(2, 1, last - 1, 6).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(body.menu_id)) continue;

    var base    = Number(rows[i][2]);
    var kari    = (rows[i][3] === '' || rows[i][3] === null) ? null : Number(rows[i][3]);
    var longAdd = (rows[i][4] === '' || rows[i][4] === null) ? null : Number(rows[i][4]);
    // 備考の「下限（〜表記）」は、いまは緩めません（隊長判断 2026-08-10）。
    // 端末は下限額しか送れないため、緩めると検査に穴が開くだけになります。
    // 金額の手入力を足す時（未確定#9）に、その仕様に合わせて見直します。
    var got = Number(body.price);
    if (isNaN(got) || isNaN(base)) return { ok: false, reason: 'price_not_number' };

    // 丸刈り：設定が無い品目に丸刈りが来たら弾く
    if (body.kari_applied && kari === null) {
      return { ok: false, reason: 'kari_not_available:' + body.menu_id };
    }
    // ロング加算：設定が無い品目にロングが来たら弾く
    if (body.long_applied && longAdd === null) {
      return { ok: false, reason: 'long_not_available:' + body.menu_id };
    }

    var expected = body.kari_applied ? kari : base;
    var addUsed  = body.long_applied ? longAdd : 0;
    expected += addUsed;

    if (got !== expected) {
      return { ok: false, reason: 'price_mismatch:expected' + expected + ',got' + got };
    }
    return { ok: true, price: got, kari: !!body.kari_applied, longAdd: addUsed };
  }
  return { ok: false, reason: 'unknown_menu_id:' + body.menu_id };
}

/**
 * 弾いた記録を「拒否ログ」タブに残す。
 * ★これが無いと、端末が応答を読めない作りの場合、
 *   弾かれた1件が誰にも気づかれずに消えます（お客様1人分の記録が失われる）。
 * ★トークンはログにも残しません。
 */
function logReject_(reason, tab, body, raw) {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_REJECT);
    if (!sh) return;
    var safe = '';
    if (raw !== null && raw !== undefined) {
      try {
        var o = JSON.parse(raw);
        delete o.token;                  // トークンは記録しない
        safe = JSON.stringify(o);
      } catch (e2) { safe = '(読めない本文)'; }
    }
    sh.appendRow([
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
      reason,
      tab || '',
      (body && body.record_id) ? body.record_id : '',
      String(safe).slice(0, 4000)
    ]);
  } catch (err) {
    // 記録に失敗しても、本処理は止めない
  }
}

/** 拒否ログに残してから、端末へ拒否を返す */
function ng_(reason, tab, body, raw) {
  logReject_(reason, tab, body, raw);
  return reply(false, reason);
}

function reply(ok, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 動作確認用。エディタ上部の関数名の欄で「selfTest」を選んで実行してください。
 * ★名前の末尾に _ を付けると「非公開」扱いになり、実行の一覧に出てきません。
 *   （2026-08-10 に私が _ 付きで出してしまい、司令が実行できませんでした）
 */
function selfTest() {
  var token = PropertiesService.getScriptProperties().getProperty(PROP_NAME);
  var cases = [
    // [説明, 送る中身, 期待]
    ['通常（カット1300）',
     { menu_id: 'men-cut-cut', menu_name: 'カット', price: 1300 }, '通る'],
    ['丸刈り（カットとシャンプー→1700）',
     { menu_id: 'men-cut-cutshampoo', menu_name: 'カットとシャンプー', price: 1700, kari_applied: true }, '通る'],
    ['丸刈りの設定が無い品目に丸刈り',
     { menu_id: 'men-cut-cut', menu_name: 'カット', price: 1700, kari_applied: true }, '弾く'],
    ['ロング加算（白髪染め4550+600）',
     { menu_id: 'woman-color-shiragazome', menu_name: '白髪染め', price: 5150, long_applied: true }, '通る'],
    ['端末が加算額を水増し（+99999）',
     { menu_id: 'woman-color-shiragazome', menu_name: '白髪染め', price: 104549, long_applied: true, long_add: 99999 }, '弾く'],
    ['下限品目も完全一致（パーマ6500→8000は弾く）',
     { menu_id: 'woman-perma-perma', menu_name: 'パーマ', price: 8000 }, '弾く'],
    ['知らないメニューid',
     { menu_id: 'nazo-menu', menu_name: '謎', price: 1000 }, '弾く']
  ];
  for (var i = 0; i < cases.length; i++) {
    var p = cases[i][1];
    p.token = token; p.mode = 'test';
    p.record_id = 'selftest-' + new Date().getTime() + '-' + i;
    p.timestamp_iso = '2026-08-10T12:00:00+09:00';
    p.visit_type = 'repeat'; p.gender = 'MEN'; p.section = 'CUT'; p.device = 'selftest';
    var res = doPost({ postData: { contents: JSON.stringify(p) } });
    Logger.log('[' + cases[i][2] + '] ' + cases[i][0] + ' → ' + res.getContent());
  }
}


/* ============================================================
   ここから下は 2026-08-10 追加分
   ・日次集計       毎晩23時（Google側で動くので、パソコンの電源に関係ありません）
   ・朝の確認       毎朝8時30分
   ・タップゼロ通知   1時間ごと（大神の仕様どおり）
   ★設定は「設定」タブの値を読みます。数字を変えるのにコードは触りません。
   ============================================================ */

var TAB_CONF = '設定';

/** 設定タブを { 項目: 値 } で読む */
function conf_() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_CONF);
  if (!sh) return {};
  var v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  var o = {};
  for (var i = 0; i < v.length; i++) {
    if (v[i][0]) o[String(v[i][0]).trim()] = String(v[i][1]).trim();
  }
  return o;
}

function hhmmToMin_(s) {
  var p = String(s).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

/** 日付データでも文字列でも 'yyyy-MM-dd' に揃える。
 *  ★2026-08-14: 明細の日付は「日付データ」なので String() すると
 *    'Tue Aug 11 2026 00:00:00 GMT+0900 (Japan Standard Time)' になり、
 *    ymd_() の '2026-08-11' と永遠に一致しなかった。
 *    その結果 ①同じ日が毎晩追記される ②見張り役の件数が常に0、が起きていた。
 *    型・タイムゾーンが何であっても同じキーになるので、原因が何であれ揃う。 */
function dkey_(v) {
  if (v === null || v === '') return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return String(v).trim();   // 日付として読めない時は元の文字列（fail-open）
}


/** 明細「本番」タブを、見出し名つきの配列で返す */
function readMain_() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('本番');
  var last = sh.getLastRow();
  if (last < 2) return { head: [], rows: [] };
  var all = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var head = all[0];
  var rows = [];
  for (var i = 1; i < all.length; i++) {
    var o = {};
    for (var j = 0; j < head.length; j++) o[head[j]] = all[i][j];
    rows.push(o);
  }
  return { head: head, rows: rows };
}

/** ===== 日次集計（毎晩23時）===== */
function dailyRollup() {
  var c = conf_();
  var ss2 = SpreadsheetApp.openById(c['集計先スプシID'] || SHEET_ID);
  var dst = ss2.getSheetByName(c['集計先タブ'] || '来店記録03_タブレット');
  if (!dst) { Logger.log('集計先タブが見つかりません'); return; }

  var data = readMain_().rows;
  if (!data.length) { Logger.log('本番タブが空です'); return; }

  var agg = {};
  for (var i = 0; i < data.length; i++) {
    var r = data[i], k = dkey_(r['日付']);
    if (!k) continue;
    if (!agg[k]) agg[k] = { n: 0, first: 0, rep: 0, m: 0, f: 0, yen: 0,
                            cut: 0, color: 0, perma: 0, kari: 0, lng: 0,
                            seen: {} };
    var g = agg[k];

    // ★2026-09-14: 「人」は ★行ではなく ★来店で数える（司令ご依頼の複数メニュー対応）。
    //   1人のお客様がカットとカラーを選ぶと ★明細は2行になる。
    //   行のまま数えると ★その人が2人として計上される（＝改修前にできなかった理由）。
    //   ★同じ来店の行には、画面が ★同じ visit_id を入れて送ってくる。
    //
    //   ★後方互換（★これが無いと過去の集計が全部ずれる）:
    //     visit_id が空の行＝★この改修より前の記録。★1行1人だったので、
    //     ★record_id を visit_id の代わりに使う（＝行ごとに別人のまま）。
    //   ★日付では切らない。端末のキャッシュが残ると、改修後でも古い形の行が数件届くため。
    var visit = String(r['visit_id'] || '').trim() || String(r['record_id'] || '') || ('row-' + i);
    var isNewVisit = !g.seen[visit];
    if (isNewVisit) {
      g.seen[visit] = true;
      g.n++;
      if (r['来店回数'] === '初めて') g.first++; else if (r['来店回数'] === '2回目〜') g.rep++;
      if (r['性別'] === '男') g.m++; else if (r['性別'] === '女') g.f++;
    }

    // ★以下は「メニューの数」「売上」なので ★行のまま数える（★変えない）。
    //   2行になっても、カット1・カラー1・売上は合算で ★正しい。
    g.yen += Number(r['金額'] || 0);
    if (r['区分'] === 'カット') g.cut++;
    else if (r['区分'] === 'カラー') g.color++;
    else if (r['区分'] === 'パーマ') g.perma++;
    if (String(r['丸刈り'] || '').trim()) g.kari++;
    if (Number(r['ロング加算'] || 0)) g.lng++;
  }

  var wd = ['日', '月', '火', '水', '木', '金', '土'];
  var last = dst.getLastRow();
  var have = {};
  if (last >= 2) {
    var ex = dst.getRange(2, 1, last - 1, 1).getValues();
    for (var x = 0; x < ex.length; x++) have[dkey_(ex[x][0])] = x + 2;
  }

  // ★2026-08-14 診断用：集計側のキーと既存行のキーを並べて出す。原因確定後に消してよい。
  Logger.log('have=' + JSON.stringify(Object.keys(have)) + ' / agg=' + JSON.stringify(Object.keys(agg)));
  var keys = Object.keys(agg).sort();
  for (var y = 0; y < keys.length; y++) {
    var ds = keys[y], g2 = agg[ds];
    var p = ds.split('-');
    var w = wd[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
    var row = [ds, w, g2.n, g2.first, g2.rep, g2.m, g2.f, g2.yen,
               g2.n ? Math.round(g2.yen / g2.n) : 0,
               g2.cut, g2.color, g2.perma, g2.kari, g2.lng];
    if (have[ds]) dst.getRange(have[ds], 1, 1, row.length).setValues([row]);
    else          dst.appendRow(row);
  }
  Logger.log('日次集計 完了: ' + keys.length + '日分');

  analyticsRollup();   // ★時間帯別・メニュー別（司令ご依頼 2026-08-15）
}

/** ===== 朝の確認（毎朝8時30分）===== */
function morningCheck() {
  dailyRollup();                                  // 念のため、先に集計をやり直す
  var c = conf_();
  var target = ymd_(new Date(new Date().getTime() - 24 * 60 * 60 * 1000));

  var n = 0, rows = readMain_().rows;
  for (var i = 0; i < rows.length; i++) if (dkey_(rows[i]['日付']) === target) n++;

  var dst = SpreadsheetApp.openById(c['集計先スプシID'] || SHEET_ID)
              .getSheetByName(c['集計先タブ'] || '来店記録03_タブレット');
  var found = false, last = dst.getLastRow();
  if (last >= 2) {
    var ex = dst.getRange(2, 1, last - 1, 1).getValues();
    for (var j = 0; j < ex.length; j++) if (dkey_(ex[j][0]) === target) found = true;
  }

  if (n > 0 && !found) {
    notify_('ライズ：' + target + ' の記録が ' + n + '件ありますが、集計されていません');
  }
  Logger.log('朝の確認 ' + target + ': 明細' + n + '件 / 集計' + (found ? 'あり' : 'なし'));
}

/** ===== タップゼロ通知（1時間ごと）===== */
/** 「入力が空きすぎているか」を1か所で判定する（2026-08-16）。
 *  ★通知（tapZeroCheck）と 画面の赤字（todaySummary_）が、同じこの関数を使う。
 *    別々に書くと、しきい値や営業時間の解釈が2つに割れる（今朝の「週の起点」と同じ話）。
 *  戻り：{ alert, n, yen, lastMin, sinceMin, closed, offHours, reason }
 *    alert=false の理由は reason に入れる（黙って false にしない）。 */
function tapState_(c, today, now) {
  var wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  var mnow = now.getHours() * 60 + now.getMinutes();
  var open = hhmmToMin_(c['営業開始'] || '9:00');
  var close = hhmmToMin_(c['最終受付'] || c['営業終了'] || '18:30');

  var rows = readMain_().rows, n = 0, yen = 0, lastMin = null, lastFull = '';
  for (var i = 0; i < rows.length; i++) {
    if (dkey_(rows[i]['日付']) !== today) continue;
    n++;
    yen += Number(rows[i]['金額'] || 0);
    var m = minOf_(rows[i]['受信日時(サーバ)']);
    if (!isNaN(m) && (lastMin === null || m > lastMin)) {
      lastMin = m;
      var v = rows[i]['受信日時(サーバ)'];
      lastFull = (v instanceof Date)
        ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : String(v);
    }
  }
  var sinceMin = (lastMin === null) ? (mnow - open) : (mnow - lastMin);

  var offDays = String(c['休業日'] || '').split(',').map(function (s) { return s.trim(); });
  var holiday = offDays.indexOf(today) >= 0;
  var regular = String(c['定休日'] || '').split(',').map(function (s) { return s.trim(); });
  var offHours = (mnow < open || mnow > close);

  var st = { n: n, yen: yen, lastMin: lastMin, lastFull: lastFull,
             sinceMin: (lastMin === null && offHours) ? null : Math.max(0, sinceMin),
             closed: holiday, offHours: offHours, alert: false, reason: '' };

  if (String(c['タップゼロ通知'] || 'ON').toUpperCase() !== 'ON') { st.reason = '通知OFF'; return st; }
  if (holiday)                          { st.reason = '休業日';           return st; }
  if (offHours)                         { st.reason = '営業時間外';        return st; }
  if (mnow - open < Number(c['猶予_分'] || 60)) { st.reason = '開店直後の猶予中'; return st; }
  if (regular.indexOf(wd) >= 0 && n === 0)     { st.reason = '定休日で0件';    return st; }
  if (sinceMin < Number(c['しきい値_分'] || 240)) { st.reason = 'まだ間が空いていない'; return st; }
  st.alert = true; st.reason = '空きすぎ';
  return st;
}

function tapZeroCheck() {
  var c = conf_();
  var now = new Date();
  var today = ymd_(now);
  var st = tapState_(c, today, now);            // ★判定は tapState_ に一本化
  if (!st.alert) return;

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('TAPZERO_LAST') === today) return;   // 本日通知済み

  var from = (st.lastMin === null) ? (c['営業開始'] || '8:30')
           : (('0' + Math.floor(st.lastMin / 60)).slice(-2) + ':' + ('0' + (st.lastMin % 60)).slice(-2));
  notify_('ライズ：本日 ' + from + ' から入力がありません（本日の記録 ' + st.n + '件）');
  props.setProperty('TAPZERO_LAST', today);
}

/** Discordへ通知（URLはスクリプトプロパティ NOTIFY_WEBHOOK に入れてください）*/
function notify_(text) {
  var url = PropertiesService.getScriptProperties().getProperty('NOTIFY_WEBHOOK');
  Logger.log('通知: ' + text);
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ content: text }), muteHttpExceptions: true });
  } catch (e) { Logger.log('通知に失敗: ' + e); }
}

/** ===== 時限トリガーの登録（1回だけ実行してください）===== */
function setupTriggers() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) ScriptApp.deleteTrigger(all[i]);   // 二重登録を防ぐ
  ScriptApp.newTrigger('dailyRollup').timeBased().atHour(23).everyDays(1).create();
  ScriptApp.newTrigger('morningCheck').timeBased().atHour(8).everyDays(1).create();
  ScriptApp.newTrigger('tapZeroCheck').timeBased().everyHours(1).create();
  Logger.log('トリガーを3つ登録しました（23時・8時台・1時間ごと）');
}


/* ============================================================
   時間帯別・メニュー別 集計（司令ご依頼 2026-08-15）
   ------------------------------------------------------------
   ・タブは2枚だけ。日/週/月は「粒度」列で持つ（直す場所を散らさない）
   ・トリガーは増やさない。dailyRollup の最後から呼ぶ
   ・追記しない。(粒度, 期間[, メニューid]) をキーに上書き
     ★8/14の重複事故と同じ轍を踏まないため、キーは必ず文字列に正規化する
   ・記録が0件の日は行を作らない（0人の行は「0人来た日」に見えてしまう）
   ・既存タブ（来店記録03_タブレット 等）には一切触れない

   ★決めごと（司令 2026-08-15）
     月次      月末締め
     週の始まり  ★火曜始まり（定休が月・木のため）。P/Lの週次タブ（日曜始まり）とは
                 区切りが違う。数字を並べて比べないこと
     メニュー別 客数と売上金額の両方
   ★時刻の意味（司令 2026-08-15 の一次情報）
     受信日時(サーバ) は「タブレットを押した時刻」。
     ★通常は来店時に押すが、混み合うと会計時に押すことがある＝混在している。
     したがって「来店時刻」とも「会計時刻」とも言い切らない。
     P/Lの「7月_来店時間帯分析」（紙から起こした旧集計）は来店時刻ベースなので、別物。
   ============================================================ */
var TAB_HOUR = '時間帯別集計';
var TAB_MENU = 'メニュー別集計';
var HOUR_FROM = 8, HOUR_TO = 20;          // 実測: 最早8時台・最遅17時台。営業8:30-20:00


/** 受信日時から「その日の何分目か」を取り出す（Date でも文字列でも可）。 */
function minOf_(v) {
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  var m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** 受信日時から「時」を取り出す。
 *  ★2026-08-15 の失敗：この列は文字列ではなく【日付データ】で、GASでは Date が返る。
 *    String(Date) は 'Tue Aug 11 2026 08:43:22 GMT+0900 (…)' になるので、
 *    ' ' で切って [1] を取ると 'Aug' になり、全部「時刻不明」に落ちていた。
 *    日付キーの dkey_ とまったく同じ穴を、同じ日にもう一度踏んだ。
 *    → 型を仮定せず、Date でも文字列でも取れる形にする。 */
function hourOf_(v) {
  if (v instanceof Date) return Number(Utilities.formatDate(v, TZ, 'H'));
  var m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) : NaN;
}

/** 'yyyy-MM-dd' → その日を含む週の起点日 'yyyy-MM-dd'
 *  ★起点の曜日は設定シートの『週の起点』から読む（既定=火）。
 *    2026-08-16：大神機の突合ジョブが別実装で同じ計算をするため、
 *    どちらもこの1か所を見るようにした。コードを2か所直す運用にしない。 */
function weekStart_(ds, startWd) {
  var WD = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
  var s = WD[String(startWd || '火').trim()];
  if (s === undefined) s = 2;
  var p = ds.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() - ((d.getDay() - s + 7) % 7));
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** シートが無ければ見出し付きで作る */
function ensureTab_(ss, name, header, note) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1).setValue(note);
    sh.getRange(2, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(2);
  }
  // ★2026-08-15：期間列(B)は必ず「書式なしテキスト」にする。
  //   '2026-08-11' や '2026-08' を普通に書くと Google が日付データへ自動変換し、
  //   次に読み戻した時に String() が 'Tue Aug 11 2026 …' になって突合が外れ、
  //   同じ期間の行が毎回追加される（実際に二重記録を出した）。
  sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

/** その期間が終わっているか。★終わっていない期間の合計を「確定値」と読ませないため。
 *  大神の指摘（2026-08-16）：週・月の途中経過が、確定値と同じ見た目になっていた。 */
function periodState_(grain, key) {
  var todayS = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var endS;
  if (grain === '日') {
    endS = key;
  } else if (grain === '週') {
    var p = key.split('-');
    var e = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    e.setDate(e.getDate() + 6);                 // 起点日 + 6日 = 週の終わり
    endS = Utilities.formatDate(e, TZ, 'yyyy-MM-dd');
  } else {                                       // 月
    var q = key.split('-');
    var e2 = new Date(Number(q[0]), Number(q[1]), 0);   // 当月末日
    endS = Utilities.formatDate(e2, TZ, 'yyyy-MM-dd');
  }
  return (endS < todayS) ? '確定' : '集計中';
}

/** 突合用のキー文字列。★万一セルが日付データになっていても揃うようにする（保険）。
 *  本命の対策は「期間列をテキスト書式に固定する」こと（ensureTab_ 参照）。 */
function keyStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).trim();
}

/** キー列で突き合わせて上書き、無ければ末尾に追加（★append しっぱなしにしない） */
function upsert_(sh, header, rows, keyCols) {
  var last = sh.getLastRow();
  var have = {};
  if (last >= 3) {
    var ex = sh.getRange(3, 1, last - 2, header.length).getValues();
    for (var i = 0; i < ex.length; i++) {
      var k = keyCols.map(function (c) { return keyStr_(ex[i][c]); }).join('|');
      have[k] = i + 3;
    }
  }
  var adds = [];
  for (var j = 0; j < rows.length; j++) {
    var key = keyCols.map(function (c) { return keyStr_(rows[j][c]); }).join('|');
    if (have[key]) sh.getRange(have[key], 1, 1, header.length).setValues([rows[j]]);
    else adds.push(rows[j]);
  }
  if (adds.length) {
    sh.getRange(Math.max(last, 2) + 1, 1, adds.length, header.length).setValues(adds);
  }
  return adds.length;
}

function analyticsRollup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var cfgA = conf_();
  // ★黙って既定値に落ちない（大神の突合ジョブと同じ作法・2026-08-16）。
  //   設定を読めていないのに一致して見える状態を作らないため、必ずログに残す。
  var startWd = cfgA['週の起点'];
  if (!startWd) {
    Logger.log('★設定シートの「週の起点」が読めません → 既定(火)で続行します');
    startWd = '火';
  } else {
    Logger.log('週の起点 = ' + startWd + '（設定シートから取得）');
  }
  var data = readMain_().rows;
  if (!data.length) { Logger.log('本番タブが空です'); return; }

  var wd = ['日', '月', '火', '水', '木', '金', '土'];
  var hourAgg = {};   // 粒度|期間 → {n, yen, h8..h18}
  var menuAgg = {};   // 粒度|期間|id → {name, n, yen}

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var ds = dkey_(r['日付']);
    if (!ds) continue;
    var periods = [['日', ds], ['週', weekStart_(ds, startWd)], ['月', ds.substring(0, 7)]];

    // 押した時刻の「時」。読めない行は「時刻不明」に寄せる（黙って捨てない）
    var hh = hourOf_(r['受信日時(サーバ)']);
    var yen = Number(r['金額'] || 0);
    var id = String(r['メニューid'] || '(不明)');
    var nm = String(r['メニュー名'] || '');
    // ★2026-09-14: 時間帯別の「客数」も ★来店で数える（dailyRollup と同じ規則）。
    //   ★後方互換も同じ: visit_id が空なら record_id を代わりに使う。
    var visitA = String(r['visit_id'] || '').trim() || String(r['record_id'] || '') || ('row-' + i);

    for (var p = 0; p < periods.length; p++) {
      var gk = periods[p][0] + '|' + periods[p][1];
      if (!hourAgg[gk]) {
        hourAgg[gk] = { g: periods[p][0], k: periods[p][1], n: 0, yen: 0, h: {}, other: 0,
                        seen: {} };
      }
      var a = hourAgg[gk];
      a.yen += yen;                       // ★売上は行のまま（合算で正しい）
      if (!a.seen[visitA]) {              // ★客数と時間帯は ★来店1回につき1つ
        a.seen[visitA] = true;
        a.n++;
        if (!isNaN(hh) && hh >= HOUR_FROM && hh <= HOUR_TO) a.h[hh] = (a.h[hh] || 0) + 1;
        else a.other++;
      }

      var mk = gk + '|' + id;
      if (!menuAgg[mk]) menuAgg[mk] = { g: periods[p][0], k: periods[p][1], id: id, nm: nm, n: 0, yen: 0 };
      menuAgg[mk].n++; menuAgg[mk].yen += yen;
    }
  }

  // ---- 時間帯別 ----
  var hHead = ['粒度', '期間', '曜日', '客数', '売上合計'];
  for (var h = HOUR_FROM; h <= HOUR_TO; h++) hHead.push(h + '時台');
  hHead.push('時刻不明');
  hHead.push('状態');   // ★確定 / 集計中
  var hNote = '★この時刻は【タブレットを押した時刻】です。通常は来店時に押しますが、'
            + '混み合うと会計時に押すことがあります（司令 2026-08-15）。厳密な来店時刻ではありません。'
            + ' 週は火曜始まり（定休が月・木のため）。P/Lの「7月_来店時間帯分析」は紙から起こした'
            + '来店時刻ベースなので、数字を並べて比べないこと。';
  var shH = ensureTab_(ss, TAB_HOUR, hHead, hNote);

  var hRows = [];
  Object.keys(hourAgg).sort().forEach(function (k) {
    var a = hourAgg[k];
    var w = '';
    if (a.g === '日') {
      var p2 = a.k.split('-');
      w = wd[new Date(Number(p2[0]), Number(p2[1]) - 1, Number(p2[2])).getDay()];
    }
    var row = [a.g, a.k, w, a.n, a.yen];
    for (var hh2 = HOUR_FROM; hh2 <= HOUR_TO; hh2++) row.push(a.h[hh2] || '');
    row.push(a.other || '');
    row.push(periodState_(a.g, a.k));
    hRows.push(row);
  });
  var addH = upsert_(shH, hHead, hRows, [0, 1]);

  // ---- メニュー別 ----
  var mHead = ['粒度', '期間', 'メニューid', 'メニュー名', '客数', '売上', '状態'];
  var mNote = '★メニュー名は男女で重複します（「カット」等5組）。集計キーは メニューid です。'
            + ' 状態=集計中 の行は期間の途中です（確定値ではありません）。'
            + ' 週は火曜始まり。金額は明細の実額をそのまま合計しています。';
  var shM = ensureTab_(ss, TAB_MENU, mHead, mNote);
  var mRows = [];
  Object.keys(menuAgg).sort().forEach(function (k) {
    var a = menuAgg[k];
    mRows.push([a.g, a.k, a.id, a.nm, a.n, a.yen, periodState_(a.g, a.k)]);
  });
  var addM = upsert_(shM, mHead, mRows, [0, 1, 2]);

  Logger.log('時間帯別 ' + hRows.length + '行（新規' + addH + '） / メニュー別 '
             + mRows.length + '行（新規' + addM + '）');
}


/** 画面上部に出す「今日の状況」を返す（doPost の action:"today"）。
 *  ★数えるのはここ1か所だけ。端末側で数え直さない（数え方が2つに割れるため）。
 *  返す形：
 *    { ok:true, date:'2026-08-16', closed:false, count:7, amount:9850,
 *      last:'11:42', last_full:'2026-08-16 11:42:03' }
 *    closed=true のときは休業日。count/amount は 0 を返す。 */
function todaySummary_() {
  var c = conf_();
  var now = new Date();
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var st = tapState_(c, today, now);            // ★通知と同じ判定を使う（2か所に書かない）

  var last = (st.lastMin === null) ? ''
    : ('0' + Math.floor(st.lastMin / 60)).slice(-2) + ':' + ('0' + (st.lastMin % 60)).slice(-2);

  return ContentService.createTextOutput(JSON.stringify({
    ok: true, date: today, closed: st.closed,
    count: st.n, amount: st.yen, last: last, last_full: st.lastFull,
    since_min: st.sinceMin,          // 開店前・休業日は null
    alert: st.alert,                 // ★赤字にするかはサーバが決める
    alert_reason: st.reason,         // 出さない理由も返す（黙ってfalseにしない）
    note: 'この数字はタブレットに入力された分です。レジの合計とは別物です。'
  })).setMimeType(ContentService.MimeType.JSON);
}


/** 当日の来店一覧を返す（doPost の action:"today_list"）。司令ご依頼 2026-08-16。
 *  ★帯(today)と別の口にした理由：帯は画面1に戻るたび呼ばれる。一覧まで毎回付けると
 *    要らない時にも通信量が増える。ボタンを押した時だけ取る。
 *  ★キー名・型は大神の画面側の契約に合わせている（time / visit / gender / menu / price）。
 *    勝手に変えないこと。変える時は先に一報する。
 *  ★time は HH:MM の文字列でサーバが整形して返す。
 *    画面側で時刻を解釈させない（今日「0埋めが消えて 9:37 が 11:29 より後と判定される」を踏んだため）。
 *  並びは入力の古い順（レジのレシート順と揃う）。休業日は rows を空で返す。 */
function todayList_() {
  var c = conf_();
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var offDays = String(c['休業日'] || '').split(',').map(function (s) { return s.trim(); });
  var closed = offDays.indexOf(today) >= 0;

  var rows = readMain_().rows;
  var out = [], total = 0;
  if (!closed) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (dkey_(r['日付']) !== today) continue;        // ★型を仮定しない
      var m = minOf_(r['受信日時(サーバ)']);            // ★数値で扱う（文字列比較にしない）
      var yen = Number(r['金額'] || 0);
      total += yen;
      // 金額が料金表と違って見える理由（丸刈り・ロング）を行に添える。
      // 無いと「なぜ1700円なのか」を後から誰も説明できない。画面側は無視して構わない。
      var note = [];
      if (String(r['丸刈り'] || '').trim()) note.push('丸刈り');
      if (Number(r['ロング加算'] || 0))      note.push('ロング');
      out.push({
        _k: isNaN(m) ? 9999 : m,
        time: isNaN(m) ? '' : ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2),
        visit: String(r['来店回数'] || ''),
        gender: String(r['性別'] || ''),
        menu: String(r['メニュー名'] || ''),
        price: yen,
        note: note.join('・')
      });
    }
    out.sort(function (a, b) { return a._k - b._k; });   // 古い順＝レシート順
    for (var j = 0; j < out.length; j++) delete out[j]._k;
  }

  return ContentService.createTextOutput(JSON.stringify({
    ok: true, date: today, closed: closed,
    count: out.length, amount: total, rows: out,
    note: 'この一覧はタブレットに入力された分です。レジの控えとは別物です。'
  })).setMimeType(ContentService.MimeType.JSON);
}

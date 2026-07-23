/**
 * 職員連絡ボード — GAS ウェブアプリ バックエンド
 *
 * データベースは同じスプレッドシートの4シート:
 *   連絡事項 / 職員マスタ / 確認ログ / 会議
 *
 * 初回セットアップ:
 *   1. setup()          … 4シートとサンプルデータを生成
 *   2. 職員マスタに実際の職員を入力
 *   3. デプロイ（実行=アクセスユーザー / アクセス=組織内全員）
 *   4. installTriggers()… 毎朝の督促メールを有効化
 */

// ============================================================
// 定数
// ============================================================
var SHEET_ITEMS    = '連絡事項';
var SHEET_STAFF    = '職員マスタ';
var SHEET_LOG      = '確認ログ';
var SHEET_MEETINGS = '会議';

// 各シートのヘッダー（列順の唯一の定義。以降はここを参照）
var HEADERS = {
  items: ['ID', '会議ID', '種別', 'No', '議題', '内容', '発言者', '時間', '資料', '資料リンク',
          '期限', '要対応', '対象区分', '対象メール', '掲載', '作成日時'],
  staff: ['氏名', 'メール', '分掌', '表示順', '在職'],
  log:   ['連絡ID', 'メール', '氏名', '状態', '更新日時'],
  meetings: ['会議ID', '日付', '種別', '名称']
};

var TZ = Session.getScriptTimeZone() || 'Asia/Tokyo';

// ============================================================
// ウェブアプリのエントリポイント
// ============================================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('職員連絡ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Index.html から他のHTMLファイルを差し込むためのヘルパー */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// 低レベルなシート操作
// ============================================================
function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません: ' + name + '（先に setup() を実行してください）');
  return sh;
}

/** シートを {header:index} の連想配列と全データ行に変換して読む */
function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var header = values.shift() || [];
  var col = {};
  header.forEach(function (h, i) { col[h] = i; });
  return { sheet: sh, col: col, rows: values, header: header };
}

function uuid_() {
  return Utilities.getUuid();
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// ============================================================
// ユーザー識別
// ============================================================
/** ログイン中のメール（学校アカウント）。取得できなければ空文字 */
function currentEmail_() {
  var email = Session.getActiveUser().getEmail();
  return email || '';
}

/** 職員マスタからログインユーザーの情報を引く。未登録なら仮の氏名を返す */
function currentStaff_() {
  var email = currentEmail_();
  var t = readTable_(SHEET_STAFF);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][t.col['メール']]).toLowerCase() === email.toLowerCase()) {
      return {
        email: email,
        name: t.rows[i][t.col['氏名']],
        role: t.rows[i][t.col['分掌']],
        registered: true
      };
    }
  }
  return { email: email, name: email ? email.split('@')[0] : 'ゲスト', role: '', registered: false };
}

// ============================================================
// マスタ・集計の取得
// ============================================================
/** 在職中の職員一覧（表示順ソート） */
function activeStaff_() {
  var t = readTable_(SHEET_STAFF);
  var list = t.rows
    .filter(function (r) { return r[t.col['在職']] === true || String(r[t.col['在職']]).toUpperCase() === 'TRUE'; })
    .map(function (r) {
      return {
        name: r[t.col['氏名']],
        email: String(r[t.col['メール']]).toLowerCase(),
        role: String(r[t.col['分掌']] || ''),
        order: Number(r[t.col['表示順']]) || 999
      };
    });
  list.sort(function (a, b) { return a.order - b.order; });
  return list;
}

/** ある連絡の対象となる職員（メール小文字）の配列を返す */
function targetsFor_(item, staff) {
  if (item.targetType === '個別') {
    var set = String(item.targetEmails || '')
      .split(/[,\s]+/).map(function (s) { return s.toLowerCase(); }).filter(String);
    return staff.filter(function (s) { return set.indexOf(s.email) >= 0; });
  }
  if (item.targetType === '担任') {
    return staff.filter(function (s) { return s.role.indexOf('担任') >= 0; });
  }
  return staff.slice(); // 全員
}

/** 確認ログを {連絡ID: {email: 状態}} のマップに畳み込む */
function logMap_() {
  var t = readTable_(SHEET_LOG);
  var map = {};
  t.rows.forEach(function (r) {
    var id = r[t.col['連絡ID']];
    var email = String(r[t.col['メール']]).toLowerCase();
    if (!map[id]) map[id] = {};
    map[id][email] = r[t.col['状態']]; // 済 / 取消（後勝ち＝最新行が優先されるよう順に上書き）
  });
  return map;
}

/** 生の連絡事項行を扱いやすいオブジェクトに変換 */
function toItem_(row, col) {
  return {
    id: row[col['ID']],
    meetingId: row[col['会議ID']],
    kind: row[col['種別']],
    no: row[col['No']],
    title: row[col['議題']],
    body: row[col['内容']],
    speaker: row[col['発言者']],
    minutes: row[col['時間']],
    material: row[col['資料']],
    link: row[col['資料リンク']],
    due: formatDate_(row[col['期限']]),
    dueRaw: row[col['期限']],
    action: row[col['要対応']] === true || String(row[col['要対応']]).toUpperCase() === 'TRUE',
    targetType: row[col['対象区分']] || '全員',
    targetEmails: row[col['対象メール']] || '',
    posted: row[col['掲載']] === true || String(row[col['掲載']]).toUpperCase() === 'TRUE'
  };
}

function formatDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'M/d');
  }
  return String(v);
}

// ============================================================
// フロントから呼ばれるAPI
// ============================================================
/**
 * 画面初期化用データを一括で返す。
 * { me, today, meetings, items:[{…, doneCount, targetCount, myDone, uncheckedNames}] }
 */
function getInitialData() {
  var me = currentStaff_();
  var staff = activeStaff_();
  var logs = logMap_();
  var meetings = readMeetings_();
  var meetingName = {};
  meetings.forEach(function (m) { meetingName[m.id] = m.label; });

  var t = readTable_(SHEET_ITEMS);
  var items = t.rows
    .map(function (r) { return toItem_(r, t.col); })
    .filter(function (it) { return it.posted; }) // ボードは掲載中のみ
    .map(function (it) { return decorateItem_(it, staff, logs, me, meetingName); });

  // 期限が近い順（期限なしは後ろ）→ 未対応を上に
  items.sort(function (a, b) {
    if (a.action !== b.action) return a.action ? -1 : 1;
    var da = a.dueSort, db = b.dueSort;
    if (da === db) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  return {
    me: me,
    today: Utilities.formatDate(new Date(), TZ, 'M月d日'),
    staffCount: staff.length,
    meetings: meetings,
    items: items
  };
}

/** 1件の連絡に集計（進捗・自分のチェック・未対応者名）を付与 */
function decorateItem_(it, staff, logs, me, meetingName) {
  var targets = targetsFor_(it, staff);
  var itemLog = logs[it.id] || {};
  var doneEmails = {};
  Object.keys(itemLog).forEach(function (e) { if (itemLog[e] === '済') doneEmails[e] = true; });

  var doneCount = 0;
  var unchecked = [];
  targets.forEach(function (s) {
    if (doneEmails[s.email]) doneCount++;
    else unchecked.push(s.name);
  });

  var due = it.dueRaw;
  var dueSort = null, dueClass = '';
  if (due) {
    var d = (Object.prototype.toString.call(due) === '[object Date]') ? due : new Date(due);
    if (!isNaN(d.getTime())) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var diff = Math.round((d.getTime() - today.getTime()) / 86400000);
      dueSort = diff;
      dueClass = diff <= 0 ? 'today' : (diff <= 2 ? 'near' : 'far');
      it.dueLabel = it.due + (diff === 0 ? ' 今日' : diff > 0 ? ' あと' + diff + '日' : ' 超過');
    }
  }

  return {
    id: it.id, kind: it.kind, meetingLabel: meetingName[it.meetingId] || it.meetingId,
    title: it.title, body: it.body, speaker: it.speaker, link: it.link,
    action: it.action, targetType: it.targetType,
    due: it.due, dueLabel: it.dueLabel || '', dueClass: dueClass, dueSort: dueSort,
    doneCount: doneCount, targetCount: targets.length,
    myDone: !!doneEmails[me.email.toLowerCase()],
    myTarget: targets.some(function (s) { return s.email === me.email.toLowerCase(); }),
    uncheckedNames: unchecked
  };
}

/**
 * 確認・対応済みの記録／取消。(連絡ID×職員)で1行、状態列を更新。
 * @return {Object} 更新後の { doneCount, targetCount }
 */
function recordCheck(itemId, done) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var me = currentStaff_();
    if (!me.email) throw new Error('ログイン情報を取得できませんでした。');
    var state = done ? '済' : '取消';
    var t = readTable_(SHEET_LOG);
    var found = -1;
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i][t.col['連絡ID']] === itemId &&
          String(t.rows[i][t.col['メール']]).toLowerCase() === me.email.toLowerCase()) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      var rowNum = found + 2; // ヘッダー分＋1
      t.sheet.getRange(rowNum, t.col['状態'] + 1).setValue(state);
      t.sheet.getRange(rowNum, t.col['更新日時'] + 1).setValue(nowStr_());
    } else {
      t.sheet.appendRow([itemId, me.email, me.name, state, nowStr_()]);
    }
    return recount_(itemId);
  } finally {
    lock.releaseLock();
  }
}

/** 1件の連絡の進捗を再計算して返す */
function recount_(itemId) {
  var staff = activeStaff_();
  var t = readTable_(SHEET_ITEMS);
  var item = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i][t.col['ID']] === itemId) { item = toItem_(t.rows[i], t.col); break; }
  }
  if (!item) return { doneCount: 0, targetCount: 0, uncheckedNames: [] };
  var logs = logMap_();
  var me = currentStaff_();
  var dec = decorateItem_(item, staff, logs, me, {});
  return { doneCount: dec.doneCount, targetCount: dec.targetCount, uncheckedNames: dec.uncheckedNames };
}

/**
 * 起票フォームからの新規追加（協議事項／連絡事項）。
 * @param {Object} p { meetingId, kind, title, body, speaker, minutes, material, link,
 *                      due, action, targetType, targetEmails, posted }
 */
function submitItem(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!p.title) throw new Error('議題を入力してください。');
    var me = currentStaff_();
    var t = readTable_(SHEET_ITEMS);
    // 同じ会議・同じ種別内での通し番号
    var no = 0;
    t.rows.forEach(function (r) {
      if (r[t.col['会議ID']] === p.meetingId && r[t.col['種別']] === p.kind) no++;
    });
    var row = [];
    row[t.col['ID']] = uuid_();
    row[t.col['会議ID']] = p.meetingId || '';
    row[t.col['種別']] = p.kind || '連絡';
    row[t.col['No']] = no + 1;
    row[t.col['議題']] = p.title;
    row[t.col['内容']] = p.body || '';
    row[t.col['発言者']] = p.speaker || me.name;
    row[t.col['時間']] = p.minutes || '';
    row[t.col['資料']] = p.material || 'なし';
    row[t.col['資料リンク']] = p.link || '';
    row[t.col['期限']] = p.due || '';
    row[t.col['要対応']] = !!p.action;
    row[t.col['対象区分']] = p.targetType || '全員';
    row[t.col['対象メール']] = p.targetEmails || '';
    row[t.col['掲載']] = p.posted !== false; // 既定は掲載ON
    row[t.col['作成日時']] = nowStr_();
    t.sheet.appendRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 指定会議の協議事項・連絡事項（アジェンダ表示用） */
function getMeetingAgenda(meetingId) {
  var t = readTable_(SHEET_ITEMS);
  var giron = [], renraku = [], total = 0;
  t.rows.forEach(function (r) {
    var it = toItem_(r, t.col);
    if (it.meetingId !== meetingId) return;
    var m = Number(it.minutes) || 0;
    total += m;
    (it.kind === '協議' ? giron : renraku).push(it);
  });
  var byNo = function (a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0); };
  giron.sort(byNo); renraku.sort(byNo);
  return { giron: giron, renraku: renraku, totalMinutes: total };
}

/** 未対応者の氏名一覧（全職員が閲覧可） */
function getUncheckedNames(itemId) {
  return recount_(itemId).uncheckedNames;
}

// ============================================================
// 督促メール（毎朝の時間トリガー）
// ============================================================
/**
 * 期限が過ぎている「要対応」の連絡について、未対応者へメールを送る。
 * 1人につき1通にまとめる。
 */
function sendReminders() {
  var staff = activeStaff_();
  var staffByEmail = {};
  staff.forEach(function (s) { staffByEmail[s.email] = s; });
  var logs = logMap_();
  var meetings = readMeetings_();
  var meetingName = {};
  meetings.forEach(function (m) { meetingName[m.id] = m.label; });

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var t = readTable_(SHEET_ITEMS);
  var perStaff = {}; // email -> [ {title, due} ]

  t.rows.forEach(function (r) {
    var it = toItem_(r, t.col);
    if (!it.posted || !it.action || !it.dueRaw) return;
    var d = (Object.prototype.toString.call(it.dueRaw) === '[object Date]') ? it.dueRaw : new Date(it.dueRaw);
    if (isNaN(d.getTime()) || d.getTime() >= today.getTime() + 86400000) return; // 期限翌日以降は対象外＝期限当日〜超過のみ
    var targets = targetsFor_(it, staff);
    var itemLog = logs[it.id] || {};
    targets.forEach(function (s) {
      if (itemLog[s.email] === '済') return; // 済みは除外
      if (!perStaff[s.email]) perStaff[s.email] = [];
      perStaff[s.email].push({ title: it.title, due: formatDate_(it.dueRaw) });
    });
  });

  var appUrl = ScriptApp.getService().getUrl();
  Object.keys(perStaff).forEach(function (email) {
    var list = perStaff[email];
    if (!list.length) return;
    var name = (staffByEmail[email] || {}).name || '';
    var lines = list.map(function (x) { return '・' + x.title + '（期限 ' + x.due + '）'; }).join('\n');
    var body = name + ' 先生\n\n'
      + '対応期限を過ぎている連絡事項が ' + list.length + ' 件あります。\n\n'
      + lines + '\n\n'
      + '▼連絡ボードで確認・対応する\n' + appUrl + '\n\n'
      + '※このメールは連絡ボードから自動送信されています。';
    MailApp.sendEmail(email, '【連絡ボード】未対応の連絡が ' + list.length + ' 件あります', body);
  });
}

/** 毎朝7:30に督促メールを送るトリガーを登録（重複登録を防ぐ） */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().atHour(7).nearMinute(30).everyDays(1).create();
}

// ============================================================
// 会議一覧
// ============================================================
function readMeetings_() {
  var t = readTable_(SHEET_MEETINGS);
  var list = t.rows.map(function (r) {
    var date = r[t.col['日付']];
    return {
      id: r[t.col['会議ID']],
      date: date,
      dateLabel: formatDate_(date),
      kind: r[t.col['種別']],
      label: r[t.col['名称']] || (formatDate_(date) + ' ' + r[t.col['種別']])
    };
  });
  // 新しい会議を上に
  list.sort(function (a, b) {
    var da = a.date ? new Date(a.date).getTime() : 0;
    var db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  return list;
}

// ============================================================
// セットアップ（初回のみ手動実行）
// ============================================================
function setup() {
  var ss = ss_();
  ensureSheet_(ss, SHEET_ITEMS, HEADERS.items);
  ensureSheet_(ss, SHEET_STAFF, HEADERS.staff);
  ensureSheet_(ss, SHEET_LOG, HEADERS.log);
  ensureSheet_(ss, SHEET_MEETINGS, HEADERS.meetings);
  seedSample_();
  SpreadsheetApp.getActiveSpreadsheet().toast('セットアップ完了。職員マスタに実際の職員を入力してください。', '連絡ボード', 8);
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 動作確認用のサンプルデータ（既にデータがあれば何もしない） */
function seedSample_() {
  var staffSh = sheet_(SHEET_STAFF);
  if (staffSh.getLastRow() <= 1) {
    var me = currentEmail_() || 'you@example.com';
    staffSh.getRange(2, 1, 3, HEADERS.staff.length).setValues([
      ['西村', me, '担任・教務', 1, true],
      ['横田', 'yokota@example.com', '情報', 2, true],
      ['清水', 'shimizu@example.com', '担任', 3, true]
    ]);
  }
  var meetSh = sheet_(SHEET_MEETINGS);
  if (meetSh.getLastRow() <= 1) {
    meetSh.getRange(2, 1, 1, HEADERS.meetings.length).setValues([
      ['M20260717', '2026-07-17', '職員会議', '7/17（木）職員会議']
    ]);
  }
  var itemSh = sheet_(SHEET_ITEMS);
  if (itemSh.getLastRow() <= 1) {
    var rows = [
      [uuid_(), 'M20260717', '連絡', 1, '端末の管理番号について',
       'スズキ校務の詳細名簿に入力をお願いします。', '横田', 1, 'あり（データ）', '',
       '2026-07-24', true, '全員', '', true, nowStr_()],
      [uuid_(), 'M20260717', '連絡', 2, '夏休み宿題　習字・作文の集め方',
       'JAの習字は8月26日まで、作文は9月1日まで。', '清水', '', 'あり（データ）', '',
       '2026-08-26', true, '全員', '', true, nowStr_()],
      [uuid_(), 'M20260717', '連絡', 3, 'ご紹介：人権啓発セミナー受講者募集',
       '受講希望の方は相座までご連絡ください。', '相座', '', 'あり（データ）', '',
       '', false, '全員', '', true, nowStr_()],
      [uuid_(), 'M20260717', '協議', 1, '音楽会実施計画案（略案）',
       'プログラム順など変更。体育館練習を2時間削減。', '西村', 5, 'あり（データ）', '',
       '', false, '全員', '', false, nowStr_()]
    ];
    itemSh.getRange(2, 1, rows.length, HEADERS.items.length).setValues(rows);
  }
}

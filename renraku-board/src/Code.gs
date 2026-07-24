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
var SHEET_COMMENTS = 'コメント';

// 各シートのヘッダー（列順の唯一の定義。以降はここを参照）
var HEADERS = {
  items: ['ID', '会議ID', '種別', 'No', '議題', '内容', '発言者', '時間', '資料', '資料リンク',
          '期限', '要対応', '対象区分', '対象メール', '掲載', '作成日時', '作成者メール'],
  staff: ['氏名', 'メール', '分掌', '表示順', '在職', '最終ログイン'],
  log:   ['連絡ID', 'メール', '氏名', '状態', '更新日時', 'チェック種別'],
  meetings: ['会議ID', '日付', '種別', '名称'],
  comments: ['連絡ID', 'メール', '氏名', '本文', '投稿日時']
};

var TZ = Session.getScriptTimeZone() || 'Asia/Tokyo';

// 年度リセットの実行日。3/31の勤務が終わった直後の 4/1 早朝に職員マスタを
// アーカイブして空にする（新年度は全員が開いて再登録）。
var RESET_MONTH = 4;
var RESET_DAY = 1;

// これ以上ログインが無い職員は集計の対象外にする（自動で名簿から実質除外）。
var INACTIVE_DAYS = 30;

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

/** 読み込み済みの職員マスタから該当メールの行番号（0始まり）を返す。無ければ -1 */
function findStaffRow_(t, email) {
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][t.col['メール']]).toLowerCase() === String(email).toLowerCase()) return i;
  }
  return -1;
}

/** 読み込み済みの職員マスタからログインユーザーの情報を組み立てる */
function staffFromTable_(t, email) {
  var i = findStaffRow_(t, email);
  if (i >= 0) {
    return {
      email: email,
      name: t.rows[i][t.col['氏名']],
      role: t.rows[i][t.col['分掌']],
      registered: true
    };
  }
  return { email: email, name: email ? email.split('@')[0] : 'ゲスト', role: '', registered: false };
}

/** 職員マスタからログインユーザーの情報を引く。未登録なら仮の氏名を返す */
function currentStaff_() {
  return staffFromTable_(readTable_(SHEET_STAFF), currentEmail_());
}

/**
 * 初回アクセス時の自己登録。フロントの名前登録画面から呼ばれる。
 * 既に同じメールがあれば氏名・分掌・最終ログインを更新する。
 * @param {string} name 氏名
 * @param {boolean} isHomeroom 学級担任かどうか（対象「担任」の判定に使う）
 */
function registerMe(name, isHomeroom) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var email = currentEmail_();
    if (!email) throw new Error('ログイン情報を取得できませんでした。学校のアカウントでアクセスしてください。');
    name = String(name || '').trim();
    if (!name) throw new Error('お名前を入力してください。');
    var t = readTable_(SHEET_STAFF);
    for (var i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i][t.col['メール']]).toLowerCase() === email.toLowerCase()) {
        var rn = i + 2;
        t.sheet.getRange(rn, t.col['氏名'] + 1).setValue(name);
        t.sheet.getRange(rn, t.col['分掌'] + 1).setValue(isHomeroom ? '担任' : '');
        t.sheet.getRange(rn, t.col['在職'] + 1).setValue(true);
        t.sheet.getRange(rn, t.col['最終ログイン'] + 1).setValue(nowStr_());
        return { ok: true };
      }
    }
    var row = [];
    row[t.col['氏名']] = name;
    row[t.col['メール']] = email;
    row[t.col['分掌']] = isHomeroom ? '担任' : '';
    row[t.col['表示順']] = t.rows.length + 1;
    row[t.col['在職']] = true;
    row[t.col['最終ログイン']] = nowStr_();
    t.sheet.appendRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// マスタ・集計の取得
// ============================================================
/**
 * 集計対象の職員一覧（表示順ソート）。
 * 条件: 在職=TRUE かつ「最終ログインが INACTIVE_DAYS 日以内」。
 * 最終ログインが空欄（手動追加でまだ未ログイン等）の職員は除外しない。
 */
function activeStaff_() {
  return activeStaffFrom_(readTable_(SHEET_STAFF));
}

/** activeStaff_ の本体（読み込み済みテーブルを受け取る版。再読込を避ける） */
function activeStaffFrom_(t) {
  var cutoff = new Date().getTime() - INACTIVE_DAYS * 86400000;
  var list = t.rows
    .filter(function (r) {
      var zaiseki = r[t.col['在職']] === true || String(r[t.col['在職']]).toUpperCase() === 'TRUE';
      if (!zaiseki) return false;
      var ll = r[t.col['最終ログイン']];
      if (ll) {
        var d = (Object.prototype.toString.call(ll) === '[object Date]') ? ll : new Date(ll);
        if (!isNaN(d.getTime()) && d.getTime() < cutoff) return false; // 1ヶ月以上ログインなし → 対象外
      }
      return true;
    })
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

/**
 * 確認ログを {連絡ID: {email: {kaku, tai, main}}} のマップに畳み込む。
 *  kaku: 「確認した」チェック / tai: 「対応済み」チェック /
 *  main: チェック種別が空の旧データ（当時の唯一のチェック。要対応なら対応、閲覧のみなら確認とみなす）
 * 状態は 済=true / 取消=false（後の行が優先）。
 */
function logMap_() {
  var t = readTable_(SHEET_LOG);
  var hasType = t.col['チェック種別'] !== undefined;
  var map = {};
  t.rows.forEach(function (r) {
    var id = r[t.col['連絡ID']];
    var email = String(r[t.col['メール']]).toLowerCase();
    var done = r[t.col['状態']] === '済';
    var type = hasType ? String(r[t.col['チェック種別']] || '') : '';
    if (!map[id]) map[id] = {};
    if (!map[id][email]) map[id][email] = { kaku: false, tai: false, main: false };
    if (type === '確認') map[id][email].kaku = done;
    else if (type === '対応') map[id][email].tai = done;
    else map[id][email].main = done;
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
    links: String(row[col['資料リンク']] || '').split(/[\n]+/).map(function (s) { return s.trim(); }).filter(String),
    due: formatDate_(row[col['期限']]),
    dueRaw: row[col['期限']],
    action: row[col['要対応']] === true || String(row[col['要対応']]).toUpperCase() === 'TRUE',
    targetType: row[col['対象区分']] || '全員',
    targetEmails: row[col['対象メール']] || '',
    posted: row[col['掲載']] === true || String(row[col['掲載']]).toUpperCase() === 'TRUE',
    // 作成者メール列が無い旧データは ''（＝誰でも編集可として扱う）
    creatorEmail: col['作成者メール'] !== undefined ? String(row[col['作成者メール']] || '').toLowerCase() : ''
  };
}

function formatDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'M/d');
  }
  return String(v);
}

function formatDateTime_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'M/d HH:mm');
  }
  return String(v);
}

/**
 * 編集に関するメタ情報。canEdit は「作成者メールが記録されておらず誰でも編集可能」
 * または「自分が作成者本人」のときに true。dueISO は編集フォームの日付欄用（yyyy-MM-dd）。
 */
function editMeta_(it, me) {
  var canEdit = !it.creatorEmail || it.creatorEmail === String(me.email || '').toLowerCase();
  var dueISO = '';
  if (it.dueRaw) {
    var d = (Object.prototype.toString.call(it.dueRaw) === '[object Date]') ? it.dueRaw : new Date(it.dueRaw);
    if (!isNaN(d.getTime())) dueISO = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  }
  return { canEdit: canEdit, dueISO: dueISO };
}

// ============================================================
// フロントから呼ばれるAPI
// ============================================================
/**
 * 画面初期化用データを一括で返す。
 * { me, today, meetings, items:[{…, doneCount, targetCount, myDone, uncheckedNames}] }
 */
function getInitialData() {
  // 職員マスタは1回だけ読み、本人情報・集計対象・起票用リストすべてに使い回す
  var email = currentEmail_();
  var st = readTable_(SHEET_STAFF);
  var me = staffFromTable_(st, email);
  if (me.registered) touchLastLoginThrottled_(st, email); // 開いた時刻を記録（1時間に1回だけ書く）
  var staff = activeStaffFrom_(st);
  var logs = logMap_();
  var meetings = readMeetings_();
  var meetingName = {};
  meetings.forEach(function (m) { meetingName[m.id] = m.label; });
  var commentCounts = commentCountMap_();

  var t = readTable_(SHEET_ITEMS);
  var items = t.rows
    .map(function (r) { return toItem_(r, t.col); })
    .filter(function (it) { return it.posted; }) // ボードは掲載中のみ
    .map(function (it) { return decorateItem_(it, staff, logs, me, meetingName, commentCounts); });

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
    items: items,
    staffList: enrolledFrom_(st) // 起票フォームの「個別」対象選択用（在職の全職員）
  };
}

/**
 * 最終ログインの更新を1時間に1回に間引く。
 * 毎回書き込むとシートへの書き込み待ちで表示が遅くなるため（判定は30日単位なので十分）。
 */
function touchLastLoginThrottled_(t, email) {
  var i = findStaffRow_(t, email);
  if (i < 0 || t.col['最終ログイン'] === undefined) return;
  var last = t.rows[i][t.col['最終ログイン']];
  if (last) {
    var d = (Object.prototype.toString.call(last) === '[object Date]') ? last : new Date(last);
    if (!isNaN(d.getTime()) && new Date().getTime() - d.getTime() < 3600000) return; // 1時間以内なら書かない
  }
  t.sheet.getRange(i + 2, t.col['最終ログイン'] + 1).setValue(nowStr_());
}

/** 在職＝TRUE の全職員（名前・メール）。対象の個別選択用。ログイン日では絞らない */
function enrolledFrom_(t) {
  var list = t.rows
    .filter(function (r) { return r[t.col['在職']] === true || String(r[t.col['在職']]).toUpperCase() === 'TRUE'; })
    .map(function (r) {
      return {
        name: r[t.col['氏名']],
        email: String(r[t.col['メール']]).toLowerCase(),
        order: Number(r[t.col['表示順']]) || 999
      };
    });
  list.sort(function (a, b) { return a.order - b.order; });
  return list;
}

/** 1件の連絡に集計（確認・対応の進捗、自分のチェック、未対応者名、編集可否）を付与 */
function decorateItem_(it, staff, logs, me, meetingName, commentCounts) {
  var targets = targetsFor_(it, staff);
  var itemLog = logs[it.id] || {};

  // 要対応: メイン指標=対応済み、サブ=確認した。閲覧のみ: 確認のみ。
  // 旧データ(main)は、その連絡の当時のメインチェックとして数える。
  function stateOf(email) {
    var e = itemLog[email] || { kaku: false, tai: false, main: false };
    var done = it.action ? (e.tai || e.main) : (e.kaku || e.main);
    var ack = e.kaku || (!it.action && e.main);
    return { done: done, ack: ack };
  }

  var doneCount = 0, ackCount = 0;
  var unchecked = [];
  targets.forEach(function (s) {
    var st = stateOf(s.email);
    if (st.done) doneCount++;
    else unchecked.push(s.name);
    if (st.ack) ackCount++;
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

  var myState = stateOf(me.email.toLowerCase());
  var meta = editMeta_(it, me);
  return {
    id: it.id, kind: it.kind, meetingId: it.meetingId, meetingLabel: meetingName[it.meetingId] || it.meetingId,
    title: it.title, body: it.body, speaker: it.speaker, minutes: it.minutes, links: it.links,
    action: it.action, targetType: it.targetType, targetEmails: it.targetEmails,
    due: it.due, dueISO: meta.dueISO, dueLabel: it.dueLabel || '', dueClass: dueClass, dueSort: dueSort,
    doneCount: doneCount, ackCount: ackCount, targetCount: targets.length,
    myDone: myState.done,
    myAck: myState.ack,
    myTarget: targets.some(function (s) { return s.email === me.email.toLowerCase(); }),
    uncheckedNames: unchecked,
    canEdit: meta.canEdit,
    commentCount: (commentCounts || {})[it.id] || 0
  };
}

/**
 * 確認／対応済みの記録・取消。(連絡ID×職員×チェック種別)で1行、状態列を更新。
 * @param {string} itemId 連絡ID
 * @param {boolean} done true=チェック / false=取消
 * @param {string} checkType '確認' または '対応'（省略時はその連絡のメインチェック）
 * @return {Object} 更新後の { doneCount, ackCount, targetCount, uncheckedNames }
 */
function recordCheck(itemId, done, checkType) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var me = currentStaff_();
    if (!me.email) throw new Error('ログイン情報を取得できませんでした。');

    // 連絡が要対応かどうかでメインのチェック種別を決める
    var item = findItem_(itemId);
    if (!item) throw new Error('連絡が見つかりませんでした。');
    var mainType = item.action ? '対応' : '確認';
    var type = (checkType === '確認' || checkType === '対応') ? checkType : mainType;

    var state = done ? '済' : '取消';
    var t = readTable_(SHEET_LOG);
    var hasType = t.col['チェック種別'] !== undefined;
    var found = -1;
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i][t.col['連絡ID']] !== itemId) continue;
      if (String(t.rows[i][t.col['メール']]).toLowerCase() !== me.email.toLowerCase()) continue;
      var rowType = hasType ? String(t.rows[i][t.col['チェック種別']] || '') : '';
      // 同じ種別の行、または種別が空の旧行（＝当時のメインチェック）を更新対象にする
      if (rowType === type || (rowType === '' && type === mainType)) { found = i; break; }
    }
    if (found >= 0) {
      var rowNum = found + 2; // ヘッダー分＋1
      t.sheet.getRange(rowNum, t.col['状態'] + 1).setValue(state);
      t.sheet.getRange(rowNum, t.col['更新日時'] + 1).setValue(nowStr_());
      if (hasType) t.sheet.getRange(rowNum, t.col['チェック種別'] + 1).setValue(type);
    } else {
      var row = [];
      row[t.col['連絡ID']] = itemId;
      row[t.col['メール']] = me.email;
      row[t.col['氏名']] = me.name;
      row[t.col['状態']] = state;
      row[t.col['更新日時']] = nowStr_();
      if (hasType) row[t.col['チェック種別']] = type;
      t.sheet.appendRow(row);
    }
    // 集計はここでは行わない（画面側が即時反映済み。全体の再集計は次回の画面読込時）
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** IDで連絡事項を1件探す */
function findItem_(itemId) {
  var t = readTable_(SHEET_ITEMS);
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i][t.col['ID']] === itemId) return toItem_(t.rows[i], t.col);
  }
  return null;
}

/** 1件の連絡の進捗を再計算して返す */
function recount_(itemId) {
  var staff = activeStaff_();
  var item = findItem_(itemId);
  if (!item) return { doneCount: 0, ackCount: 0, targetCount: 0, uncheckedNames: [] };
  var logs = logMap_();
  var me = currentStaff_();
  var dec = decorateItem_(item, staff, logs, me, {});
  return { doneCount: dec.doneCount, ackCount: dec.ackCount, targetCount: dec.targetCount, uncheckedNames: dec.uncheckedNames };
}

/**
 * 起票フォームからの新規追加（協議事項／連絡事項）。
 * 画面側が一覧を再読込せずその場に挿入できるよう、追加した連絡（掲載中の
 * 連絡事項のときのみ）と、新規作成した会議（あれば）を整形して返す。
 * @param {Object} p { meetingId, newMeeting, kind, title, body, speaker, minutes, material,
 *                      due, action, targetType, targetEmails, links, posted }
 * @return {Object} { item: 表示用オブジェクト|null, meeting: 新規会議情報|null }
 */
function submitItem(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!p.title) throw new Error('議題を入力してください。');
    var st = readTable_(SHEET_STAFF);
    var me = staffFromTable_(st, currentEmail_());
    // 新しい会議が指定されていれば作成し、そのIDを使う
    var meetingId = p.meetingId || '';
    var meetingLabel = '';
    var newMeetingInfo = null;
    if (p.newMeeting && p.newMeeting.date) {
      meetingId = ensureMeeting_(p.newMeeting.date, p.newMeeting.kind);
    }
    if (meetingId) {
      var mt = readMeetings_();
      for (var mi = 0; mi < mt.length; mi++) {
        if (mt[mi].id === meetingId) {
          meetingLabel = mt[mi].label;
          if (p.newMeeting) newMeetingInfo = mt[mi]; // 新規作成時のみ画面へ返す
          break;
        }
      }
    }

    var t = readTable_(SHEET_ITEMS);
    // 同じ会議・同じ種別内での通し番号
    var no = 0;
    t.rows.forEach(function (r) {
      if (r[t.col['会議ID']] === meetingId && r[t.col['種別']] === p.kind) no++;
    });
    var links = (p.links || (p.link ? [p.link] : []))
      .map(function (s) { return String(s || '').trim(); }).filter(String).slice(0, 3);
    var kind = p.kind || '連絡';
    var action = !!p.action;
    var posted = p.posted !== false; // 既定は掲載ON
    var newId = uuid_();

    var row = [];
    row[t.col['ID']] = newId;
    row[t.col['会議ID']] = meetingId;
    row[t.col['種別']] = kind;
    row[t.col['No']] = no + 1;
    row[t.col['議題']] = p.title;
    row[t.col['内容']] = p.body || '';
    row[t.col['発言者']] = p.speaker || me.name;
    row[t.col['時間']] = p.minutes || '';
    row[t.col['資料']] = p.material || 'なし';
    row[t.col['資料リンク']] = links.join('\n'); // 最大3件・改行区切りで1セルに格納
    row[t.col['期限']] = p.due || '';
    row[t.col['要対応']] = action;
    row[t.col['対象区分']] = p.targetType || '全員';
    row[t.col['対象メール']] = p.targetEmails || '';
    row[t.col['掲載']] = posted;
    row[t.col['作成日時']] = nowStr_();
    if (t.col['作成者メール'] !== undefined) row[t.col['作成者メール']] = me.email;
    t.sheet.appendRow(row);

    var decorated = null;
    if (posted && kind === '連絡') {
      var staff = activeStaffFrom_(st);
      // p.due は 'yyyy-MM-dd' の文字列。シート保存後は日付型として読まれ formatDate_ が
      // 'M/d' に整形するので、その場挿入でも同じ見た目になるよう Date化してから整形する。
      var dueDate = p.due ? new Date(p.due) : '';
      var it = {
        id: newId, meetingId: meetingId, kind: kind, no: no + 1,
        title: p.title, body: p.body || '', speaker: p.speaker || me.name, minutes: p.minutes || '',
        links: links, due: formatDate_(dueDate), dueRaw: dueDate,
        action: action, targetType: p.targetType || '全員', targetEmails: p.targetEmails || '',
        posted: posted, creatorEmail: String(me.email || '').toLowerCase()
      };
      decorated = decorateItem_(it, staff, {}, me, meetingId ? mapOf_(meetingId, meetingLabel) : {});
    }
    return { item: decorated, meeting: newMeetingInfo };
  } finally {
    lock.releaseLock();
  }
}

function mapOf_(key, value) { var o = {}; o[key] = value; return o; }

/**
 * 起票済みの連絡・議題（協議事項／連絡事項どちらも）を編集する。
 * 編集できるのは「発信者本人」のみ。作成者メールが記録されていない旧データは
 * 誰でも編集でき、その最初の編集で作成者として記録される。
 * 会議への紐づけ・種別（協議／連絡）は編集の対象外（起票し直しで対応する）。
 * @param {string} itemId
 * @param {Object} p { title, body, speaker, minutes, due, action, targetType, targetEmails, links }
 * @return {Object} { item: 表示用オブジェクト|null }  ※協議事項や非掲載の場合は null
 */
function editItem(itemId, p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!p.title) throw new Error('議題を入力してください。');
    var st = readTable_(SHEET_STAFF);
    var me = staffFromTable_(st, currentEmail_());
    if (!me.email) throw new Error('ログイン情報を取得できませんでした。');

    var t = readTable_(SHEET_ITEMS);
    var rowIdx = -1;
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i][t.col['ID']] === itemId) { rowIdx = i; break; }
    }
    if (rowIdx < 0) throw new Error('連絡が見つかりませんでした。');
    var existing = toItem_(t.rows[rowIdx], t.col);
    var meta = editMeta_(existing, me);
    if (!meta.canEdit) throw new Error('この連絡は発信者のみ編集できます。');

    var links = (p.links || []).map(function (s) { return String(s || '').trim(); }).filter(String).slice(0, 3);
    var dueDate = p.due ? new Date(p.due) : '';
    var rowNum = rowIdx + 2; // ヘッダー分＋1
    function setCell(header, value) {
      if (t.col[header] === undefined) return;
      t.sheet.getRange(rowNum, t.col[header] + 1).setValue(value);
    }
    setCell('議題', p.title);
    setCell('内容', p.body || '');
    setCell('発言者', p.speaker || me.name);
    setCell('時間', p.minutes || '');
    setCell('資料リンク', links.join('\n'));
    setCell('期限', p.due || '');
    setCell('要対応', !!p.action);
    setCell('対象区分', p.targetType || '全員');
    setCell('対象メール', p.targetEmails || '');
    // 作成者が未記録の旧データは、この編集をきっかけに記録する
    if (!existing.creatorEmail) setCell('作成者メール', me.email);

    var updated = {
      id: existing.id, meetingId: existing.meetingId, kind: existing.kind, no: existing.no,
      title: p.title, body: p.body || '', speaker: p.speaker || me.name, minutes: p.minutes || '',
      links: links, due: formatDate_(dueDate), dueRaw: dueDate,
      action: !!p.action, targetType: p.targetType || '全員', targetEmails: p.targetEmails || '',
      posted: existing.posted, creatorEmail: existing.creatorEmail || String(me.email).toLowerCase()
    };

    var decorated = null;
    if (updated.posted && updated.kind === '連絡') {
      var staff = activeStaffFrom_(st);
      var logs = logMap_();
      var meetings = readMeetings_();
      var meetingName = {};
      meetings.forEach(function (m) { meetingName[m.id] = m.label; });
      var commentCounts = commentCountMap_();
      decorated = decorateItem_(updated, staff, logs, me, meetingName, commentCounts);
    }
    return { item: decorated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定会議の協議事項・連絡事項（アジェンダ表示用）。
 * 注意: google.script.run は Date 型を含む戻り値を返せない（無反応で止まる）ため、
 * シートの生値（dueRaw 等）は渡さず、表示用の文字列だけに詰め替えて返す。
 */
function getMeetingAgenda(meetingId) {
  var st = readTable_(SHEET_STAFF);
  var me = staffFromTable_(st, currentEmail_());
  var commentCounts = commentCountMap_();
  var t = readTable_(SHEET_ITEMS);
  var giron = [], renraku = [], total = 0;
  t.rows.forEach(function (r) {
    var it = toItem_(r, t.col);
    if (it.meetingId !== meetingId) return;
    var m = Number(it.minutes) || 0;
    total += m;
    var meta = editMeta_(it, me);
    var plain = {
      id: it.id,
      no: String(it.no || ''),
      title: String(it.title || ''),
      body: String(it.body || ''),
      speaker: String(it.speaker || ''),
      minutes: String(it.minutes || ''),
      links: it.links,
      due: it.due, // formatDate_ 済みの文字列
      dueISO: meta.dueISO,
      action: it.action,
      targetType: it.targetType,
      targetEmails: it.targetEmails,
      canEdit: meta.canEdit,
      commentCount: commentCounts[it.id] || 0
    };
    (it.kind === '協議' ? giron : renraku).push(plain);
  });
  var byNo = function (a, b) { return (Number(a.no.replace(/[^0-9]/g, '')) || 0) - (Number(b.no.replace(/[^0-9]/g, '')) || 0); };
  giron.sort(byNo); renraku.sort(byNo);
  return { giron: giron, renraku: renraku, totalMinutes: total };
}

/** 未対応者の氏名一覧（全職員が閲覧可） */
function getUncheckedNames(itemId) {
  return recount_(itemId).uncheckedNames;
}

// ============================================================
// コメント（議題・連絡ごとの意見交換。全職員が投稿・閲覧できる）
// ============================================================
/** 全連絡のコメント数を {連絡ID: 件数} で返す（一覧のバッジ表示用の軽量版） */
function commentCountMap_() {
  var t = readTable_(SHEET_COMMENTS);
  var map = {};
  t.rows.forEach(function (r) {
    var id = r[t.col['連絡ID']];
    map[id] = (map[id] || 0) + 1;
  });
  return map;
}

/** 指定の連絡に付いたコメント一覧（投稿順）と件数を返す */
function getComments(itemId) {
  var t = readTable_(SHEET_COMMENTS);
  var list = t.rows
    .filter(function (r) { return r[t.col['連絡ID']] === itemId; })
    .map(function (r) {
      return {
        name: String(r[t.col['氏名']] || ''),
        text: String(r[t.col['本文']] || ''),
        time: formatDateTime_(r[t.col['投稿日時']])
      };
    });
  return { comments: list, commentCount: list.length };
}

/**
 * 連絡・議題にコメントを追加する。編集・削除はできない、投稿のみのシンプルな仕組み。
 * @return {Object} getComments と同じ形（追加後の一覧・件数）
 */
function addComment(itemId, text) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    text = String(text || '').trim();
    if (!text) throw new Error('コメントを入力してください。');
    if (text.length > 500) throw new Error('コメントは500文字以内でお願いします。');
    var me = currentStaff_();
    if (!me.email) throw new Error('ログイン情報を取得できませんでした。');
    if (!findItem_(itemId)) throw new Error('連絡が見つかりませんでした。');
    sheet_(SHEET_COMMENTS).appendRow([itemId, me.email, me.name, text, nowStr_()]);
    return getComments(itemId);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定日の会議を用意してIDを返す。同じ日付の会議が既にあれば再利用する。
 * @param {string} dateStr 'yyyy-MM-dd'
 * @param {string} kind 職員会議 / 打合せ
 * @return {string} 会議ID（例 M20260717）
 */
function ensureMeeting_(dateStr, kind) {
  var d = new Date(dateStr);
  var id = 'M' + Utilities.formatDate(d, TZ, 'yyyyMMdd');
  var t = readTable_(SHEET_MEETINGS);
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i][t.col['会議ID']] === id) return id; // 既存の会議を再利用
  }
  var label = Utilities.formatDate(d, TZ, 'M/d') + ' ' + (kind || '打合せ');
  t.sheet.appendRow([id, dateStr, kind || '打合せ', label]);
  return id;
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

/**
 * 時間トリガーを登録（重複登録を防ぐ）。
 *  - sendReminders   … 毎朝7:30、期限超過の未対応者へ督促メール
 *  - yearEndReset    … 毎朝3:30に日付を確認し、4/1のみ年度末アーカイブを実行
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var h = tr.getHandlerFunction();
    // 'resetStaffMasterYearly' は旧バージョンのハンドラ名（掃除対象）
    if (h === 'sendReminders' || h === 'yearEndReset' || h === 'resetStaffMasterYearly') {
      ScriptApp.deleteTrigger(tr);
    }
  });
  ScriptApp.newTrigger('sendReminders').timeBased().atHour(7).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('yearEndReset').timeBased().atHour(3).nearMinute(30).everyDays(1).create();
}

// ============================================================
// 年度末アーカイブ（毎朝チェックし、4/1のみ実行）
// ============================================================
/**
 * 実行日が RESET_MONTH/RESET_DAY のときだけ、年度のデータを丸ごとアーカイブして
 * 稼働シートを空にする。対象は 職員マスタ・連絡事項・確認ログ・会議 の4シート。
 * 稼働データを常に1年度分に保つことで、何年運用しても読み込みが重くならない。
 */
function yearEndReset() {
  var d = new Date();
  if (d.getMonth() + 1 !== RESET_MONTH || d.getDate() !== RESET_DAY) return;
  archiveYearEnd_();
}

/** 旧バージョンのトリガーが残っていても動くようにするための別名 */
function resetStaffMasterYearly() {
  yearEndReset();
}

/** 4シートを「シート名_YYYY年度」に退避してから中身を空にする（ヘッダーは残す） */
function archiveYearEnd_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var endedYear = new Date().getFullYear() - 1; // 4/1実行時点で「終わった年度」
    var suffix = '_' + endedYear + '年度';
    [SHEET_STAFF, SHEET_ITEMS, SHEET_LOG, SHEET_MEETINGS, SHEET_COMMENTS].forEach(function (name) {
      archiveAndClearSheet_(name, name + suffix);
    });
  } finally {
    lock.releaseLock();
  }
}

/** 1シートをアーカイブ名でコピーしてから、本体のデータ行を消す（既にアーカイブ済みなら退避はスキップ） */
function archiveAndClearSheet_(name, archiveName) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) return; // シートが無ければ何もしない
  if (!ss.getSheetByName(archiveName)) {
    sh.copyTo(ss).setName(archiveName); // 丸ごと退避（履歴を残す）
  }
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
}

// ============================================================
// 会議一覧
// ============================================================
/**
 * 会議一覧。日付セルは Date 型のことがあるが、google.script.run は
 * Date を含む戻り値を返せない（無反応で止まる）ため、数値のソートキーと
 * 表示用文字列に変換して返す。
 */
function readMeetings_() {
  var t = readTable_(SHEET_MEETINGS);
  var list = t.rows.map(function (r) {
    var date = r[t.col['日付']];
    var d = (Object.prototype.toString.call(date) === '[object Date]') ? date : new Date(date);
    return {
      id: String(r[t.col['会議ID']] || ''),
      sortKey: isNaN(d.getTime()) ? 0 : d.getTime(),
      dateLabel: formatDate_(date),
      kind: String(r[t.col['種別']] || ''),
      label: String(r[t.col['名称']] || (formatDate_(date) + ' ' + r[t.col['種別']]))
    };
  }).filter(function (m) { return m.id; });
  // 新しい会議を上に
  list.sort(function (a, b) { return b.sortKey - a.sortKey; });
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
  ensureSheet_(ss, SHEET_COMMENTS, HEADERS.comments);
  ensureStaffColumns_(); // 旧シートに「最終ログイン」列が無ければ追加（再セットアップ時の移行）
  ensureLogColumns_();   // 旧シートに「チェック種別」列が無ければ追加（同上）
  ensureItemColumns_();  // 旧シートに「作成者メール」列が無ければ追加（同上）
  seedSample_();
  SpreadsheetApp.getActiveSpreadsheet().toast('セットアップ完了。職員は初回アクセス時に自動登録されます。', '連絡ボード', 8);
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

/** 職員マスタに「最終ログイン」列が無ければ末尾に追加する（旧バージョンからの移行用） */
function ensureStaffColumns_() {
  var sh = sheet_(SHEET_STAFF);
  var width = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  if (header.indexOf('最終ログイン') < 0) {
    sh.getRange(1, header.length + 1).setValue('最終ログイン').setFontWeight('bold');
  }
}

/** 確認ログに「チェック種別」列が無ければ末尾に追加する（旧バージョンからの移行用） */
function ensureLogColumns_() {
  var sh = sheet_(SHEET_LOG);
  var width = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  if (header.indexOf('チェック種別') < 0) {
    sh.getRange(1, header.length + 1).setValue('チェック種別').setFontWeight('bold');
  }
}

/** 連絡事項に「作成者メール」列が無ければ末尾に追加する（旧バージョンからの移行用） */
function ensureItemColumns_() {
  var sh = sheet_(SHEET_ITEMS);
  var width = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  if (header.indexOf('作成者メール') < 0) {
    sh.getRange(1, header.length + 1).setValue('作成者メール').setFontWeight('bold');
  }
}

/**
 * 動作確認用のサンプルデータ（既にデータがあれば何もしない）。
 * 職員マスタには初期データを入れない（初回アクセス時の自己登録で埋まる）。
 */
function seedSample_() {
  var meetSh = sheet_(SHEET_MEETINGS);
  if (meetSh.getLastRow() <= 1) {
    meetSh.getRange(2, 1, 1, HEADERS.meetings.length).setValues([
      ['M20260717', '2026-07-17', '職員会議', '7/17（木）職員会議']
    ]);
  }
  var itemSh = sheet_(SHEET_ITEMS);
  if (itemSh.getLastRow() <= 1) {
    // 末尾の '' は「作成者メール」列（未記録＝誰でも編集可のサンプルとして残す）
    var rows = [
      [uuid_(), 'M20260717', '連絡', 1, '端末の管理番号について',
       'スズキ校務の詳細名簿に入力をお願いします。', '横田', 1, 'あり（データ）', '',
       '2026-07-24', true, '全員', '', true, nowStr_(), ''],
      [uuid_(), 'M20260717', '連絡', 2, '夏休み宿題　習字・作文の集め方',
       'JAの習字は8月26日まで、作文は9月1日まで。', '清水', '', 'あり（データ）', '',
       '2026-08-26', true, '全員', '', true, nowStr_(), ''],
      [uuid_(), 'M20260717', '連絡', 3, 'ご紹介：人権啓発セミナー受講者募集',
       '受講希望の方は相座までご連絡ください。', '相座', '', 'あり（データ）', '',
       '', false, '全員', '', true, nowStr_(), ''],
      [uuid_(), 'M20260717', '協議', 1, '音楽会実施計画案（略案）',
       'プログラム順など変更。体育館練習を2時間削減。', '西村', 5, 'あり（データ）', '',
       '', false, '全員', '', false, nowStr_(), '']
    ];
    itemSh.getRange(2, 1, rows.length, HEADERS.items.length).setValues(rows);
  }
}

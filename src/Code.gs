/**
 * Code.gs
 * ウェブアプリの入口（doGet）とスプレッドシートのカスタムメニュー。
 */

/** スプレッドシートを開いたときにメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(C.APP_NAME)
    .addItem('初期セットアップ（シート作成＋サンプル）', 'setupSheets')
    .addSeparator()
    .addItem('デモ単元を「公開中」にする', 'setupPublishDemo')
    .addItem('記録系データを全消去（マスタは残す）', 'setupClearRecords')
    .addToUi();
}

/** ウェブアプリ表示。ロールで児童用/教師用を出し分ける */
function doGet() {
  var ctx = getContext();

  var file, title;
  if (!ctx.user) {
    file = 'unauthorized';
    title = C.APP_NAME;
  } else if (ctx.role === C.ROLE.TEACHER) {
    file = 'teacher';
    title = C.APP_NAME + '（先生）';
  } else {
    file = 'student';
    title = C.APP_NAME;
  }

  var t = HtmlService.createTemplateFromFile(file);
  t.bootstrap = ctx; // クライアントの初期表示に使う
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** HTMLテンプレートから css.html / js_common.html を差し込むためのヘルパー */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ------- サーバー内共通ヘルパー ------- */

/**
 * いま児童に見せるべき単元を1件返す。
 * 「公開中」を優先し、複数あれば更新時刻が新しいもの。無ければ null。
 */
function currentUnit_() {
  var units = Repo.readAll(C.SH.UNIT);
  var open = units.filter(function (u) { return u['状態'] === C.UNIT_STATE.OPEN; });
  if (open.length === 0) return null;
  open.sort(function (a, b) { return toMs_(b['更新時刻']) - toMs_(a['更新時刻']); });
  return open[0];
}

/** 公開中の単元。無ければ例外 */
function requireCurrentUnit_() {
  var u = currentUnit_();
  if (!u) throw new Error('いま公開されている単元がありません。');
  return u;
}

/** きょうの日付キー（Asia/Tokyo, yyyy-MM-dd）。目標・確認タイム・振り返りの単位 */
function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/* ------- 学びログ（写真）の置き場 ------- */

/**
 * 写真の保存先フォルダを返す（無ければ作る）。
 *
 * ウェブアプリは「自分（＝デプロイした教師）として実行」なので、
 * DriveApp は常に教師のドライブを見る。子どものアカウントに Drive 権限は要らず、
 * 写真も子どものドライブには入らない。
 *
 * drive.file スコープはアプリが作ったファイル／フォルダにしか触れないため、
 * スプレッドシートの親フォルダは辿れない。ルート直下に自前の置き場を作り、
 * そのIDをスクリプトプロパティに覚えておく。
 */
function logFolder_(unitLabel, day) {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty(C.LOG_ROOT_PROP);
  var root = null;

  if (rootId) {
    // 教師がフォルダをゴミ箱に入れていることがある。その時は作り直す。
    try {
      var f = DriveApp.getFolderById(rootId);
      if (!f.isTrashed()) root = f;
    } catch (e) { root = null; }
  }
  if (!root) {
    root = DriveApp.createFolder(C.LOG_ROOT_NAME);
    props.setProperty(C.LOG_ROOT_PROP, root.getId());
  }

  return childFolder_(childFolder_(root, unitLabel), day);
}

/** 名前の一致する子フォルダを返す（無ければ作る） */
function childFolder_(parent, name) {
  var safe = String(name).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 100) || '_';
  var it = parent.getFoldersByName(safe);
  return it.hasNext() ? it.next() : parent.createFolder(safe);
}

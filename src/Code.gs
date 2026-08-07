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
    .addItem('単元シートを新しく作る', 'unitSheetNew')
    .addItem('この単元シートを取り込む', 'unitSheetImport')
    .addItem('既存の単元を単元シートに書き出す', 'unitSheetExport')
    .addSeparator()
    .addItem('デモ単元を「公開中」にする', 'setupPublishDemo')
    .addItem('記録系データを全消去（マスタは残す）', 'setupClearRecords')
    .addSeparator()
    .addItem('デモモード：役割の切り替えを' + (isDemoMode_() ? 'オフにする' : 'オンにする'), 'setupToggleDemo')
    .addToUi();
}

/** デモモードか（スクリプトプロパティで切り替え。既定はオフ） */
function isDemoMode_() {
  return PropertiesService.getScriptProperties().getProperty(C.DEMO_PROP) === 'TRUE';
}

/**
 * ウェブアプリ自身のURL。役割の切り替えリンクを組み立てるのに使う。
 * 取れない環境もあるので、その時は空文字を返して切り替えUIを出さない
 * （URLに ?as=teacher / ?as=student を手で付ければ同じことができる）。
 */
function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/**
 * ウェブアプリ表示。ロールで児童用/教師用を出し分ける。
 *
 * ?as=student / ?as=teacher で表示を切り替えられる：
 *   - 教師は、いつでも児童画面を下見できる（自分がどう見えているかの確認）
 *   - 児童が教師画面を開けるのはデモモードのときだけ
 */
function doGet(e) {
  var ctx = getContext();
  var demo = isDemoMode_();
  var isTeacher = ctx.role === C.ROLE.TEACHER;
  var want = (e && e.parameter && e.parameter.as) || '';

  var file, title;
  if (!ctx.user) {
    file = 'unauthorized';
    title = C.APP_NAME;
  } else {
    var viewAs = isTeacher ? C.ROLE.TEACHER : C.ROLE.STUDENT;
    if (want === C.ROLE.STUDENT && (isTeacher || demo)) viewAs = C.ROLE.STUDENT;
    if (want === C.ROLE.TEACHER && (isTeacher || demo)) viewAs = C.ROLE.TEACHER;

    file = viewAs === C.ROLE.TEACHER ? 'teacher' : 'student';
    title = viewAs === C.ROLE.TEACHER ? (C.APP_NAME + '（先生）') : C.APP_NAME;
    ctx.viewAs = viewAs;
    // 教師は素の権限で、児童はデモモードのときだけ行き来できる
    ctx.canSwitch = (isTeacher || demo) ? appUrl_() : '';
    ctx.demo = demo;
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

/**
 * Setup.gs
 * シートの初期化と、初期人物セットの投入。
 * スプレッドシートのメニューから実行する。何度実行しても壊れない（すでにある行は足さない）。
 */

/** スプレッドシートを開いたときにメニューを出す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(C.APP_NAME)
    .addItem('初期セットアップ', 'setupAll')
    .addItem('初期人物セットを入れ直す', 'seedFigures')
    .addSeparator()
    .addItem('APIキーを登録する', 'promptApiKey')
    .addItem('APIキーを消す', 'clearApiKey')
    .addToUi();
}

/** シートをすべて用意し、設定と人物を入れる */
function setupAll() {
  var made = [];
  Object.keys(C.SHEET).forEach(function (k) {
    var name = C.SHEET[k];
    if (ensureSheet_(name, C.COLS[k])) made.push(name);
  });
  seedSettings_();
  seedFigures();
  ensureSelfAsTeacher_();

  SpreadsheetApp.getUi().alert(
    C.APP_NAME + ' の準備ができました。\n\n' +
    (made.length ? '作ったシート：' + made.join('、') + '\n\n' : '') +
    '次にやること\n' +
    '1. メニュー「APIキーを登録する」で Gemini の鍵を入れる\n' +
    '2. ウェブアプリとして配置する（アクセス：組織内 ／ 実行：自分）\n' +
    '3. 教師画面の「設定」でモデルを選ぶ\n' +
    '4. 人物マスタの「公開」に TRUE を立てた人物だけが画面に出ます'
  );
}

/** 見出し行を持つシートを用意する。すでにあれば触らない */
function ensureSheet_(name, cols) {
  var ss = SpreadsheetApp.getActive();
  var s = ss.getSheetByName(name);
  if (s) return false;
  s = ss.insertSheet(name);
  s.getRange(1, 1, 1, cols.length).setValues([cols]);
  s.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#E2E6EC');
  s.setFrozenRows(1);
  s.autoResizeColumns(1, Math.min(cols.length, 8));
  return true;
}

/** 設定シートに既定値を入れる（すでにあるキーは上書きしない） */
function seedSettings_() {
  var have = {};
  Repo.readAll(C.SHEET.SETTINGS).forEach(function (r) { have[String(r['キー'])] = true; });
  var add = C.SETTINGS_DEFAULT.filter(function (d) { return !have[d[0]]; })
    .map(function (d) { return { 'キー': d[0], '値': d[1], '説明': d[2] }; });
  if (add.length) Repo.appendMany(C.SHEET.SETTINGS, add);
}

/** 初期人物セットを入れる。同じ figure_id がすでにあれば飛ばす */
function seedFigures() {
  var have = {};
  Repo.readAll(C.SHEET.FIGURES).forEach(function (r) { have[String(r.figure_id)] = true; });
  var rows = SEED.figureRows().filter(function (r) { return !have[r.figure_id]; });
  if (rows.length) Repo.appendMany(C.SHEET.FIGURES, rows);
  return rows.length;
}

/** 実行している本人を教師として名簿に入れる（第1段階は教師デモなので、これで足りる） */
function ensureSelfAsTeacher_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) return;
  if (Repo.firstWhere(C.SHEET.USERS, { '端末アカウント': email })) return;
  Repo.append(C.SHEET.USERS, {
    user_id: Repo.uuid(), '氏名': email, '表示名': '先生',
    '出席番号': '', '役割': C.ROLE.TEACHER, '端末アカウント': email
  });
}

/* ============================================================
   APIキー ── シートには置かない。ScriptProperties に持つ
   ============================================================ */

function promptApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    'Gemini APIキー',
    'Google AI Studio で作った鍵を貼り付けてください。\n' +
    'この鍵はスプレッドシートには書き込まれません。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) { ui.alert('何も入力されていません。'); return; }
  PropertiesService.getScriptProperties().setProperty(C.PROP.API_KEY, key);
  ui.alert('登録しました。教師画面の「設定」でモデルを選んでください。');
}

function clearApiKey() {
  PropertiesService.getScriptProperties().deleteProperty(C.PROP.API_KEY);
  SpreadsheetApp.getUi().alert('APIキーを消しました。');
}

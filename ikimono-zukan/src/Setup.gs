/**
 * Setup.gs
 * スプレッドシートの初期化。メニューから1回実行すれば動く状態になる。
 * 何度実行しても壊れない（既存シートは作り直さない）。
 */

/** スプレッドシートを開いたときにメニューを出す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(C.APP_NAME)
    .addItem('初期セットアップ', 'setup')
    .addItem('要注意リストを初期データで補充', 'seedSafetyList')
    .addSeparator()
    .addItem('APIキーを設定', 'promptApiKey')
    .addItem('設定を確認', 'showConfig')
    .addSeparator()
    .addItem('写真が出ないときの診断', 'diagImages')
    .addItem('写真が空の行に写真を入れ直す', 'refillImages')
    .addItem('ふりがなの無い漢字を直す', 'refillRuby')
    .addSeparator()
    .addItem('別名索引のキャッシュを消す', 'clearCache')
    .addToUi();
}

/** 4シートを作り、要注意リストに初期データを入れる */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, C.SH.ZUKAN,  C.COL.ZUKAN);
  ensureSheet_(ss, C.SH.ALIAS,  C.COL.ALIAS);
  ensureSheet_(ss, C.SH.SAFETY, C.COL.SAFETY);
  ensureSheet_(ss, C.SH.LOG,    C.COL.LOG);
  seedSafetyList();
  Repo.clearAliasCache();

  var ui = SpreadsheetApp.getUi();
  ui.alert(C.APP_NAME,
    'シートを作成しました。\n\n' +
    'つぎに「' + C.APP_NAME + ' ▸ APIキーを設定」から\n' +
    'Gemini の API キーを登録してください。',
    ui.ButtonSet.OK);
}

/** 見出し付きのシートを用意する。既にあれば見出しの不足だけ補う */
function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  var lastCol = sh.getLastColumn();
  var current = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing = cols.filter(function (c) { return current.indexOf(c) < 0; });
  if (current.length === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  } else if (missing.length) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#E1EFE5');
  sh.setFrozenRows(1);
  return sh;
}

/**
 * 要注意リストに初期データを入れる。
 * 既に同じ名前パターンがある行は触らないので、
 * 保護者が書き換えた内容が消えることはない。
 */
function seedSafetyList() {
  var sh = SpreadsheetApp.getActive().getSheetByName(C.SH.SAFETY);
  if (!sh) throw new Error('先に初期セットアップを実行してください。');

  var existing = {};
  Repo.readAll(C.SH.SAFETY).forEach(function (r) {
    existing[Kana.normalize(r['名前パターン'])] = true;
  });

  var rows = Safety.SEED.filter(function (s) {
    return !existing[Kana.normalize(s[0])];
  });
  if (!rows.length) return 0;

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, C.COL.SAFETY.length).setValues(rows);
  return rows.length;
}

/** APIキーの登録 */
function promptApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(C.APP_NAME,
    'Google AI Studio で取得した Gemini の API キーを貼り付けてください。\n' +
    '（キーは ScriptProperties に保存され、画面には出ません）',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) { ui.alert('キーが空です。'); return; }
  PropertiesService.getScriptProperties().setProperty(C.PROP.API_KEY, key);
  ui.alert(C.APP_NAME, 'APIキーを保存しました。', ui.ButtonSet.OK);
}

/** いまの設定を確認する。キーは伏せて表示する */
function showConfig() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty(C.PROP.API_KEY);
  var msg =
    'APIキー：' + (key ? '設定ずみ（末尾 ' + key.slice(-4) + '）' : '未設定') + '\n' +
    'モデル：' + (p.getProperty(C.PROP.MODEL) || C.DEFAULT_MODEL) + '\n' +
    '画像フォルダ：' + (p.getProperty(C.PROP.FOLDER_ID) || '未作成（初回検索時に自動で作られます）') + '\n' +
    'AI画像生成：' + (p.getProperty(C.PROP.ALLOW_AI_IMAGE) === 'true' ? '有効' : '無効') + '\n\n' +
    '図鑑の生き物：' + Repo.listCreatures().length + 'しゅるい\n' +
    '要注意リスト：' + Safety.rules().length + 'けん';
  SpreadsheetApp.getUi().alert(C.APP_NAME, msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function clearCache() {
  Repo.clearAliasCache();
  SpreadsheetApp.getUi().alert(C.APP_NAME, '別名索引のキャッシュを消しました。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

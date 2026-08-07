/**
 * Setup.gs
 * 初期セットアップ：全シートの生成、見出し設定、サンプルマスタ・デモ単元の投入。
 * 教師がコピーしたスプレッドシートで一度だけ実行する想定（再実行は不足シートのみ補う）。
 */

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  var created = [];

  C.SHEET_ORDER.forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (!s) { s = ss.insertSheet(name); created.push(name); }
    var headers = C.HEADERS[name];
    s.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#EDF0EA');
    s.setFrozenRows(1);
    s.autoResizeColumns(1, headers.length);
    applySheetValidations_(s, name, headers);
  });

  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) { try { ss.deleteSheet(def); } catch (e) {} }

  seedMastersIfEmpty_();
  seedDemoUnitIfEmpty_();

  SpreadsheetApp.getUi().alert(
    C.APP_NAME,
    'セットアップが完了しました。\n' +
    '・作成したシート: ' + (created.length ? created.join('、') : 'なし（既存を整えました）') + '\n\n' +
    '次に「名簿」シートに児童・教師を登録し、ウェブアプリとしてデプロイしてください。\n' +
    'デモをすぐ試すには、メニューの「デモ単元を公開中にする」を実行します。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** 方略マスタ・選択肢マスタが空ならサンプルを投入 */
function seedMastersIfEmpty_() {
  if (Repo.readAll(C.SH.STRAT).length === 0) {
    [
      ['S01', '認知',        'まず全体、つぎに細かく', '地図や年表の全体をながめてから、細かい資料を読む', '🗺', '実行'],
      ['S02', '認知',        'キーワードメモ',         '大事な言葉を3つメモしてから文をつくる',           '📝', '実行'],
      ['S03', 'メタ認知',    '友だちに説明してみる',   '説明できたら「わかった」のサイン。つまったら資料にもどる', '🗣', '実行'],
      ['S04', '感情調節・時間', 'タイマーで区切る',     '10分ごとに区切って、進みぐあいをたしかめる',       '⏱', '実行'],
      ['S05', '援助要請',    'たすけてサイン',         '5分考えてもわからなかったら、友だちか先生に聞く', '🙋', '実行'],
      ['S06', 'メタ認知',    'ゴールを見返す',         'まよったら「ゴールの姿」を読み直して方向をたしかめる', '🎯', '見通す']
    ].forEach(function (r) { Repo.append(C.SH.STRAT, zip_(C.HEADERS[C.SH.STRAT], r)); });
  }

  if (Repo.readAll(C.SH.PRESET).length === 0) {
    [
      ['P01', '学習形態', 'ひとりで',       '🧑',    'FALSE'],
      ['P02', '学習形態', 'ペアで',         '🧑‍🤝‍🧑', 'FALSE'],
      ['P03', '学習形態', 'グループで',     '👥',    'FALSE'],
      ['P04', 'ツール',   '教科書',         '📖',    'TRUE'],
      ['P05', 'ツール',   '資料集',         '📚',    'TRUE'],
      ['P06', 'ツール',   'NHK for School', '🎬',    'TRUE'],
      ['P07', 'ツール',   '白地図',         '🗺',    'TRUE'],
      ['P08', '場所',     '自席',           '💺',    'FALSE'],
      ['P09', '場所',     '学びスペース',   '🛋',    'FALSE']
    ].forEach(function (r) { Repo.append(C.SH.PRESET, zip_(C.HEADERS[C.SH.PRESET], r)); });
  }
}

/**
 * 単元が空なら 6年社会のデモ単元を投入。
 * 単元内自由進度学習の「学習の手引き」に合わせ、必須ミッション＋選べる活動＋発展問題で構成する。
 */
function seedDemoUnitIfEmpty_() {
  if (Repo.readAll(C.SH.UNIT).length > 0) return;

  var unitId = Repo.uuid();
  Repo.append(C.SH.UNIT, zip_(C.HEADERS[C.SH.UNIT], [
    unitId, '社会', '6年', '江戸幕府と政治の安定',
    '幕府の政策から、世の中が安定したしくみを説明できる',
    '「大名支配のしくみ新聞」を作り、幕府が安定した理由を自分の言葉で説明する',
    8,                    // 指導計画6時間＋ゆとり2時間
    2,                    // 裁量レベル（選択調整型）
    15,                   // 確認タイムの間隔（分）
    'TRUE', '記名',
    C.UNIT_STATE.DRAFT, Repo.now()
  ]));

  // 課題（学習カード）。並び順・種別・めやす時間・公開
  var K = C.TASK_KIND;
  var tasks = [
    [1, K.MUST,     '幕府のしくみを図にまとめる',            '将軍・大名・老中などの関係を、矢印を使って図にしよう。', 15, 'TRUE'],
    [2, K.MUST,     '大名の配置を白地図に整理する',          '親藩・譜代・外様を色分けして、気づいたことを書こう。',   20, 'TRUE'],
    [3, K.MUST,     '参勤交代のしくみと大名への影響を読み取る', '何年おきに、どのくらいの費用がかかったのかを調べよう。', 20, 'TRUE'],
    [4, K.MUST,     '「なぜ安定したか」を説明する文を書く',   'ゴールの姿を見返しながら、3文以上で書こう。',           20, 'TRUE'],
    [5, K.CHOICE,   '武家諸法度を現代語で読み比べる',        'どんな決まりが大名をしばっていたのかを見つけよう。',     15, 'TRUE'],
    [6, K.CHOICE,   '江戸のまちのくらしを調べる',            '町人はどんな生活をしていたのだろう。',                 15, 'TRUE'],
    [7, K.CHOICE,   '年表で幕府260年の動きをたどる',         '長く続いた理由を年表から考えよう。',                   15, 'TRUE'],
    [8, K.ADVANCED, '「大名支配のしくみ新聞」をつくる',      '単元のゴール。調べたことを新聞にまとめよう。',         30, 'TRUE'],
    [9, K.ADVANCED, '学んだことを説明動画にまとめる',        '1分で説明する動画をつくろう。',                       30, 'FALSE'] // 途中で投入する仕掛け
  ];
  var taskIds = {};
  tasks.forEach(function (t) {
    var id = Repo.uuid();
    taskIds[t[0]] = id;
    Repo.append(C.SH.TASK, zip_(C.HEADERS[C.SH.TASK], [id, unitId].concat(t)));
  });

  // 資料（task_id が空なら「いつでも使える資料」）
  var resources = [
    ['',           '📖', '教科書 p.96–99「幕府の政治」',        '机の上に用意しよう',               '手もと資料', ''],
    ['',           '📚', '資料集 p.42–45「参勤交代の道のり」',  '大名行列の絵と地図がのっています', '手もと資料', ''],
    [taskIds[1],   '🎬', 'NHK for School「江戸幕府のしくみ」',  '動画 6:32 ・ イヤホンを使おう',   '動画',       'https://www.nhk.or.jp/school/'],
    [taskIds[2],   '🗺', '白地図「大名の配置（1664年）」',      '自分用のコピーが作られます',       'スライド',   'https://docs.google.com/presentation/'],
    [taskIds[3],   '🎬', 'NHK for School「参勤交代」',          '動画 6:32',                       '動画',       'https://www.nhk.or.jp/school/'],
    [taskIds[4],   '📝', '説明文のかきかたシート',              '「はじめ・なか・おわり」の型',     'ドキュメント', 'https://docs.google.com/document/'],
    [taskIds[5],   '🔗', '「武家諸法度」現代語やく',            'むずかしい言葉のいいかえ付き',     'ドキュメント', 'https://docs.google.com/document/'],
    [taskIds[8],   '📰', '新聞のわりつけテンプレート',          '見出し・記事・図の枠つき',         'スライド',   'https://docs.google.com/presentation/']
  ];
  resources.forEach(function (r) {
    Repo.append(C.SH.RES, zip_(C.HEADERS[C.SH.RES],
      [Repo.uuid(), unitId].concat(r).concat(['TRUE'])));
  });

  // 推奨方略（task_id 空なら単元共通）
  [
    ['',         'S06', 'まよったら、いつでもゴールを見返そう'],
    [taskIds[1], 'S01', 'まず全体をながめてから、細かい関係を見よう'],
    [taskIds[2], 'S01', '地図全体を見てから色分けしよう'],
    [taskIds[4], 'S02', '大事な言葉を3つメモしてから書き始めよう'],
    [taskIds[4], 'S03', '書けたらペアで説明してみよう'],
    [taskIds[8], 'S03', '友だちに説明すると、記事がはっきりするよ']
  ].forEach(function (s) {
    Repo.append(C.SH.USTRAT, zip_(C.HEADERS[C.SH.USTRAT], [unitId, s[0], s[1], s[2]]));
  });

  // 開放する選択肢（場所は今回閉じる）
  [['学習形態', 'TRUE'], ['ツール', 'TRUE'], ['場所', 'FALSE']].forEach(function (c) {
    Repo.append(C.SH.UCHOICE, zip_(C.HEADERS[C.SH.UCHOICE], [unitId, c[0], c[1]]));
  });
}

/** デモ単元を「公開中」にする（すぐ試すため） */
function setupPublishDemo() {
  var units = Repo.readAll(C.SH.UNIT);
  if (units.length === 0) { toastUi_('単元がありません。先に初期セットアップを実行してください。'); return; }
  Repo.updateByKey(C.SH.UNIT, 'unit_id', units[0]['unit_id'],
    { '状態': C.UNIT_STATE.OPEN, '更新時刻': Repo.now() });
  toastUi_('単元「' + units[0]['単元名'] + '」を公開中にしました。児童のアプリに表示されます。');
}

/** 記録系（児童のログ）だけ全消去。マスタ・設計は残す。授業のやり直し用 */
function setupClearRecords() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(C.APP_NAME, '目標・選択・進度・方略利用・援助要請・確認タイム・振り返り・フィードバックを全消去します。よろしいですか？', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  C.RECORD_SHEETS.forEach(function (name) {
    var s = Repo.sheet(name);
    if (s.getLastRow() > 1) s.deleteRows(2, s.getLastRow() - 1);
  });
  Repo.dropCache();   // Repo を通さず消したので、読み取りキャッシュを捨てる
  toastUi_('記録系データを消去しました。');
}

/**
 * デモモードの切り替え。
 * オンのあいだは名簿にいる誰でも教師画面と児童画面を行き来でき、
 * 教師専用のガードも外れる。研修・説明会むけで、授業では必ずオフにする。
 */
function setupToggleDemo() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var now = isDemoMode_();

  if (!now) {
    var res = ui.alert(C.APP_NAME,
      'デモモードをオンにします。\n\n' +
      '・名簿にいる人なら誰でも、教師画面と児童画面を行き来できます\n' +
      '・教師だけに許していた操作（単元の編集・モニタ・見取りメモ）も通ります\n\n' +
      '説明会や研修で1つのアカウントから両方を見せるための設定です。\n' +
      '授業で使う前に必ずオフに戻してください。よろしいですか？',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
    props.setProperty(C.DEMO_PROP, 'TRUE');
    toastUi_('デモモードをオンにしました。授業前にオフに戻してください。');
  } else {
    props.setProperty(C.DEMO_PROP, 'FALSE');
    toastUi_('デモモードをオフにしました。役割どおりの画面に戻ります。');
  }
  // メニューの文言を今の状態に合わせて作り直す
  onOpen();
}

/**
 * 決まった選択肢の列をプルダウンにする。
 * 「その他の値も許す」にしてあるので、既に入っている値が消えることはない
 * （打ち間違いには警告の三角が出る）。
 */
function applySheetValidations_(sheet, name, headers) {
  var spec = C.VALIDATIONS[name];
  if (!spec) return;
  var rows = 500;   // 名簿・課題ともこれだけあれば足りる
  Object.keys(spec).forEach(function (col) {
    var ix = headers.indexOf(col);
    if (ix < 0) return;
    try {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(spec[col], true).setAllowInvalid(true).build();
      sheet.getRange(2, ix + 1, rows, 1).setDataValidation(rule);
    } catch (e) { /* 検証が使えなくても入力自体はできる */ }
  });
}

/* ------- 小物 ------- */

/** 見出し配列と値配列を {列:値} に */
function zip_(headers, values) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = (i < values.length ? values[i] : '');
  return o;
}

function toastUi_(msg) {
  SpreadsheetApp.getActive().toast(msg, C.APP_NAME, 6);
}

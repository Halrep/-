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
    // 見出しを常に上書きして整える
    s.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#EDF0EA');
    s.setFrozenRows(1);
    s.autoResizeColumns(1, headers.length);
  });

  // 既定の「シート1」が空なら削除
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) { try { ss.deleteSheet(def); } catch (e) {} }

  seedMastersIfEmpty_();
  seedDemoUnitIfEmpty_();

  SpreadsheetApp.getUi().alert(
    C.APP_NAME,
    'セットアップが完了しました。\n' +
    '・作成したシート: ' + (created.length ? created.join('、') : 'なし（既存を整えました）') + '\n\n' +
    '次に「名簿」シートに児童・教師を登録し、ウェブアプリとしてデプロイしてください。\n' +
    'デモをすぐ試すには、メニューの「デモ用の本時を公開中にする」を実行します。',
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
    ].forEach(function (r) {
      Repo.append(C.SH.STRAT, zip_(C.HEADERS[C.SH.STRAT], r));
    });
  }

  if (Repo.readAll(C.SH.PRESET).length === 0) {
    [
      ['P01', '学習形態', 'ひとりで',           '🧑',           'FALSE'],
      ['P02', '学習形態', 'ペアで',             '🧑‍🤝‍🧑',        'FALSE'],
      ['P03', '学習形態', 'グループで',         '👥',           'FALSE'],
      ['P04', 'ツール',   '教科書',             '📖',           'TRUE'],
      ['P05', 'ツール',   '資料集',             '📚',           'TRUE'],
      ['P06', 'ツール',   'NHK for School',     '🎬',           'TRUE'],
      ['P07', 'ツール',   '白地図',             '🗺',           'TRUE'],
      ['P08', '順序',     '資料を調べてからまとめる',       '🔎', 'FALSE'],
      ['P09', '順序',     'まとめの形を決めてから調べる',   '✍️', 'FALSE'],
      ['P10', '場所',     '自席',               '💺',           'FALSE'],
      ['P11', '場所',     '学びスペース',       '🛋',           'FALSE']
    ].forEach(function (r) {
      Repo.append(C.SH.PRESET, zip_(C.HEADERS[C.SH.PRESET], r));
    });
  }
}

/** 単元が空なら 6年社会のデモ単元・本時・課題・資料を投入 */
function seedDemoUnitIfEmpty_() {
  if (Repo.readAll(C.SH.UNIT).length > 0) return;

  var unitId = Repo.uuid();
  Repo.append(C.SH.UNIT, zip_(C.HEADERS[C.SH.UNIT],
    [unitId, '社会', '6年', '江戸幕府と政治の安定',
     '幕府の政策から、世の中が安定したしくみを説明できる', 7, '公開',
     '「大名支配のしくみ新聞」を作り、幕府が安定した理由を自分の言葉で説明する']));

  var lessonId = Repo.uuid();
  var checklist = [
    '① 資料から幕府の政策を2つ以上見つける',
    '② 白地図に大名の配置を整理する',
    '③ 「なぜ安定したか」の説明文を書く',
    '④ ペアで説明し合い、直す'
  ].join('\n');
  Repo.append(C.SH.LESSON, zip_(C.HEADERS[C.SH.LESSON],
    [lessonId, unitId, 3, '大名を従わせた方法を資料から読み取る',
     '江戸幕府は、どのようにして大名を従わせ、世の中を安定させたのだろう。',
     '参勤交代や武家諸法度などの幕府の政策を資料から読み取り、大名支配のしくみを自分の言葉で説明できる。',
     2, checklist, C.LESSON_STATE.DRAFT, Repo.now(), 10, 'TRUE', '記名']));

  // 開放する選択肢カテゴリ（場所だけ閉じる）
  [['学習形態', 'TRUE'], ['ツール', 'TRUE'], ['順序', 'TRUE'], ['場所', 'FALSE']].forEach(function (c) {
    Repo.append(C.SH.LCHOICE, zip_(C.HEADERS[C.SH.LCHOICE], [lessonId, c[0], c[1]]));
  });

  // おすすめ方略
  [['S01', 'まず全体を見てから、地図や資料を細かく読もう'],
   ['S03', 'ペアで説明し合うと、わかったことがはっきりするよ']].forEach(function (s) {
    Repo.append(C.SH.LSTRAT, zip_(C.HEADERS[C.SH.LSTRAT], [lessonId, s[0], s[1]]));
  });

  // 資料
  [
    ['📖', '教科書 p.96–99「幕府の政治」', '机の上に用意しよう',            '手もと資料', ''],
    ['📚', '資料集 p.42–45「参勤交代の道のり」', '大名行列の絵と地図がのっています', '手もと資料', ''],
    ['🎬', 'NHK for School「参勤交代」', '動画 6:32 ・ イヤホンを使おう',  '動画',       'https://www.nhk.or.jp/school/'],
    ['🗺', '白地図「大名の配置（1664年）」', '自分用のコピーが作られます',   'スライド',   'https://docs.google.com/presentation/'],
    ['🔗', '「武家諸法度」現代語やく', 'むずかしい言葉のいいかえ付き',      'ドキュメント', 'https://docs.google.com/document/']
  ].forEach(function (r) {
    Repo.append(C.SH.LRES, zip_(C.HEADERS[C.SH.LRES],
      [Repo.uuid(), lessonId].concat(r)));
  });
}

/** デモの本時を「公開中」にする（すぐ試すため） */
function setupPublishDemo() {
  var lessons = Repo.readAll(C.SH.LESSON);
  if (lessons.length === 0) { toastUi_('本時がありません。先に初期セットアップを実行してください。'); return; }
  lessons.sort(function (a, b) { return toMs_(a['更新時刻']) - toMs_(b['更新時刻']); });
  var target = lessons[0];
  Repo.updateByKey(C.SH.LESSON, 'lesson_id', target['lesson_id'],
    { '状態': C.LESSON_STATE.OPEN, '更新時刻': Repo.now() });
  toastUi_('本時「' + target['時数'] + '時」を公開中にしました。児童のアプリに表示されます。');
}

/** 記録系（児童のログ）だけ全消去。マスタ・設計は残す。授業のやり直し用 */
function setupClearRecords() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(C.APP_NAME, '目標・選択・進度・方略利用・援助要請・振り返り・フィードバックを全消去します。よろしいですか？', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  [C.SH.GOAL, C.SH.SEL, C.SH.PROG, C.SH.SUSE, C.SH.HELP, C.SH.CHECK, C.SH.REFL, C.SH.FB].forEach(function (name) {
    var s = Repo.sheet(name);
    if (s.getLastRow() > 1) s.deleteRows(2, s.getLastRow() - 1);
  });
  toastUi_('記録系データを消去しました。');
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

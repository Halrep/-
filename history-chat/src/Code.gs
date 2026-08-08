/**
 * Code.gs
 * ウェブアプリの入口と、画面から呼ぶサーバー関数。
 *
 * 画面 → google.script.run → ここ、という一方通行にする。
 * 事実メモや避ける話題、APIキーは、ここから先には出さない。
 */

function doGet(e) {
  var user = Auth.current();
  if (!user) return page_('unauthorized', 'つかえません');

  var wantTeacher = e && e.parameter && e.parameter.view === 'teacher';
  if (wantTeacher && !Auth.isTeacher(user)) return page_('unauthorized', 'つかえません');

  return page_(wantTeacher ? 'teacher' : 'child', C.APP_NAME);
}

function page_(file, title) {
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** css.html などを画面に差し込む */
function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

/* ============================================================
   児童・教師 共通
   ============================================================ */

/** 起動時にまとめて渡す。呼び出し回数を減らすため1回にまとめる */
function apiBootstrap() {
  var user = Auth.requireUser();
  var st = Figures.settings();
  var teacher = Auth.isTeacher(user);

  // 教師は公開していない人物も試せる（デモのため）
  var figures = teacher
    ? Figures.all().map(Figures.forClient)
    : Figures.published();

  var voiceAllowed = teacher || Figures.bool(st['読み上げ_児童に許可']);

  return {
    user: { name: user.name, role: user.role },
    figures: figures,
    settings: {
      watchText:   String(st['見られています'] || ''),
      notice:      String(st['注意書き'] || ''),
      voiceDefault: String(st['読み上げ_既定'] || 'オフ') === 'オン',
      voiceAllowed: voiceAllowed,
      voiceScale:  Figures.num(st['読み上げ_速さ'], 1),
      maxLen:      Figures.num(st['入力文字数上限'], 120),
      maxDay:      Figures.num(st['1日の往復上限'], 30),
      turns:       Figures.num(st['履歴の往復数'], 6)
    },
    remain: (function () {
      var maxDay = Figures.num(st['1日の往復上限'], 30);
      return maxDay > 0 ? Math.max(0, maxDay - Chat.todayTurns(user.id)) : -1;
    })(),
    ready: Chat.hasKey() && String(st['モデル'] || '') !== '',
    teacherUrl: teacher ? ScriptApp.getService().getUrl() + '?view=teacher' : null
  };
}

/** 1往復送る */
function apiSend(figureId, text) {
  var user = Auth.requireUser();
  try {
    return { ok: true, data: Chat.send(user, figureId, text) };
  } catch (err) {
    return { ok: false, error: friendly_(String(err.message || err)) };
  }
}

/** 例外を、子どもに読める言葉にする */
function friendly_(msg) {
  var map = {
    NO_KEY:    'まだ 準備が できていません。先生に つたえてね。',
    NO_MODEL:  'まだ 準備が できていません。先生に つたえてね。',
    BAD_KEY:   'カギの 設定が まちがっています。先生に つたえてね。',
    BAD_MODEL: 'モデルの 設定が まちがっています。先生に つたえてね。',
    QUOTA:     'きょうは たくさん 使われました。しばらく してから ためしてね。',
    BLOCKED:   'その話には こたえられません。べつの ことを きいてみて。',
    EMPTY:     'うまく 返事が できませんでした。もう一度 おくってみて。'
  };
  if (map[msg]) return map[msg];
  if (msg.indexOf('API_') === 0) return 'つながりませんでした。もう一度 おくってみて。';
  return msg;
}

/* ============================================================
   教師画面
   ============================================================ */

/** この鍵で使えるモデルの一覧（教師が選ぶ。こちらでモデル名を決め打ちしない） */
function apiListModels() {
  Auth.requireTeacher();
  try { return { ok: true, data: Chat.listModels() }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
}

function apiSaveSetting(key, value) {
  Auth.requireTeacher();
  var allowed = ['モデル', '1日の往復上限', '入力文字数上限', '履歴の往復数',
                 '読み上げ_既定', '読み上げ_速さ', '読み上げ_児童に許可'];
  if (allowed.indexOf(key) < 0) throw new Error('その設定は変えられません。');
  Figures.setSetting(key, value);
  return { ok: true };
}

/** 人物の公開ON/OFF */
function apiSetOpen(figureId, open) {
  Auth.requireTeacher();
  Repo.updateByKey(C.SHEET.FIGURES, 'figure_id', figureId, { '公開': !!open });
  return { ok: true };
}

/** 教師用：人物の一覧（公開状態つき） */
function apiFiguresForTeacher() {
  Auth.requireTeacher();
  return Figures.all().map(function (f) {
    var c = Figures.forClient(f);
    c.open = f.open;
    c.sources = f.sources;
    c.hasFacts = f.facts !== '';
    return c;
  });
}

/** 準備ができているか（教師画面の点検用） */
function apiHealth() {
  Auth.requireTeacher();
  var st = Figures.settings();
  return {
    hasKey: Chat.hasKey(),
    model: String(st['モデル'] || ''),
    figures: Figures.all().length,
    published: Figures.all().filter(function (f) { return f.open; }).length,
    sheets: Object.keys(C.SHEET).map(function (k) {
      return { name: C.SHEET[k], exists: Repo.exists(C.SHEET[k]) };
    })
  };
}

/**
 * StudentApi.gs
 * 児童向けサーバー関数。すべて google.script.run から呼ばれる。
 * 入口で requireUser_() し、書き込みは Repo（Lock）経由。
 */

/**
 * 児童アプリの初期状態をまとめて返す。
 * 本時・課題・資料・開放された選択肢・おすすめ方略・自分の目標/選択/進度/方略利用/こまった/振り返り。
 */
function student_getState() {
  var ctx = requireUser_();
  var uid = ctx.user.userId;

  var lesson = currentLesson_();
  if (!lesson) {
    return { ok: true, hasLesson: false, me: ctx.user };
  }
  var lessonId = lesson['lesson_id'];
  var unit = firstWhere_(C.SH.UNIT, { unit_id: lesson['unit_id'] });

  // マスタ（キャッシュ）
  var strat = getStrategiesMap_();
  var presets = Repo.readAll(C.SH.PRESET);

  // 開放されているカテゴリ
  var openCats = {};
  Repo.where(C.SH.LCHOICE, { lesson_id: lessonId }).forEach(function (c) {
    openCats[c['カテゴリ']] = truthy_(c['開放']);
  });
  // カテゴリ順にまとめた選択肢（開放されているものだけ）
  var catOrder = ['学習形態', 'ツール', '順序', '場所'];
  var choices = catOrder.filter(function (cat) { return openCats[cat]; }).map(function (cat) {
    var opts = presets.filter(function (p) { return p['カテゴリ'] === cat; })
      .map(function (p) { return { label: p['ラベル'], icon: p['アイコン'] }; });
    var multi = presets.some(function (p) { return p['カテゴリ'] === cat && truthy_(p['複数選択可']); });
    return { category: cat, multi: multi, options: opts };
  });

  // おすすめ方略（本時に紐づくもの）＋方略詳細
  var recommended = Repo.where(C.SH.LSTRAT, { lesson_id: lessonId }).map(function (ls) {
    var s = strat[ls['strategy_id']] || {};
    return {
      strategyId: ls['strategy_id'], name: s['カード名'], desc: s['説明'],
      icon: s['アイコン'], category: s['分類'], teacherNote: ls['教師の一言'], recommended: true
    };
  });
  // 全方略も渡す（Regulateで自由に選べるように）
  var allStrat = Object.keys(strat).map(function (id) {
    var s = strat[id];
    return { strategyId: id, name: s['カード名'], desc: s['説明'], icon: s['アイコン'], category: s['分類'] };
  });

  // 資料
  var resources = Repo.where(C.SH.LRES, { lesson_id: lessonId }).map(function (r) {
    return { icon: r['アイコン'], title: r['タイトル'], sub: r['補足'], kind: r['種別'], url: r['URL'] };
  });

  // 自分の記録
  var myGoal = firstWhere_(C.SH.GOAL, { lesson_id: lessonId, user_id: uid });
  var mySelections = latestSelectionByCategory_(lessonId, uid);
  var myProgress = Repo.where(C.SH.PROG, { lesson_id: lessonId, user_id: uid });
  var progMap = {};
  myProgress.forEach(function (p) { progMap[String(p['項目index'])] = Number(p['状態']); });
  var myUse = {};
  Repo.where(C.SH.SUSE, { lesson_id: lessonId, user_id: uid }).forEach(function (u) {
    myUse[u['strategy_id']] = truthy_(u['状態']);
  });
  var myHelp = firstWhere_(C.SH.HELP, { lesson_id: lessonId, user_id: uid });
  var myRefl = firstWhere_(C.SH.REFL, { lesson_id: lessonId, user_id: uid });

  var checklist = parseChecklist_(lesson['進度チェック項目']).map(function (name, i) {
    return { index: i, name: name, status: progMap[String(i)] || 0 };
  });

  // ④ 確認タイム：これまでの自己確認の記録
  var myChecks = Repo.where(C.SH.CHECK, { lesson_id: lessonId, user_id: uid }).map(function (c) {
    return { elapsedMin: c['経過分'], status: c['状態'], memo: c['メモ'], atMs: toMs_(c['時刻']) };
  }).sort(function (a, b) { return a.atMs - b.atMs; });

  return {
    ok: true,
    hasLesson: true,
    me: ctx.user,
    lesson: {
      lessonId: lessonId,
      subject: unit ? unit['教科'] : '',
      grade: unit ? unit['学年'] : '',
      unitName: unit ? unit['単元名'] : '',
      unitGoal: unit ? unit['単元目標'] : '',           // ① 単元の目標
      outcome: unit ? unit['成果物イメージ'] : '',       // ① 単元の「出口」＝作り出すもの
      period: lesson['時数'],
      total: unit ? unit['総時数'] : '',
      task: lesson['学習課題'],
      goal: lesson['ゴール'],
      discretion: lesson['裁量レベル'],
      checkInterval: Number(lesson['確認タイム間隔']) || 0  // ④ 確認タイムの間隔（分）
    },
    resources: resources,
    choices: choices,
    recommendedStrategies: recommended,
    allStrategies: allStrat,
    checklist: checklist,
    my: {
      goal: myGoal ? {
        be: myGoal['Be'], doText: myGoal['Do'], regulate: splitCsv_(myGoal['Regulate']),
        efficacy: myGoal['自己効力感'] === '' ? null : Number(myGoal['自己効力感'])  // ② 自己効力感
      } : null,
      selections: mySelections,          // {カテゴリ: 値 or [値...]}
      strategyUse: myUse,                // {strategyId: bool}
      help: myHelp ? truthy_(myHelp['状態']) : false,
      checkpoints: myChecks,             // ④ これまでの確認タイム
      reflection: myRefl ? reflToObj_(myRefl) : null
    }
  };
}

/** 目標を保存（見通すフェーズ）。1児童1レコードで upsert。efficacy=自己効力感(0-100)は任意 */
function student_saveGoal(be, doText, regulateIds, efficacy) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var now = Repo.now();
  var match = { lesson_id: lesson['lesson_id'], user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.GOAL, match);
  Repo.upsert(C.SH.GOAL, match, {
    goal_id: existing ? existing['goal_id'] : Repo.uuid(),
    Be: be || '',
    Do: doText || '',
    Regulate: (regulateIds || []).join(','),
    '自己効力感': (efficacy === undefined || efficacy === null) ? (existing ? existing['自己効力感'] : '') : efficacy,
    '作成時刻': existing ? existing['作成時刻'] : now,
    '更新時刻': now
  });
  return { ok: true };
}

/** ④ 確認タイムの記録（実行中の自己確認）。経過分・状態(順調/調整する)・任意メモ */
function student_saveCheckpoint(elapsedMin, status, memo) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  Repo.append(C.SH.CHECK, {
    check_id: Repo.uuid(),
    lesson_id: lesson['lesson_id'],
    user_id: ctx.user.userId,
    '経過分': elapsedMin,
    '状態': status,       // '順調' | '調整する'
    'メモ': memo || '',
    '時刻': Repo.now()
  });
  return { ok: true };
}

/** 学び方の選択を記録（実行フェーズ）。変更前の値も残して調整の履歴にする */
function student_saveSelection(category, value) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var uid = ctx.user.userId, lessonId = lesson['lesson_id'];
  var prev = latestSelectionRaw_(lessonId, uid, category);
  Repo.append(C.SH.SEL, {
    selection_id: Repo.uuid(),
    lesson_id: lessonId,
    user_id: uid,
    'カテゴリ': category,
    '選んだ値': value,                       // 複数選択は "a,b" の文字列で受ける
    '変更前の値': prev ? prev['選んだ値'] : '',
    '選択時刻': Repo.now()
  });
  return { ok: true };
}

/** 進度チェックの状態変更（0/1/2）。項目index単位で upsert */
function student_setProgress(index, status, itemName) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var match = { lesson_id: lesson['lesson_id'], user_id: ctx.user.userId, '項目index': index };
  var existing = firstWhere_(C.SH.PROG, match);
  Repo.upsert(C.SH.PROG, match, {
    progress_id: existing ? existing['progress_id'] : Repo.uuid(),
    '項目名': itemName || (existing ? existing['項目名'] : ''),
    '状態': status,
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 方略カードを「つかった！」/取り消し */
function student_useStrategy(strategyId, on) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var match = { lesson_id: lesson['lesson_id'], user_id: ctx.user.userId, strategy_id: strategyId };
  var existing = firstWhere_(C.SH.SUSE, match);
  Repo.upsert(C.SH.SUSE, match, {
    use_id: existing ? existing['use_id'] : Repo.uuid(),
    '状態': on ? 'TRUE' : 'FALSE',
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** こまったサインのオン/オフ */
function student_raiseHelp(on) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var match = { lesson_id: lesson['lesson_id'], user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.HELP, match);
  Repo.upsert(C.SH.HELP, match, {
    help_id: existing ? existing['help_id'] : Repo.uuid(),
    '状態': on ? 'TRUE' : 'FALSE',
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 振り返りを保存（振り返るフェーズ）。1児童1レコード */
function student_saveReflection(payload) {
  var ctx = requireUser_();
  var lesson = requireCurrentLesson_();
  var now = Repo.now();
  var match = { lesson_id: lesson['lesson_id'], user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.REFL, match);
  Repo.upsert(C.SH.REFL, match, {
    reflection_id: existing ? existing['reflection_id'] : Repo.uuid(),
    '達成度': payload.achievement,
    '自己評価': payload.selfEval || '',
    '原因帰属良': (payload.attrGood || []).join(','),
    '原因帰属難': (payload.attrHard || []).join(','),
    '気持ち': payload.mood || '',
    '次への適用': payload.nextPlan || '',
    '共有': existing ? existing['共有'] : 'FALSE',
    '記録時刻': existing ? existing['記録時刻'] : now,
    '更新時刻': now
  });
  return { ok: true };
}

/** ポートフォリオ：同じ単元での自分の過去の振り返り＋先生からのコメント */
function student_getPortfolio() {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var lesson = currentLesson_();
  var unitId = lesson ? lesson['unit_id'] : null;

  var lessonsById = {};
  Repo.readAll(C.SH.LESSON).forEach(function (l) { lessonsById[l['lesson_id']] = l; });

  var refls = Repo.where(C.SH.REFL, { user_id: uid }).filter(function (r) {
    var l = lessonsById[r['lesson_id']];
    return l && (!unitId || l['unit_id'] === unitId);
  });

  var fbByLesson = {};
  Repo.where(C.SH.FB, { to_user_id: uid }).forEach(function (f) {
    (fbByLesson[f['lesson_id']] = fbByLesson[f['lesson_id']] || []).push(f['コメント']);
  });

  var items = refls.map(function (r) {
    var l = lessonsById[r['lesson_id']];
    return {
      period: l ? l['時数'] : '',
      achievement: r['達成度'],
      mood: r['気持ち'],
      selfEval: r['自己評価'],
      nextPlan: r['次への適用'],
      feedback: fbByLesson[r['lesson_id']] || [],
      updatedMs: toMs_(r['更新時刻'])
    };
  });
  items.sort(function (a, b) { return Number(b.period) - Number(a.period); });
  return { ok: true, items: items };
}

/* ------- StudentApi 内ヘルパー ------- */

function requireCurrentLesson_() {
  var l = currentLesson_();
  if (!l) throw new Error('いま公開されている授業がありません。');
  return l;
}

function firstWhere_(name, match) {
  var rows = Repo.where(name, match);
  return rows.length ? rows[0] : null;
}

function splitCsv_(v) {
  if (!v) return [];
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/** 方略マスタを {id: row} のマップでキャッシュ取得 */
function getStrategiesMap_() {
  var map = {};
  Repo.readAll(C.SH.STRAT).forEach(function (s) { map[s['strategy_id']] = s; });
  return map;
}

/** カテゴリごとの最新の選択（生の行）を返す */
function latestSelectionRaw_(lessonId, uid, category) {
  var rows = Repo.where(C.SH.SEL, { lesson_id: lessonId, user_id: uid, 'カテゴリ': category });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return toMs_(b['選択時刻']) - toMs_(a['選択時刻']); });
  return rows[0];
}

/** カテゴリ→現在値 のマップ（複数選択は配列に） */
function latestSelectionByCategory_(lessonId, uid) {
  var rows = Repo.where(C.SH.SEL, { lesson_id: lessonId, user_id: uid });
  var byCat = {};
  rows.forEach(function (r) {
    var cat = r['カテゴリ'];
    if (!byCat[cat] || toMs_(r['選択時刻']) > toMs_(byCat[cat]['選択時刻'])) byCat[cat] = r;
  });
  var out = {};
  Object.keys(byCat).forEach(function (cat) {
    var v = byCat[cat]['選んだ値'];
    out[cat] = String(v).indexOf(',') >= 0 ? splitCsv_(v) : v;
  });
  return out;
}

function reflToObj_(r) {
  return {
    achievement: r['達成度'],
    selfEval: r['自己評価'],
    attrGood: splitCsv_(r['原因帰属良']),
    attrHard: splitCsv_(r['原因帰属難']),
    mood: r['気持ち'],
    nextPlan: r['次への適用']
  };
}

/**
 * TeacherApi.gs
 * 教師向けサーバー関数。入口で requireTeacher_()。
 */

/** 教師アプリの初期情報（本人・現在の本時メタ・セットアップ済みか） */
function teacher_bootstrap() {
  var ctx = requireTeacher_();
  var lesson = currentLesson_();
  return {
    ok: true,
    me: ctx.user,
    lessonMeta: lesson ? lessonMeta_(lesson) : null
  };
}

/**
 * 授業モニタ。公開中の本時について、児童ごとのタイル情報を返す。
 * Phase1は全員分を毎回返す（30人規模なら軽量）。since を後で差分化できる形に留めてある。
 */
function teacher_getMonitor() {
  requireTeacher_();
  var lesson = currentLesson_();
  if (!lesson) return { ok: true, hasLesson: false };
  var lessonId = lesson['lesson_id'];
  var now = Date.now();

  var students = Repo.readAll(C.SH.USERS).filter(function (u) { return u['役割'] === C.ROLE.STUDENT; });
  var checklistLen = parseChecklist_(lesson['進度チェック項目']).length;

  // 一括読み込みしてメモリで結合
  var goals = indexBy_(Repo.where(C.SH.GOAL, { lesson_id: lessonId }), 'user_id');
  var help = indexBy_(Repo.where(C.SH.HELP, { lesson_id: lessonId }), 'user_id');
  var refl = indexBy_(Repo.where(C.SH.REFL, { lesson_id: lessonId }), 'user_id');
  var progByUser = groupBy_(Repo.where(C.SH.PROG, { lesson_id: lessonId }), 'user_id');
  var selByUser = groupBy_(Repo.where(C.SH.SEL, { lesson_id: lessonId }), 'user_id');
  var useByUser = groupBy_(Repo.where(C.SH.SUSE, { lesson_id: lessonId }), 'user_id');

  var tiles = students.map(function (u) {
    var uid = u['user_id'];
    var g = goals[uid];
    var h = help[uid];
    var progs = progByUser[uid] || [];
    var sels = selByUser[uid] || [];
    var uses = useByUser[uid] || [];

    var doneCount = progs.filter(function (p) { return Number(p['状態']) === C.PROGRESS.DONE; }).length;
    var helpOn = h && truthy_(h['状態']);
    var hasStarted = !!g || progs.some(function (p) { return Number(p['状態']) > 0; }) || sels.length > 0;

    // 最終操作時刻
    var last = 0;
    if (g) last = Math.max(last, toMs_(g['更新時刻']));
    if (h) last = Math.max(last, toMs_(h['更新時刻']));
    progs.forEach(function (p) { last = Math.max(last, toMs_(p['更新時刻'])); });
    sels.forEach(function (s) { last = Math.max(last, toMs_(s['選択時刻'])); });
    uses.forEach(function (x) { last = Math.max(last, toMs_(x['更新時刻'])); });
    if (refl[uid]) last = Math.max(last, toMs_(refl[uid]['更新時刻']));

    var idleMin = last ? Math.floor((now - last) / 60000) : null;
    var done = checklistLen > 0 && doneCount >= checklistLen;

    var status;
    if (helpOn) status = 'help';
    else if (done) status = 'done';
    else if (!hasStarted) status = 'none';
    else if (idleMin !== null && idleMin >= C.IDLE_MINUTES) status = 'idle';
    else status = 'busy';

    // 学習形態（最新の選択）
    var form = latestOf_(sels, '学習形態');

    return {
      userId: uid,
      number: u['出席番号'],
      name: u['表示名'] || u['氏名'],
      status: status,
      doneCount: doneCount,
      total: checklistLen,
      form: form || '',
      idleMin: idleMin,
      helpOn: helpOn
    };
  });

  // 出席番号順
  tiles.sort(function (a, b) { return Number(a.number) - Number(b.number); });

  var counts = { busy: 0, done: 0, help: 0, idle: 0, none: 0 };
  tiles.forEach(function (t) { counts[t.status]++; });

  // ③ 調整層 I/You/We（学習形態の最新選択から集計）
  var regulation = { I: 0, You: 0, We: 0, none: 0 };
  students.forEach(function (u) {
    var form = latestOf_(selByUser[u['user_id']] || [], '学習形態');
    if (form === 'ひとりで') regulation.I++;
    else if (form === 'ペアで') regulation.You++;
    else if (form === 'グループで') regulation.We++;
    else regulation.none++;
  });

  return {
    ok: true,
    hasLesson: true,
    serverMs: now,
    meta: lessonMeta_(lesson),
    counts: counts,
    regulation: regulation,
    tiles: tiles
  };
}

/** 児童1人の詳細（モニタでタイルを開いたとき） */
function teacher_getStudentDetail(userId) {
  requireTeacher_();
  var lesson = currentLesson_();
  if (!lesson) return { ok: true, hasLesson: false };
  var lessonId = lesson['lesson_id'];
  var strat = getStrategiesMap_();

  var g = firstWhere_(C.SH.GOAL, { lesson_id: lessonId, user_id: userId });
  var sels = latestSelectionByCategory_(lessonId, userId);
  var progs = Repo.where(C.SH.PROG, { lesson_id: lessonId, user_id: userId });
  var progMap = {};
  progs.forEach(function (p) { progMap[String(p['項目index'])] = Number(p['状態']); });
  var checklist = parseChecklist_(lesson['進度チェック項目']).map(function (n, i) {
    return { name: n, status: progMap[String(i)] || 0 };
  });
  var help = firstWhere_(C.SH.HELP, { lesson_id: lessonId, user_id: userId });
  var checks = Repo.where(C.SH.CHECK, { lesson_id: lessonId, user_id: userId }).map(function (c) {
    return { elapsedMin: c['経過分'], status: c['状態'], memo: c['メモ'] };
  });

  var regulateNames = g ? splitCsv_(g['Regulate']).map(function (id) {
    return strat[id] ? (strat[id]['アイコン'] + ' ' + strat[id]['カード名']) : id;
  }) : [];
  var usedNames = Repo.where(C.SH.SUSE, { lesson_id: lessonId, user_id: userId })
    .filter(function (u) { return truthy_(u['状態']); })
    .map(function (u) { return strat[u['strategy_id']] ? strat[u['strategy_id']]['カード名'] : u['strategy_id']; });

  var u = firstWhere_(C.SH.USERS, { user_id: userId });

  return {
    ok: true,
    hasLesson: true,
    userId: userId,
    name: u ? (u['表示名'] || u['氏名']) : userId,
    number: u ? u['出席番号'] : '',
    help: help ? truthy_(help['状態']) : false,
    goal: g ? { be: g['Be'], doText: g['Do'], efficacy: (g['自己効力感'] === '' ? null : Number(g['自己効力感'])) } : null,
    regulateNames: regulateNames,
    usedNames: usedNames,
    selections: sels,
    checklist: checklist,
    checkpoints: checks
  };
}

/** フィードバック送信 */
function teacher_sendFeedback(toUserId, comment) {
  var ctx = requireTeacher_();
  var lesson = requireCurrentLesson_();
  if (!comment || !String(comment).trim()) throw new Error('コメントが空です。');
  Repo.append(C.SH.FB, {
    feedback_id: Repo.uuid(),
    lesson_id: lesson['lesson_id'],
    from_user_id: ctx.user.userId,
    to_user_id: toUserId,
    'コメント': comment,
    '既読': 'FALSE',
    '送信時刻': Repo.now()
  });
  return { ok: true };
}

/** 本時デザイン画面用：本時の全情報＋マスタ＋本時一覧 */
function teacher_getDesign(lessonId) {
  requireTeacher_();
  var lessons = Repo.readAll(C.SH.LESSON);
  if (lessons.length === 0) return { ok: true, hasLesson: false };

  var lesson = lessonId ? firstWhere_(C.SH.LESSON, { lesson_id: lessonId }) : (currentLesson_() || newestLesson_(lessons));
  if (!lesson) lesson = newestLesson_(lessons);
  var unit = firstWhere_(C.SH.UNIT, { unit_id: lesson['unit_id'] });

  var openCats = {};
  Repo.where(C.SH.LCHOICE, { lesson_id: lesson['lesson_id'] }).forEach(function (c) {
    openCats[c['カテゴリ']] = truthy_(c['開放']);
  });

  var strat = getStrategiesMap_();
  var linked = {};
  Repo.where(C.SH.LSTRAT, { lesson_id: lesson['lesson_id'] }).forEach(function (ls) { linked[ls['strategy_id']] = true; });

  var resources = Repo.where(C.SH.LRES, { lesson_id: lesson['lesson_id'] }).map(function (r) {
    return { icon: r['アイコン'], title: r['タイトル'], sub: r['補足'], kind: r['種別'], url: r['URL'] };
  });

  return {
    ok: true,
    hasLesson: true,
    lessonList: lessons.sort(function (a, b) { return Number(a['時数']) - Number(b['時数']); })
      .map(function (l) { return { lessonId: l['lesson_id'], period: l['時数'], state: l['状態'], title: l['本時の目標'] }; }),
    lesson: {
      lessonId: lesson['lesson_id'],
      unitName: unit ? unit['単元名'] : '',
      period: lesson['時数'],
      objective: lesson['本時の目標'],
      task: lesson['学習課題'],
      goal: lesson['ゴール'],
      discretion: String(lesson['裁量レベル']),
      checklist: lesson['進度チェック項目'],
      checkInterval: Number(lesson['確認タイム間隔']) || 0,
      peerRef: truthy_(lesson['他者参照']),
      peerAnon: lesson['他者参照モード'] === '匿名',
      state: lesson['状態']
    },
    openCats: openCats,
    strategies: Object.keys(strat).map(function (id) {
      var s = strat[id];
      return { strategyId: id, name: s['カード名'], icon: s['アイコン'], category: s['分類'], linked: !!linked[id] };
    }),
    resources: resources
  };
}

/** 本時の中核フィールドを更新 */
function teacher_updateLesson(lessonId, patch) {
  requireTeacher_();
  var allowed = ['本時の目標', '学習課題', 'ゴール', '裁量レベル', '進度チェック項目', '確認タイム間隔'];
  var clean = {};
  allowed.forEach(function (k) { if (patch.hasOwnProperty(k)) clean[k] = patch[k]; });
  clean['更新時刻'] = Repo.now();
  Repo.updateByKey(C.SH.LESSON, 'lesson_id', lessonId, clean);
  return { ok: true };
}

/** 実行中の他者参照の有効化と、記名/匿名モードの設定 */
function teacher_setPeerRef(lessonId, on, anon) {
  requireTeacher_();
  Repo.updateByKey(C.SH.LESSON, 'lesson_id', lessonId, {
    '他者参照': on ? 'TRUE' : 'FALSE',
    '他者参照モード': anon ? '匿名' : '記名',
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 選択肢カテゴリの開放/非開放 */
function teacher_setChoice(lessonId, category, open) {
  requireTeacher_();
  Repo.upsert(C.SH.LCHOICE, { lesson_id: lessonId, 'カテゴリ': category }, { '開放': open ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/** おすすめ方略の紐づけ ON/OFF */
function teacher_setStrategyLink(lessonId, strategyId, on) {
  requireTeacher_();
  if (on) {
    var exists = firstWhere_(C.SH.LSTRAT, { lesson_id: lessonId, strategy_id: strategyId });
    if (!exists) Repo.append(C.SH.LSTRAT, { lesson_id: lessonId, strategy_id: strategyId, '教師の一言': '' });
  } else {
    // 該当行を削除
    var rows = Repo.where(C.SH.LSTRAT, { lesson_id: lessonId, strategy_id: strategyId });
    if (rows.length) {
      var s = Repo.sheet(C.SH.LSTRAT);
      // 下の行から消す
      rows.sort(function (a, b) { return b.__row - a.__row; }).forEach(function (r) { s.deleteRow(r.__row); });
    }
  }
  return { ok: true };
}

/** 本時の状態を変更（下書き/公開中/終了）。公開は1件に絞る運用のため、他の公開中を終了にする */
function teacher_setLessonState(lessonId, state) {
  requireTeacher_();
  if (state === C.LESSON_STATE.OPEN) {
    Repo.readAll(C.SH.LESSON).forEach(function (l) {
      if (l['lesson_id'] !== lessonId && l['状態'] === C.LESSON_STATE.OPEN) {
        Repo.updateByKey(C.SH.LESSON, 'lesson_id', l['lesson_id'], { '状態': C.LESSON_STATE.CLOSED, '更新時刻': Repo.now() });
      }
    });
  }
  Repo.updateByKey(C.SH.LESSON, 'lesson_id', lessonId, { '状態': state, '更新時刻': Repo.now() });
  return { ok: true };
}

/** ふりかえり一覧（指定した本時。未指定なら現在の本時） */
function teacher_getReflections(lessonId) {
  requireTeacher_();
  var lesson = lessonId ? firstWhere_(C.SH.LESSON, { lesson_id: lessonId }) : currentLesson_();
  if (!lesson) return { ok: true, hasLesson: false };
  var lid = lesson['lesson_id'];

  var students = Repo.readAll(C.SH.USERS).filter(function (u) { return u['役割'] === C.ROLE.STUDENT; });
  var refl = indexBy_(Repo.where(C.SH.REFL, { lesson_id: lid }), 'user_id');

  var rows = students.map(function (u) {
    var r = refl[u['user_id']];
    return {
      userId: u['user_id'],
      number: u['出席番号'],
      name: u['表示名'] || u['氏名'],
      hasRefl: !!r,
      achievement: r ? r['達成度'] : null,
      mood: r ? r['気持ち'] : '',
      attrGood: r ? splitCsv_(r['原因帰属良']) : [],
      attrHard: r ? splitCsv_(r['原因帰属難']) : [],
      selfEval: r ? r['自己評価'] : '',
      nextPlan: r ? r['次への適用'] : '',
      shared: r ? truthy_(r['共有']) : false
    };
  });
  rows.sort(function (a, b) { return Number(a.number) - Number(b.number); });
  return { ok: true, hasLesson: true, lessonId: lid, period: lesson['時数'], rows: rows };
}

/** 「みんなの工夫」への共有トグル */
function teacher_toggleShare(userId, lessonId, share) {
  requireTeacher_();
  Repo.upsert(C.SH.REFL, { lesson_id: lessonId, user_id: userId }, { '共有': share ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/* ------- TeacherApi 内ヘルパー ------- */

function lessonMeta_(lesson) {
  var unit = firstWhere_(C.SH.UNIT, { unit_id: lesson['unit_id'] });
  return {
    lessonId: lesson['lesson_id'],
    unitName: unit ? unit['単元名'] : '',
    subject: unit ? unit['教科'] : '',
    grade: unit ? unit['学年'] : '',
    period: lesson['時数'],
    total: unit ? unit['総時数'] : '',
    state: lesson['状態']
  };
}

function newestLesson_(lessons) {
  return lessons.slice().sort(function (a, b) { return toMs_(b['更新時刻']) - toMs_(a['更新時刻']); })[0];
}

function indexBy_(arr, key) {
  var m = {};
  arr.forEach(function (r) { m[r[key]] = r; });
  return m;
}

function groupBy_(arr, key) {
  var m = {};
  arr.forEach(function (r) { (m[r[key]] = m[r[key]] || []).push(r); });
  return m;
}

/** 選択行配列から指定カテゴリの最新値 */
function latestOf_(sels, category) {
  var rows = sels.filter(function (s) { return s['カテゴリ'] === category; });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return toMs_(b['選択時刻']) - toMs_(a['選択時刻']); });
  return rows[0]['選んだ値'];
}

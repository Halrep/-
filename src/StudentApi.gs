/**
 * StudentApi.gs
 * 児童向けサーバー関数。すべて google.script.run から呼ばれる。
 * 入口で requireUser_() し、書き込みは Repo（Lock）経由。
 *
 * 単元内自由進度学習のため、児童は「単元の課題プール」から
 * 自分のペース・順序で課題を選んで進む。進度・選択・方略利用は課題ごとに記録する。
 */

/** 児童アプリの初期状態をまとめて返す */
function student_getState() {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var day = today_();

  var unit = currentUnit_();
  if (!unit) return { ok: true, hasUnit: false, me: ctx.user };
  var unitId = unit['unit_id'];

  var strat = getStrategiesMap_();

  // --- 課題（公開されているものだけ／並び順） ---
  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId })
    .filter(function (t) { return truthy_(t['公開']); })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); });

  // --- 資料（課題ごと＋いつでも使える） ---
  var resAll = Repo.where(C.SH.RES, { unit_id: unitId }).filter(function (r) { return truthy_(r['公開']); });
  var resByTask = {}, resCommon = [];
  resAll.forEach(function (r) {
    var item = { icon: r['アイコン'], title: r['タイトル'], sub: r['補足'], kind: r['種別'], url: r['URL'] };
    if (r['task_id']) (resByTask[r['task_id']] = resByTask[r['task_id']] || []).push(item);
    else resCommon.push(item);
  });

  // --- 推奨方略（課題ごと＋単元共通） ---
  var stByTask = {}, stCommon = [];
  Repo.where(C.SH.USTRAT, { unit_id: unitId }).forEach(function (s) {
    var m = strat[s['strategy_id']];
    if (!m) return;
    var item = {
      strategyId: s['strategy_id'], name: m['カード名'], desc: m['説明'],
      icon: m['アイコン'], category: m['分類'], teacherNote: s['教師の一言']
    };
    if (s['task_id']) (stByTask[s['task_id']] = stByTask[s['task_id']] || []).push(item);
    else stCommon.push(item);
  });

  // --- 開放された選択肢 ---
  var openCats = {};
  Repo.where(C.SH.UCHOICE, { unit_id: unitId }).forEach(function (c) {
    openCats[c['カテゴリ']] = truthy_(c['開放']);
  });
  var presets = Repo.readAll(C.SH.PRESET);
  var choices = ['学習形態', 'ツール', '場所'].filter(function (cat) { return openCats[cat]; })
    .map(function (cat) {
      return {
        category: cat,
        multi: presets.some(function (p) { return p['カテゴリ'] === cat && truthy_(p['複数選択可']); }),
        options: presets.filter(function (p) { return p['カテゴリ'] === cat; })
          .map(function (p) { return { label: p['ラベル'], icon: p['アイコン'] }; })
      };
    });

  // --- 自分の記録 ---
  var progMap = {};
  Repo.where(C.SH.PROG, { unit_id: unitId, user_id: uid }).forEach(function (p) {
    progMap[p['task_id']] = Number(p['状態']);
  });
  var useMap = {};
  Repo.where(C.SH.SUSE, { unit_id: unitId, user_id: uid }).forEach(function (u) {
    (useMap[u['task_id']] = useMap[u['task_id']] || {})[u['strategy_id']] = truthy_(u['状態']);
  });
  var selMap = latestSelectionsByTask_(unitId, uid);

  var taskPayload = tasks.map(function (t) {
    var tid = t['task_id'];
    return {
      taskId: tid,
      order: t['並び'],
      kind: t['種別'],
      title: t['タイトル'],
      desc: t['説明'],
      mins: t['めやす分'],
      status: progMap[tid] || 0,
      resources: resByTask[tid] || [],
      strategies: stByTask[tid] || [],
      selections: selMap[tid] || {},
      strategyUse: useMap[tid] || {}
    };
  });

  var myGoal = firstWhere_(C.SH.GOAL, { unit_id: unitId, user_id: uid, '日付': day });
  var myHelp = firstWhere_(C.SH.HELP, { unit_id: unitId, user_id: uid });
  var myRefl = firstWhere_(C.SH.REFL, { unit_id: unitId, user_id: uid, '日付': day });
  var myChecks = Repo.where(C.SH.CHECK, { unit_id: unitId, user_id: uid, '日付': day })
    .map(function (c) { return { elapsedMin: c['経過分'], status: c['状態'], memo: c['メモ'], atMs: toMs_(c['時刻']) }; })
    .sort(function (a, b) { return a.atMs - b.atMs; });

  var mustDone = taskPayload.filter(function (t) { return t.kind === C.TASK_KIND.MUST && t.status === C.PROGRESS.DONE; }).length;
  var mustTotal = taskPayload.filter(function (t) { return t.kind === C.TASK_KIND.MUST; }).length;

  return {
    ok: true,
    hasUnit: true,
    me: ctx.user,
    unit: {
      unitId: unitId,
      subject: unit['教科'],
      grade: unit['学年'],
      unitName: unit['単元名'],
      unitGoal: unit['単元目標'],
      outcome: unit['成果物イメージ'],
      totalHours: unit['総時数'],
      discretion: unit['裁量レベル'],
      checkInterval: Number(unit['確認タイム間隔']) || 0,
      peerRef: truthy_(unit['他者参照']),
      peerAnon: unit['他者参照モード'] === '匿名'
    },
    tasks: taskPayload,
    commonResources: resCommon,
    commonStrategies: stCommon,
    allStrategies: Object.keys(strat).map(function (id) {
      var s = strat[id];
      return { strategyId: id, name: s['カード名'], desc: s['説明'], icon: s['アイコン'], category: s['分類'] };
    }),
    choices: choices,
    mustProgress: { done: mustDone, total: mustTotal },
    my: {
      goal: myGoal ? {
        be: myGoal['Be'], doText: myGoal['Do'], regulate: splitCsv_(myGoal['Regulate']),
        efficacy: myGoal['自己効力感'] === '' ? null : Number(myGoal['自己効力感'])
      } : null,
      help: myHelp ? truthy_(myHelp['状態']) : false,
      checkpoints: myChecks,
      reflection: myRefl ? reflToObj_(myRefl) : null
    }
  };
}

/** きょうの計画（目標）を保存。1人1日1件 */
function student_saveGoal(be, doText, regulateIds, efficacy) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  var now = Repo.now(), day = today_();
  var match = { unit_id: unit['unit_id'], user_id: ctx.user.userId, '日付': day };
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

/** 課題ごとの取り組み方を記録。変更前の値も残して調整の履歴にする */
function student_saveSelection(taskId, category, value) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  var unitId = unit['unit_id'], uid = ctx.user.userId;
  var prev = latestSelectionRaw_(unitId, taskId, uid, category);
  Repo.append(C.SH.SEL, {
    selection_id: Repo.uuid(),
    unit_id: unitId,
    task_id: taskId,
    user_id: uid,
    'カテゴリ': category,
    '選んだ値': value,
    '変更前の値': prev ? prev['選んだ値'] : '',
    '選択時刻': Repo.now()
  });
  return { ok: true };
}

/** 課題の進度（0未着手/1取組中/2完了） */
function student_setProgress(taskId, status) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], task_id: taskId, user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.PROG, match);
  Repo.upsert(C.SH.PROG, match, {
    progress_id: existing ? existing['progress_id'] : Repo.uuid(),
    '状態': status,
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 課題ごとの方略カードを「つかった！」/取り消し */
function student_useStrategy(taskId, strategyId, on) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], task_id: taskId, user_id: ctx.user.userId, strategy_id: strategyId };
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
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.HELP, match);
  Repo.upsert(C.SH.HELP, match, {
    help_id: existing ? existing['help_id'] : Repo.uuid(),
    '状態': on ? 'TRUE' : 'FALSE',
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 確認タイムの記録（実行中の自己確認） */
function student_saveCheckpoint(elapsedMin, status, memo) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  Repo.append(C.SH.CHECK, {
    check_id: Repo.uuid(),
    unit_id: unit['unit_id'],
    user_id: ctx.user.userId,
    '日付': today_(),
    '経過分': elapsedMin,
    '状態': status,   // '順調' | '調整する'
    'メモ': memo || '',
    '時刻': Repo.now()
  });
  return { ok: true };
}

/** きょうの振り返りを保存。1人1日1件 */
function student_saveReflection(payload) {
  var ctx = requireUser_();
  var unit = requireCurrentUnit_();
  var now = Repo.now(), day = today_();
  var match = { unit_id: unit['unit_id'], user_id: ctx.user.userId, '日付': day };
  var existing = firstWhere_(C.SH.REFL, match);
  Repo.upsert(C.SH.REFL, match, {
    reflection_id: existing ? existing['reflection_id'] : Repo.uuid(),
    '達成度': payload.achievement,
    '計画とのズレ': payload.planGap || '',
    'ズレの理由': payload.planGapReason || '',
    '自己評価': payload.selfEval || '',
    '原因帰属良': (payload.attrGood || []).join(','),
    '原因帰属難': (payload.attrHard || []).join(','),
    '教材リクエスト': payload.materialRequest || '',
    '気持ち': payload.mood || '',
    '次への適用': payload.nextPlan || '',
    '共有': existing ? existing['共有'] : 'FALSE',
    '記録時刻': existing ? existing['記録時刻'] : now,
    '更新時刻': now
  });
  return { ok: true };
}

/** ポートフォリオ：この単元での自分の振り返り（日付ごと）＋先生からのコメント */
function student_getPortfolio() {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var unit = currentUnit_();
  if (!unit) return { ok: true, items: [] };
  var unitId = unit['unit_id'];

  var comments = Repo.where(C.SH.FB, { unit_id: unitId, to_user_id: uid })
    .map(function (f) { return f['コメント']; });

  var items = Repo.where(C.SH.REFL, { unit_id: unitId, user_id: uid }).map(function (r) {
    return {
      day: r['日付'],
      achievement: r['達成度'],
      planGap: r['計画とのズレ'],
      mood: r['気持ち'],
      selfEval: r['自己評価'],
      nextPlan: r['次への適用'],
      updatedMs: toMs_(r['更新時刻'])
    };
  });
  items.sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });
  return { ok: true, items: items, feedback: comments };
}

/**
 * 実行中の他者参照：クラスの「今の途中経過」を返す。
 * 前向きな情報だけ（取り組み中の課題・進み具合・学習形態・使っている工夫）。
 * こまった/無操作などは他児に見せない。
 */
function student_getPeers() {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var unit = currentUnit_();
  if (!unit || !truthy_(unit['他者参照'])) return { ok: true, enabled: false };

  var unitId = unit['unit_id'];
  var anon = unit['他者参照モード'] === '匿名';
  var strat = getStrategiesMap_();

  var taskById = {};
  var mustTotal = 0;
  Repo.where(C.SH.TASK, { unit_id: unitId }).forEach(function (t) {
    taskById[t['task_id']] = t;
    if (t['種別'] === C.TASK_KIND.MUST) mustTotal++;
  });

  var students = Repo.readAll(C.SH.USERS).filter(function (u) { return u['役割'] === C.ROLE.STUDENT; });
  students.sort(function (a, b) { return Number(a['出席番号']) - Number(b['出席番号']); });

  var progByUser = groupBy_(Repo.where(C.SH.PROG, { unit_id: unitId }), 'user_id');
  var selByUser = groupBy_(Repo.where(C.SH.SEL, { unit_id: unitId }), 'user_id');
  var useByUser = groupBy_(Repo.where(C.SH.SUSE, { unit_id: unitId }), 'user_id');
  var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var cards = students.map(function (u, i) {
    var pid = u['user_id'];
    var progs = progByUser[pid] || [];
    var doneMust = progs.filter(function (p) {
      var t = taskById[p['task_id']];
      return t && t['種別'] === C.TASK_KIND.MUST && Number(p['状態']) === C.PROGRESS.DONE;
    }).length;

    // いま取り組んでいる課題（取組中のうち、最後に更新したもの）
    var doing = progs.filter(function (p) { return Number(p['状態']) === C.PROGRESS.DOING; })
      .sort(function (a, b) { return toMs_(b['更新時刻']) - toMs_(a['更新時刻']); })[0];
    var doingTitle = doing && taskById[doing['task_id']] ? taskById[doing['task_id']]['タイトル'] : '';

    var usedIcons = (useByUser[pid] || []).filter(function (x) { return truthy_(x['状態']); })
      .map(function (x) { return strat[x['strategy_id']] ? strat[x['strategy_id']]['アイコン'] : ''; })
      .filter(Boolean);
    // 重複アイコンをまとめる
    usedIcons = usedIcons.filter(function (v, ix, a) { return a.indexOf(v) === ix; });

    var isMe = pid === uid;
    var started = progs.length > 0 || (selByUser[pid] || []).length > 0;

    return {
      isMe: isMe,
      name: isMe ? 'あなた' : (anon ? ('ともだち ' + labels[i]) : (u['表示名'] || u['氏名'])),
      number: u['出席番号'],
      doingTitle: doingTitle,
      doneMust: doneMust,
      mustTotal: mustTotal,
      form: latestOf_(selByUser[pid] || [], '学習形態') || '',
      usedIcons: usedIcons,
      stage: (mustTotal > 0 && doneMust >= mustTotal) ? 'できた' : (started ? 'とりくみ中' : 'これから')
    };
  });

  return { ok: true, enabled: true, anon: anon, cards: cards };
}

/* ------- 内部ヘルパー ------- */

function firstWhere_(name, match) {
  var rows = Repo.where(name, match);
  return rows.length ? rows[0] : null;
}

function splitCsv_(v) {
  if (!v) return [];
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/** 方略マスタを {id: row} のマップで取得 */
function getStrategiesMap_() {
  var map = {};
  Repo.readAll(C.SH.STRAT).forEach(function (s) { map[s['strategy_id']] = s; });
  return map;
}

/** 課題×カテゴリの最新の選択（生の行） */
function latestSelectionRaw_(unitId, taskId, uid, category) {
  var rows = Repo.where(C.SH.SEL, { unit_id: unitId, task_id: taskId, user_id: uid, 'カテゴリ': category });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return toMs_(b['選択時刻']) - toMs_(a['選択時刻']); });
  return rows[0];
}

/** {task_id: {カテゴリ: 値 or [値...]}} */
function latestSelectionsByTask_(unitId, uid) {
  var rows = Repo.where(C.SH.SEL, { unit_id: unitId, user_id: uid });
  var latest = {};
  rows.forEach(function (r) {
    var key = r['task_id'] + ' ' + r['カテゴリ'];
    if (!latest[key] || toMs_(r['選択時刻']) > toMs_(latest[key]['選択時刻'])) latest[key] = r;
  });
  var out = {};
  Object.keys(latest).forEach(function (key) {
    var r = latest[key];
    var v = r['選んだ値'];
    (out[r['task_id']] = out[r['task_id']] || {})[r['カテゴリ']] =
      String(v).indexOf(',') >= 0 ? splitCsv_(v) : v;
  });
  return out;
}

function reflToObj_(r) {
  return {
    achievement: r['達成度'],
    planGap: r['計画とのズレ'],
    planGapReason: r['ズレの理由'],
    selfEval: r['自己評価'],
    attrGood: splitCsv_(r['原因帰属良']),
    attrHard: splitCsv_(r['原因帰属難']),
    materialRequest: r['教材リクエスト'],
    mood: r['気持ち'],
    nextPlan: r['次への適用']
  };
}

function groupBy_(arr, key) {
  var m = {};
  arr.forEach(function (r) { (m[r[key]] = m[r[key]] || []).push(r); });
  return m;
}

function indexBy_(arr, key) {
  var m = {};
  arr.forEach(function (r) { m[r[key]] = r; });
  return m;
}

/** 選択行配列から指定カテゴリの最新値 */
function latestOf_(sels, category) {
  var rows = sels.filter(function (s) { return s['カテゴリ'] === category; });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return toMs_(b['選択時刻']) - toMs_(a['選択時刻']); });
  return rows[0]['選んだ値'];
}

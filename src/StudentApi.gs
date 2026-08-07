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
    progMap[p['task_id']] = {
      status: Number(p['状態']) || 0,
      understanding: p['理解度'] === '' || p['理解度'] == null ? null : Number(p['理解度']),
      memo: p['メモ'] || '',
      updatedMs: toMs_(p['更新時刻'])
    };
  });
  var useMap = {};
  Repo.where(C.SH.SUSE, { unit_id: unitId, user_id: uid }).forEach(function (u) {
    (useMap[u['task_id']] = useMap[u['task_id']] || {})[u['strategy_id']] = truthy_(u['状態']);
  });
  var selMap = latestSelectionsByTask_(unitId, uid);

  var taskPayload = tasks.map(function (t) {
    var tid = t['task_id'];
    var pr = progMap[tid];
    return {
      taskId: tid,
      order: t['並び'],
      kind: t['種別'],
      title: t['タイトル'],
      desc: t['説明'],
      mins: t['めやす分'],
      status: pr ? pr.status : 0,
      understanding: pr ? pr.understanding : null,
      memo: pr ? pr.memo : '',
      resources: resByTask[tid] || [],
      strategies: stByTask[tid] || [],
      selections: selMap[tid] || {},
      strategyUse: useMap[tid] || {}
    };
  });

  var planRow = firstWhere_(C.SH.PLAN, { unit_id: unitId, user_id: uid });
  var route = normalizePlan_(planRow ? splitCsv_(planRow['順序']) : null, taskPayload);

  var myGoal = firstWhere_(C.SH.GOAL, { unit_id: unitId, user_id: uid, '日付': day });
  var myHelp = firstWhere_(C.SH.HELP, { unit_id: unitId, user_id: uid });
  var myRefl = firstWhere_(C.SH.REFL, { unit_id: unitId, user_id: uid, '日付': day });
  var myChecks = Repo.where(C.SH.CHECK, { unit_id: unitId, user_id: uid, '日付': day })
    .map(function (c) { return { elapsedMin: c['経過分'], status: c['状態'], memo: c['メモ'], atMs: toMs_(c['時刻']) }; })
    .sort(function (a, b) { return a.atMs - b.atMs; });

  var mustDone = taskPayload.filter(function (t) { return isRequiredKind_(t.kind) && t.status === C.PROGRESS.DONE; }).length;
  var mustTotal = taskPayload.filter(function (t) { return isRequiredKind_(t.kind); }).length;

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
    plan: { route: route },
    commonResources: resCommon,
    commonStrategies: stCommon,
    allStrategies: Object.keys(strat).map(function (id) {
      var s = strat[id];
      return { strategyId: id, name: s['カード名'], desc: s['説明'], icon: s['アイコン'], category: s['分類'] };
    }),
    choices: choices,
    understandingLevels: C.UNDERSTANDING,
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

/**
 * 「ゴールまでの道すじ」を正規化する。
 *
 * 道すじは、ゴール課題を境に3つの区間に分かれる。
 *
 *   🚩スタート → ［必須・えらべる活動］ → ［ゴール課題］ → 🏁ゴール → ［発展］
 *
 * ・必須 … 道すじから外せない。ゴールまでのどこに置くかは自由
 * ・選択 … 入れるかどうかも、ゴールまでのどこに置くかも自分で決める
 * ・ゴール … 成果物そのものを作る課題。外せず、ゴールの直前にすわる
 *            （手前の課題は、この成果物のために積み上げるものになる）
 * ・発展 … 「やりきったら挑戦」。ゴールに着いたその先に置く。
 *          ゴールの手前には入れない（先にやることではないので）
 *
 * 子どもが並べ替えた順序は区間の中でそのまま尊重する。
 * 公開されていない／消えた課題のIDは落とし、外せない課題の抜けだけ補う。
 *
 * saved が null（まだ一度も立てていない）ときは、必須とゴールを先生の並び順に
 * 置いたものが初期の道すじ。えらべる活動と発展は、自分で入れるところから始まる。
 */
function normalizePlan_(saved, tasks) {
  var byId = {}, seen = {}, main = [], goal = [], beyond = [];
  tasks.forEach(function (t) { byId[t.taskId] = t; });

  function put(id) {
    var kind = byId[id].kind;
    if (kind === C.TASK_KIND.GOAL) goal.push(id);
    else if (kind === C.TASK_KIND.ADVANCED) beyond.push(id);
    else main.push(id);
  }

  (saved || []).forEach(function (id) {
    if (byId[id] && !seen[id]) { seen[id] = true; put(id); }
  });
  tasks.forEach(function (t) {
    if (isRequiredKind_(t.kind) && !seen[t.taskId]) { seen[t.taskId] = true; put(t.taskId); }
  });
  return main.concat(goal, beyond);
}

/**
 * 単元の道すじ（課題をやる順序）を保存。1人1単元1件。
 * 順序そのものが計画なので、履歴ではなく最新の1件を上書きする。
 */
function student_savePlan(taskIds) {
  var ctx = requireWritable_();
  var unit = requireCurrentUnit_();
  var unitId = unit['unit_id'], uid = ctx.user.userId;

  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId })
    .filter(function (t) { return truthy_(t['公開']); })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); })
    .map(function (t) { return { taskId: t['task_id'], kind: t['種別'] }; });

  var route = normalizePlan_(taskIds || [], tasks);
  var match = { unit_id: unitId, user_id: uid };
  var existing = firstWhere_(C.SH.PLAN, match);
  Repo.upsert(C.SH.PLAN, match, {
    plan_id: existing ? existing['plan_id'] : Repo.uuid(),
    '順序': route.join(','),
    '更新時刻': Repo.now()
  });
  return { ok: true, route: route };
}

/** きょうの計画（目標）を保存。1人1日1件 */
function student_saveGoal(be, doText, regulateIds, efficacy) {
  var ctx = requireWritable_();
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
  var ctx = requireWritable_();
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
  var ctx = requireWritable_();
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

/**
 * 課題ごとの理解度とメモを保存。進度と同じ行に持つ（1人1課題1件）。
 * Repo.upsert は渡した列だけを書くので、状態（進度）は保持される。
 *
 * 理解度は評価ではなく自己申告。あとで自分の弱点を見つけるための目盛り。
 * メモは振り返りではなく、取り組みながら書く「気づき・大切なこと・わからなかったこと」。
 */
function student_saveTaskNote(taskId, understanding, memo) {
  var ctx = requireWritable_();
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], task_id: taskId, user_id: ctx.user.userId };
  var existing = firstWhere_(C.SH.PROG, match);

  var lv = '';
  if (understanding !== '' && understanding != null) {
    var n = Number(understanding);
    if (C.UNDERSTANDING.some(function (u) { return u.value === n; })) lv = n;
  }

  Repo.upsert(C.SH.PROG, match, {
    progress_id: existing ? existing['progress_id'] : Repo.uuid(),
    '状態': existing ? existing['状態'] : C.PROGRESS.TODO,
    '理解度': lv,
    'メモ': memo == null ? '' : String(memo),
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 課題ごとの方略カードを「つかった！」/取り消し */
function student_useStrategy(taskId, strategyId, on) {
  var ctx = requireWritable_();
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
  var ctx = requireWritable_();
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
  var ctx = requireWritable_();
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
  var ctx = requireWritable_();
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

  // 終わった単元も足跡として残す。現単元だけに絞ると、次の単元が始まった瞬間に
  // それまでの学びが子どもの画面から消えてしまう。
  var units = Repo.readAll(C.SH.UNIT).filter(function (u) {
    return u['状態'] !== C.UNIT_STATE.DRAFT;
  });
  if (!units.length) return { ok: true, items: [], feedback: [], units: [] };

  var unitById = indexBy_(units, 'unit_id');
  var cur = currentUnit_();
  var curId = cur ? cur['unit_id'] : '';

  var unitLabel = function (id) {
    var u = unitById[id];
    return u ? (u['教科'] + '「' + u['単元名'] + '」') : '';
  };

  // 現単元の先生コメント（従来どおり）
  var comments = curId
    ? Repo.where(C.SH.FB, { unit_id: curId, to_user_id: uid }).map(function (f) { return f['コメント']; })
    : [];

  // --- 日ごとの足跡：計画と振り返りを組にする ---
  var goalByKey = {};
  Repo.where(C.SH.GOAL, { user_id: uid }).forEach(function (g) {
    goalByKey[g['unit_id'] + '\t' + g['日付']] = g;
  });

  var items = Repo.where(C.SH.REFL, { user_id: uid })
    .filter(function (r) { return !!unitById[r['unit_id']]; })
    .map(function (r) {
      var g = goalByKey[r['unit_id'] + '\t' + r['日付']];
      return {
        unitId: r['unit_id'],
        unitLabel: unitLabel(r['unit_id']),
        isCurrent: r['unit_id'] === curId,
        day: r['日付'],
        achievement: r['達成度'],
        planGap: r['計画とのズレ'],
        planGapReason: r['ズレの理由'],
        mood: r['気持ち'],
        selfEval: r['自己評価'],
        nextPlan: r['次への適用'],
        // 立てた計画と並べて初めて「ズレ」が足跡になる
        goalBe: g ? g['Be'] : '',
        goalDo: g ? g['Do'] : '',
        efficacy: g && g['自己効力感'] !== '' ? Number(g['自己効力感']) : null,
        updatedMs: toMs_(r['更新時刻'])
      };
    });
  items.sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });

  // --- 課題ごとの足跡：進んだ跡・理解度・メモ・使った工夫 ---
  var strat = getStrategiesMap_();
  var taskById = indexBy_(Repo.readAll(C.SH.TASK), 'task_id');

  var usedByTask = {};
  Repo.where(C.SH.SUSE, { user_id: uid }).forEach(function (u) {
    if (!truthy_(u['状態'])) return;
    var m = strat[u['strategy_id']];
    (usedByTask[u['task_id']] = usedByTask[u['task_id']] || [])
      .push(m ? (m['アイコン'] + ' ' + m['カード名']) : u['strategy_id']);
  });

  var tasks = Repo.where(C.SH.PROG, { user_id: uid })
    .filter(function (p) {
      // 手つかずの課題は足跡ではない。触れた跡のあるものだけ残す。
      var touched = Number(p['状態']) > 0 || p['メモ'] || p['理解度'] !== '';
      return touched && !!unitById[p['unit_id']] && !!taskById[p['task_id']];
    })
    .map(function (p) {
      var t = taskById[p['task_id']];
      return {
        unitId: p['unit_id'],
        unitLabel: unitLabel(p['unit_id']),
        isCurrent: p['unit_id'] === curId,
        taskId: p['task_id'],
        kind: t['種別'],
        title: t['タイトル'],
        order: Number(t['並び']) || 0,
        status: Number(p['状態']) || 0,
        understanding: p['理解度'] === '' || p['理解度'] == null ? null : Number(p['理解度']),
        memo: p['メモ'] || '',
        used: usedByTask[p['task_id']] || [],
        updatedMs: toMs_(p['更新時刻'])
      };
    });
  tasks.sort(function (a, b) { return a.order - b.order; });

  // --- 自己効力感と達成度の推移（古い順＝左から右へ読める向き） ---
  var trend = items.slice().reverse().map(function (it) {
    return {
      day: it.day,
      unitLabel: it.unitLabel,
      achievement: it.achievement === '' || it.achievement == null ? null : Number(it.achievement),
      efficacy: it.efficacy
    };
  });

  return {
    ok: true,
    items: items,
    tasks: tasks,
    trend: trend,
    understandingLevels: C.UNDERSTANDING,
    units: units.map(function (u) {
      return { unitId: u['unit_id'], label: unitLabel(u['unit_id']), isCurrent: u['unit_id'] === curId };
    }),
    feedback: comments
  };
}

/**
 * いま子どもに見えている内容の指紋。
 *
 * 児童画面は起動時にしか読まないので、先生が課題や資料を足しても
 * 開きっぱなしの端末には出てこない（これが「反映が遅い」の正体）。
 * 軽い問い合わせで版だけ見て、変わっていたら読み直しを促す。
 */
function student_getVersion() {
  var ctx = requireUser_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, version: 'none' };

  var unitId = unit['unit_id'];
  var parts = [unitId, toMs_(unit['更新時刻'])];

  // 公開されている課題と資料の数・更新の跡だけ見る（本文は読まない）
  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId }).filter(function (t) { return truthy_(t['公開']); });
  parts.push(tasks.length);
  tasks.forEach(function (t) { parts.push(t['task_id'], t['タイトル']); });

  var res = Repo.where(C.SH.RES, { unit_id: unitId }).filter(function (r) { return truthy_(r['公開']); });
  parts.push(res.length);
  res.forEach(function (r) { parts.push(r['resource_id']); });

  return { ok: true, version: parts.join('|') };
}

/* ==================== 学びログ（写真） ====================
 * 文字だけの足跡では、ノートも作品も残らない。撮った写真を課題に結びつけて残す。
 * 画像の実体は教師のドライブ、シートにはファイルIDだけを持つ。
 */

/**
 * 撮った写真を保存する。
 * dataUrl はクライアントで縮小済みの JPEG（'data:image/jpeg;base64,...'）。
 */
function student_saveLog(taskId, dataUrl, comment) {
  var ctx = requireWritable_();
  var unit = requireCurrentUnit_();
  var uid = ctx.user.userId;

  var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('画像の形式が正しくありません。');
  var mime = m[1], b64 = m[2];
  // base64 は元データの約4/3。デコード前に弾いて、大きすぎる投稿でメモリを使わない。
  if (b64.length * 3 / 4 > C.LOG_MAX_BYTES) throw new Error('画像が大きすぎます。もう一度撮ってください。');

  var task = taskId ? firstWhere_(C.SH.TASK, { unit_id: unit['unit_id'], task_id: taskId }) : null;
  var day = today_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var ext = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');
  // 誰の・いつの写真かがファイル名だけで分かるようにする（あとで教師が探せる）
  var who = String(ctx.user.name || '').replace(/[\/\\:*?"<>|]/g, '_');
  var fileName = [uid, who, stamp].filter(Boolean).join('_') + '.' + ext;

  var unitLabel = unit['教科'] + '_' + unit['単元名'];
  var folder = logFolder_(unitLabel, day);
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fileName);
  var file = folder.createFile(blob);

  var logId = Repo.uuid();
  Repo.append(C.SH.LOG, {
    log_id: logId,
    unit_id: unit['unit_id'],
    task_id: taskId || '',
    user_id: uid,
    '日付': day,
    'ファイルID': file.getId(),
    'ファイル名': fileName,
    'ひとこと': comment || '',
    '共有': 'TRUE',
    '撮影時刻': Repo.now()
  });

  return {
    ok: true,
    log: {
      logId: logId, taskId: taskId || '',
      taskTitle: task ? task['タイトル'] : '',
      comment: comment || '', shared: true,
      mine: true, day: day, atMs: Date.now()
    }
  };
}

/**
 * 学びログの一覧（画像は含まない）。
 * scope='mine' は自分の分だけ。'class'（みんなの学びログ）は
 * 教師が他者参照を開いているときだけ返す。
 */
function student_getLogs(scope) {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var unit = currentUnit_();
  if (!unit) return { ok: true, items: [], classOpen: false };

  var unitId = unit['unit_id'];
  var classOpen = truthy_(unit['他者参照']);
  var anon = unit['他者参照モード'] === '匿名';
  var wantClass = scope === 'class';
  if (wantClass && !classOpen) return { ok: true, items: [], classOpen: false };

  var taskById = indexBy_(Repo.where(C.SH.TASK, { unit_id: unitId }), 'task_id');
  var userById = indexBy_(Repo.readAll(C.SH.USERS), 'user_id');

  var rows = Repo.where(C.SH.LOG, { unit_id: unitId }).filter(function (r) {
    if (r['user_id'] === uid) return true;
    // 他の子の写真は、他者参照が開いていて、本人が共有しているものだけ
    return wantClass && truthy_(r['共有']);
  });

  var items = rows.map(function (r) {
    var mine = r['user_id'] === uid;
    var owner = userById[r['user_id']];
    var t = taskById[r['task_id']];
    return {
      logId: r['log_id'],
      taskId: r['task_id'],
      taskTitle: t ? t['タイトル'] : '',
      // 匿名モードでは自分以外の名前を伏せる（他者参照の設定に合わせる）
      who: mine ? 'じぶん' : (anon ? 'クラスの人' : (owner ? (owner['表示名'] || owner['氏名']) : '')),
      mine: mine,
      comment: r['ひとこと'] || '',
      shared: truthy_(r['共有']),
      day: r['日付'],
      atMs: toMs_(r['撮影時刻'])
    };
  });
  items.sort(function (a, b) { return b.atMs - a.atMs; });
  return { ok: true, items: items, classOpen: classOpen, anon: anon };
}

/**
 * 画像1枚をデータURIで返す。一覧では読まず、表示するぶんだけ取りに来させる。
 * （30人ぶんをまとめて返すと転送量で詰まる）
 */
function student_getLogImage(logId) {
  var ctx = requireUser_();
  var uid = ctx.user.userId;
  var unit = requireCurrentUnit_();

  var row = firstWhere_(C.SH.LOG, { unit_id: unit['unit_id'], log_id: logId });
  if (!row) throw new Error('写真が見つかりません。');

  // 自分のものでなければ、他者参照が開いていて共有されている場合だけ見せる
  if (row['user_id'] !== uid && !(truthy_(unit['他者参照']) && truthy_(row['共有']))) {
    throw new Error('この写真は見られません。');
  }
  return { ok: true, dataUrl: logDataUrl_(row['ファイルID']) };
}

/** 自分の写真を取り消す（Drive の実体も消す。シートだけ消すと写真が残る） */
function student_deleteLog(logId) {
  var ctx = requireWritable_();
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], log_id: logId, user_id: ctx.user.userId };
  var row = firstWhere_(C.SH.LOG, match);
  if (!row) throw new Error('自分の写真だけ取り消せます。');

  try { DriveApp.getFileById(row['ファイルID']).setTrashed(true); } catch (e) {}
  Repo.remove(C.SH.LOG, match);
  return { ok: true };
}

/** 自分の写真をみんなに見せるか切り替える */
function student_setLogShare(logId, on) {
  var ctx = requireWritable_();
  var unit = requireCurrentUnit_();
  var match = { unit_id: unit['unit_id'], log_id: logId, user_id: ctx.user.userId };
  if (!firstWhere_(C.SH.LOG, match)) throw new Error('自分の写真だけ変えられます。');
  Repo.upsert(C.SH.LOG, match, { '共有': on ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/** ファイルIDからデータURIを作る（教師・児童の両方から使う） */
function logDataUrl_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
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
    if (isRequiredKind_(t['種別'])) mustTotal++;
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
      return t && isRequiredKind_(t['種別']) && Number(p['状態']) === C.PROGRESS.DONE;
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
    var key = r['task_id'] + '\u0000' + r['カテゴリ'];
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

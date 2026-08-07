/**
 * TeacherApi.gs
 * 教師向けサーバー関数。入口で requireTeacher_()。
 *
 * 単元内自由進度学習のため、モニタは「全員が同じ1時間にいる」前提を取らない。
 * 誰がいまどの課題にいるか（分布）を把握できるようにしている。
 */

/** 教師アプリの初期情報 */
function teacher_bootstrap() {
  var ctx = requireTeacher_();
  var unit = currentUnit_();
  return { ok: true, me: ctx.user, unitMeta: unit ? unitMeta_(unit) : null };
}

/** 授業モニタ。児童ごとのタイル＋課題ごとの分布 */
function teacher_getMonitor() {
  requireTeacher_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, hasUnit: false };
  var unitId = unit['unit_id'];
  var now = Date.now();

  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); });
  var taskById = indexBy_(tasks, 'task_id');
  var mustTotal = tasks.filter(function (t) { return t['種別'] === C.TASK_KIND.MUST; }).length;

  var students = Repo.readAll(C.SH.USERS).filter(function (u) { return u['役割'] === C.ROLE.STUDENT; });
  var day = today_();

  var goals = {};
  Repo.where(C.SH.GOAL, { unit_id: unitId, '日付': day }).forEach(function (g) { goals[g['user_id']] = g; });
  var help = indexBy_(Repo.where(C.SH.HELP, { unit_id: unitId }), 'user_id');
  var progByUser = groupBy_(Repo.where(C.SH.PROG, { unit_id: unitId }), 'user_id');
  var selByUser = groupBy_(Repo.where(C.SH.SEL, { unit_id: unitId }), 'user_id');
  var useByUser = groupBy_(Repo.where(C.SH.SUSE, { unit_id: unitId }), 'user_id');
  var checkByUser = groupBy_(Repo.where(C.SH.CHECK, { unit_id: unitId, '日付': day }), 'user_id');

  // 課題ごとの分布（取組中／完了の人数）
  var dist = {};
  tasks.forEach(function (t) { dist[t['task_id']] = { doing: 0, done: 0 }; });

  var tiles = students.map(function (u) {
    var uid = u['user_id'];
    var g = goals[uid];
    var h = help[uid];
    var progs = progByUser[uid] || [];
    var sels = selByUser[uid] || [];

    var doneMust = 0;
    var doing = null;
    progs.forEach(function (p) {
      var t = taskById[p['task_id']];
      var st = Number(p['状態']);
      if (!t) return;
      if (dist[p['task_id']]) {
        if (st === C.PROGRESS.DOING) dist[p['task_id']].doing++;
        if (st === C.PROGRESS.DONE) dist[p['task_id']].done++;
      }
      if (t['種別'] === C.TASK_KIND.MUST && st === C.PROGRESS.DONE) doneMust++;
      if (st === C.PROGRESS.DOING) {
        if (!doing || toMs_(p['更新時刻']) > toMs_(doing['更新時刻'])) doing = p;
      }
    });

    var helpOn = h && truthy_(h['状態']);
    var started = !!g || progs.length > 0 || sels.length > 0;

    // 最終操作時刻
    var last = 0;
    if (g) last = Math.max(last, toMs_(g['更新時刻']));
    if (h) last = Math.max(last, toMs_(h['更新時刻']));
    progs.forEach(function (p) { last = Math.max(last, toMs_(p['更新時刻'])); });
    sels.forEach(function (s) { last = Math.max(last, toMs_(s['選択時刻'])); });
    (useByUser[uid] || []).forEach(function (x) { last = Math.max(last, toMs_(x['更新時刻'])); });
    (checkByUser[uid] || []).forEach(function (c) { last = Math.max(last, toMs_(c['時刻'])); });

    var idleMin = last ? Math.floor((now - last) / 60000) : null;
    var allMustDone = mustTotal > 0 && doneMust >= mustTotal;

    var status;
    if (helpOn) status = 'help';
    else if (allMustDone) status = 'done';
    else if (!started) status = 'none';
    else if (idleMin !== null && idleMin >= C.IDLE_MINUTES) status = 'idle';
    else status = 'busy';

    return {
      userId: uid,
      number: u['出席番号'],
      name: u['表示名'] || u['氏名'],
      status: status,
      doingTitle: doing && taskById[doing['task_id']] ? taskById[doing['task_id']]['タイトル'] : '',
      doneMust: doneMust,
      mustTotal: mustTotal,
      form: latestOf_(sels, '学習形態') || '',
      idleMin: idleMin,
      helpOn: helpOn
    };
  });

  tiles.sort(function (a, b) { return Number(a.number) - Number(b.number); });

  var counts = { busy: 0, done: 0, help: 0, idle: 0, none: 0 };
  tiles.forEach(function (t) { counts[t.status]++; });

  // 調整層 I/You/We
  var regulation = { I: 0, You: 0, We: 0, none: 0 };
  students.forEach(function (u) {
    var form = latestOf_(selByUser[u['user_id']] || [], '学習形態');
    if (form === 'ひとりで') regulation.I++;
    else if (form === 'ペアで') regulation.You++;
    else if (form === 'グループで') regulation.We++;
    else regulation.none++;
  });

  var diagnosis = diagnoseEnvironment_(tiles, students.length, checkByUser);

  return {
    ok: true,
    hasUnit: true,
    serverMs: now,
    meta: unitMeta_(unit),
    counts: counts,
    regulation: regulation,
    diagnosis: diagnosis,
    tiles: tiles,
    taskDistribution: tasks.map(function (t) {
      return {
        taskId: t['task_id'], order: t['並び'], kind: t['種別'], title: t['タイトル'],
        published: truthy_(t['公開']),
        doing: dist[t['task_id']].doing, done: dist[t['task_id']].done
      };
    })
  };
}

/**
 * 環境の診断。
 * 「教師の前に長蛇の列ができたら失敗」── 立ち止まりや援助要請の多さは、
 * 子どもの問題ではなく【手引き・資料・課題の粒度が足りているか】のサインとして返す。
 * 個人を急かすためではなく、環境を見直すための材料。
 */
function diagnoseEnvironment_(tiles, studentCount, checkByUser) {
  var helpCount = 0, idleCount = 0;
  var stuckByTask = {};
  tiles.forEach(function (t) {
    if (t.status === 'help') helpCount++;
    if (t.status === 'idle') idleCount++;
    if ((t.status === 'help' || t.status === 'idle') && t.doingTitle) {
      stuckByTask[t.doingTitle] = (stuckByTask[t.doingTitle] || 0) + 1;
    }
  });

  // きょうの確認タイムで「調整する」を選んだ人数
  var adjustCount = 0;
  Object.keys(checkByUser).forEach(function (uid) {
    if (checkByUser[uid].some(function (c) { return c['状態'] === '調整する'; })) adjustCount++;
  });

  var stuckTasks = Object.keys(stuckByTask)
    .map(function (title) { return { title: title, count: stuckByTask[title] }; })
    .filter(function (x) { return x.count >= 2; })
    .sort(function (a, b) { return b.count - a.count; });

  var stopped = helpCount + idleCount;
  var level, message;
  if (studentCount > 0 && stopped >= Math.ceil(studentCount * 0.3)) {
    level = 'review';
    message = '立ち止まっている子が' + stopped + '人。手引きや資料が足りていないサインかもしれません。'
            + '個々に教えて回る前に、環境（資料の追加・課題の分割）を見直してみませんか。';
  } else if (stuckTasks.length) {
    level = 'watch';
    message = '「' + stuckTasks[0].title + '」で止まっている子が' + stuckTasks[0].count + '人います。'
            + 'この課題の資料や説明が足りているか確かめてみましょう。';
  } else {
    level = 'ok';
    message = 'いまのところ、子どもは環境の中で自分で進められています。見取りに集中できます。';
  }

  return {
    level: level, message: message,
    helpCount: helpCount, idleCount: idleCount, adjustCount: adjustCount,
    stuckTasks: stuckTasks
  };
}

/** 見取りメモを保存（事実と解釈を分けて書く） */
function teacher_saveObservation(userId, fact, interpretation) {
  var ctx = requireTeacher_();
  var unit = requireCurrentUnit_();
  if (!String(fact || '').trim() && !String(interpretation || '').trim()) {
    throw new Error('事実か解釈のどちらかは書いてください。');
  }
  Repo.append(C.SH.OBS, {
    obs_id: Repo.uuid(),
    unit_id: unit['unit_id'],
    user_id: userId,
    teacher_id: ctx.user.userId,
    '事実': fact || '',
    '解釈（仮説）': interpretation || '',
    '時刻': Repo.now()
  });
  return { ok: true };
}

/** 児童1人の詳細 */
function teacher_getStudentDetail(userId) {
  requireTeacher_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, hasUnit: false };
  var unitId = unit['unit_id'], day = today_();
  var strat = getStrategiesMap_();

  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); });
  var progMap = {};
  Repo.where(C.SH.PROG, { unit_id: unitId, user_id: userId }).forEach(function (p) {
    progMap[p['task_id']] = {
      status: Number(p['状態']) || 0,
      understanding: p['理解度'] === '' || p['理解度'] == null ? null : Number(p['理解度']),
      memo: p['メモ'] || ''
    };
  });

  var g = firstWhere_(C.SH.GOAL, { unit_id: unitId, user_id: userId, '日付': day });
  var helpRow = firstWhere_(C.SH.HELP, { unit_id: unitId, user_id: userId });
  var checks = Repo.where(C.SH.CHECK, { unit_id: unitId, user_id: userId, '日付': day })
    .map(function (c) { return { elapsedMin: c['経過分'], status: c['状態'], memo: c['メモ'] }; });

  var usedNames = Repo.where(C.SH.SUSE, { unit_id: unitId, user_id: userId })
    .filter(function (u) { return truthy_(u['状態']); })
    .map(function (u) { return strat[u['strategy_id']] ? strat[u['strategy_id']]['カード名'] : u['strategy_id']; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });

  var u = firstWhere_(C.SH.USERS, { user_id: userId });
  var selByTask = latestSelectionsByTask_(unitId, userId);

  var observations = Repo.where(C.SH.OBS, { unit_id: unitId, user_id: userId })
    .sort(function (a, b) { return toMs_(b['時刻']) - toMs_(a['時刻']); })
    .slice(0, 5)
    .map(function (o) { return { fact: o['事実'], interpretation: o['解釈（仮説）'], atMs: toMs_(o['時刻']) }; });

  return {
    ok: true,
    hasUnit: true,
    observations: observations,
    userId: userId,
    name: u ? (u['表示名'] || u['氏名']) : userId,
    number: u ? u['出席番号'] : '',
    help: helpRow ? truthy_(helpRow['状態']) : false,
    goal: g ? {
      be: g['Be'], doText: g['Do'],
      efficacy: g['自己効力感'] === '' ? null : Number(g['自己効力感']),
      regulateNames: splitCsv_(g['Regulate']).map(function (id) {
        return strat[id] ? (strat[id]['アイコン'] + ' ' + strat[id]['カード名']) : id;
      })
    } : null,
    usedNames: usedNames,
    checkpoints: checks,
    understandingLevels: C.UNDERSTANDING,
    tasks: tasks.map(function (t) {
      var tid = t['task_id'];
      var sel = selByTask[tid] || {};
      var form = sel['学習形態'];
      var pr = progMap[tid];
      return {
        kind: t['種別'], title: t['タイトル'],
        status: pr ? pr.status : 0,
        // 「できた」なのに理解度が低い、メモに困りが書いてある——見取りの手がかり
        understanding: pr ? pr.understanding : null,
        memo: pr ? pr.memo : '',
        form: Array.isArray(form) ? form.join('・') : (form || '')
      };
    })
  };
}

/** 児童1人の学びログ一覧（画像は含まない）。教師は共有オフのものも見取りに使える */
function teacher_getLogs(userId) {
  requireTeacher_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, items: [] };
  var unitId = unit['unit_id'];
  var taskById = indexBy_(Repo.where(C.SH.TASK, { unit_id: unitId }), 'task_id');

  var items = Repo.where(C.SH.LOG, { unit_id: unitId, user_id: userId }).map(function (r) {
    var t = taskById[r['task_id']];
    return {
      logId: r['log_id'],
      taskTitle: t ? t['タイトル'] : '',
      comment: r['ひとこと'] || '',
      shared: truthy_(r['共有']),
      day: r['日付'],
      atMs: toMs_(r['撮影時刻'])
    };
  });
  items.sort(function (a, b) { return b.atMs - a.atMs; });
  return { ok: true, items: items };
}

/** 画像1枚（教師用）。表示するぶんだけ取りに来させる */
function teacher_getLogImage(logId) {
  requireTeacher_();
  var unit = requireCurrentUnit_();
  var row = firstWhere_(C.SH.LOG, { unit_id: unit['unit_id'], log_id: logId });
  if (!row) throw new Error('写真が見つかりません。');
  return { ok: true, dataUrl: logDataUrl_(row['ファイルID']) };
}

/** フィードバック送信 */
function teacher_sendFeedback(toUserId, comment) {
  var ctx = requireTeacher_();
  var unit = requireCurrentUnit_();
  if (!comment || !String(comment).trim()) throw new Error('コメントが空です。');
  Repo.append(C.SH.FB, {
    feedback_id: Repo.uuid(),
    unit_id: unit['unit_id'],
    from_user_id: ctx.user.userId,
    to_user_id: toUserId,
    'コメント': comment,
    '既読': 'FALSE',
    '送信時刻': Repo.now()
  });
  return { ok: true };
}

/** 単元デザイン画面用：単元＝学習の手引きの全情報 */
function teacher_getDesign(unitId) {
  requireTeacher_();
  var units = Repo.readAll(C.SH.UNIT);
  if (units.length === 0) return { ok: true, hasUnit: false };

  var unit = unitId ? firstWhere_(C.SH.UNIT, { unit_id: unitId }) : (currentUnit_() || units[0]);
  if (!unit) unit = units[0];
  var uid = unit['unit_id'];

  var openCats = {};
  Repo.where(C.SH.UCHOICE, { unit_id: uid }).forEach(function (c) { openCats[c['カテゴリ']] = truthy_(c['開放']); });

  var strat = getStrategiesMap_();
  var resByTask = {}, resCommon = [];
  Repo.where(C.SH.RES, { unit_id: uid }).forEach(function (r) {
    var item = { icon: r['アイコン'], title: r['タイトル'], kind: r['種別'], url: r['URL'], published: truthy_(r['公開']) };
    if (r['task_id']) (resByTask[r['task_id']] = resByTask[r['task_id']] || []).push(item);
    else resCommon.push(item);
  });
  var stByTask = {}, stCommon = [];
  Repo.where(C.SH.USTRAT, { unit_id: uid }).forEach(function (s) {
    var m = strat[s['strategy_id']];
    var item = { strategyId: s['strategy_id'], name: m ? m['カード名'] : s['strategy_id'], icon: m ? m['アイコン'] : '' };
    if (s['task_id']) (stByTask[s['task_id']] = stByTask[s['task_id']] || []).push(item);
    else stCommon.push(item);
  });

  var tasks = Repo.where(C.SH.TASK, { unit_id: uid })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); })
    .map(function (t) {
      return {
        taskId: t['task_id'], order: t['並び'], kind: t['種別'], title: t['タイトル'],
        desc: t['説明'], mins: t['めやす分'], published: truthy_(t['公開']),
        resources: resByTask[t['task_id']] || [],
        strategies: stByTask[t['task_id']] || []
      };
    });

  return {
    ok: true,
    hasUnit: true,
    unitList: units.map(function (u) {
      return { unitId: u['unit_id'], name: u['単元名'], subject: u['教科'], state: u['状態'] };
    }),
    unit: {
      unitId: uid,
      subject: unit['教科'], grade: unit['学年'], unitName: unit['単元名'],
      unitGoal: unit['単元目標'], outcome: unit['成果物イメージ'],
      totalHours: unit['総時数'], discretion: String(unit['裁量レベル']),
      checkInterval: Number(unit['確認タイム間隔']) || 0,
      peerRef: truthy_(unit['他者参照']), peerAnon: unit['他者参照モード'] === '匿名',
      state: unit['状態']
    },
    tasks: tasks,
    commonResources: resCommon,
    commonStrategies: stCommon,
    openCats: openCats
  };
}

/** 単元（学習の手引き）の更新 */
function teacher_updateUnit(unitId, patch) {
  requireTeacher_();
  var allowed = ['単元名', '単元目標', '成果物イメージ', '総時数', '裁量レベル', '確認タイム間隔'];
  var clean = {};
  allowed.forEach(function (k) { if (patch.hasOwnProperty(k)) clean[k] = patch[k]; });
  clean['更新時刻'] = Repo.now();
  Repo.updateByKey(C.SH.UNIT, 'unit_id', unitId, clean);
  return { ok: true };
}

/** 単元の状態（準備中/公開中/終了）。公開は1件に絞る */
function teacher_setUnitState(unitId, state) {
  requireTeacher_();
  if (state === C.UNIT_STATE.OPEN) {
    Repo.readAll(C.SH.UNIT).forEach(function (u) {
      if (u['unit_id'] !== unitId && u['状態'] === C.UNIT_STATE.OPEN) {
        Repo.updateByKey(C.SH.UNIT, 'unit_id', u['unit_id'], { '状態': C.UNIT_STATE.CLOSED, '更新時刻': Repo.now() });
      }
    });
  }
  Repo.updateByKey(C.SH.UNIT, 'unit_id', unitId, { '状態': state, '更新時刻': Repo.now() });
  return { ok: true };
}

/**
 * 課題の公開/非公開（段階的公開）。
 * 環境は変えないと風景になる ── 最初に全部を見せず、動きが鈍ったら新しい課題を投入する。
 */
function teacher_setTaskPublish(taskId, on) {
  requireTeacher_();
  Repo.updateByKey(C.SH.TASK, 'task_id', taskId, { '公開': on ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/** 選択肢カテゴリの開放/非開放 */
function teacher_setChoice(unitId, category, open) {
  requireTeacher_();
  Repo.upsert(C.SH.UCHOICE, { unit_id: unitId, 'カテゴリ': category }, { '開放': open ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/** 実行中の他者参照の有効化と、記名/匿名モード */
function teacher_setPeerRef(unitId, on, anon) {
  requireTeacher_();
  Repo.updateByKey(C.SH.UNIT, 'unit_id', unitId, {
    '他者参照': on ? 'TRUE' : 'FALSE',
    '他者参照モード': anon ? '匿名' : '記名',
    '更新時刻': Repo.now()
  });
  return { ok: true };
}

/** 課題への推奨方略の紐づけ（taskId 空文字なら単元共通） */
function teacher_setStrategyLink(unitId, taskId, strategyId, on) {
  requireTeacher_();
  var match = { unit_id: unitId, task_id: taskId || '', strategy_id: strategyId };
  if (on) {
    if (!firstWhere_(C.SH.USTRAT, match)) {
      Repo.append(C.SH.USTRAT, { unit_id: unitId, task_id: taskId || '', strategy_id: strategyId, '教師の一言': '' });
    }
  } else {
    var rows = Repo.where(C.SH.USTRAT, match);
    if (rows.length) {
      var s = Repo.sheet(C.SH.USTRAT);
      rows.sort(function (a, b) { return b.__row - a.__row; }).forEach(function (r) { s.deleteRow(r.__row); });
    }
  }
  return { ok: true };
}

/** ふりかえり一覧（指定日。未指定ならきょう） */
function teacher_getReflections(day) {
  requireTeacher_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, hasUnit: false };
  var unitId = unit['unit_id'];
  var target = day || today_();

  var students = Repo.readAll(C.SH.USERS).filter(function (u) { return u['役割'] === C.ROLE.STUDENT; });
  var refl = indexBy_(Repo.where(C.SH.REFL, { unit_id: unitId, '日付': target }), 'user_id');

  var rows = students.map(function (u) {
    var r = refl[u['user_id']];
    return {
      userId: u['user_id'],
      number: u['出席番号'],
      name: u['表示名'] || u['氏名'],
      hasRefl: !!r,
      achievement: r ? r['達成度'] : null,
      planGap: r ? r['計画とのズレ'] : '',
      planGapReason: r ? r['ズレの理由'] : '',
      materialRequest: r ? r['教材リクエスト'] : '',
      mood: r ? r['気持ち'] : '',
      attrGood: r ? splitCsv_(r['原因帰属良']) : [],
      attrHard: r ? splitCsv_(r['原因帰属難']) : [],
      selfEval: r ? r['自己評価'] : '',
      nextPlan: r ? r['次への適用'] : '',
      shared: r ? truthy_(r['共有']) : false
    };
  });
  rows.sort(function (a, b) { return Number(a.number) - Number(b.number); });

  // 記録のある日付一覧（日付切替用）
  var days = Repo.where(C.SH.REFL, { unit_id: unitId })
    .map(function (r) { return r['日付']; })
    .filter(function (v, i, a) { return v && a.indexOf(v) === i; })
    .sort().reverse();

  return { ok: true, hasUnit: true, day: target, days: days, rows: rows };
}

/**
 * 単元の改善リスト。
 * 「振り返りは反省をしない。代わりに『こういう教材があったら分かった』を聞き、翌年の改善に使う」
 * 児童の教材リクエストを単元全体から集め、次年度の手引き・環境づくりの材料として返す。
 */
function teacher_getImprovements() {
  requireTeacher_();
  var unit = currentUnit_();
  if (!unit) return { ok: true, hasUnit: false };
  var unitId = unit['unit_id'];

  var users = indexBy_(Repo.readAll(C.SH.USERS), 'user_id');
  var requests = Repo.where(C.SH.REFL, { unit_id: unitId })
    .filter(function (r) { return String(r['教材リクエスト'] || '').trim(); })
    .map(function (r) {
      var u = users[r['user_id']];
      return {
        day: r['日付'],
        name: u ? (u['表示名'] || u['氏名']) : r['user_id'],
        number: u ? u['出席番号'] : '',
        request: r['教材リクエスト']
      };
    })
    .sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });

  // 「むずかしかった理由」も環境改善の材料として集計する
  var hardCount = {};
  Repo.where(C.SH.REFL, { unit_id: unitId }).forEach(function (r) {
    splitCsv_(r['原因帰属難']).forEach(function (t) { hardCount[t] = (hardCount[t] || 0) + 1; });
  });
  var hardTop = Object.keys(hardCount).map(function (k) { return { label: k, count: hardCount[k] }; })
    .sort(function (a, b) { return b.count - a.count; });

  // 計画とのズレの分布
  var gap = {};
  Repo.where(C.SH.REFL, { unit_id: unitId }).forEach(function (r) {
    var g = r['計画とのズレ']; if (g) gap[g] = (gap[g] || 0) + 1;
  });

  return { ok: true, hasUnit: true, unitName: unit['単元名'], requests: requests, hardTop: hardTop, planGap: gap };
}

/** 「みんなの工夫」への共有トグル */
function teacher_toggleShare(userId, day, share) {
  requireTeacher_();
  var unit = requireCurrentUnit_();
  Repo.upsert(C.SH.REFL, { unit_id: unit['unit_id'], user_id: userId, '日付': day || today_() },
    { '共有': share ? 'TRUE' : 'FALSE' });
  return { ok: true };
}

/* ------- 内部ヘルパー ------- */

function unitMeta_(unit) {
  return {
    unitId: unit['unit_id'],
    subject: unit['教科'],
    grade: unit['学年'],
    unitName: unit['単元名'],
    totalHours: unit['総時数'],
    state: unit['状態']
  };
}

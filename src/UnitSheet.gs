/**
 * UnitSheet.gs
 * 単元ごとの「編集シート」。1単元＝1枚に、目標・課題・資料をまとめて書ける。
 *
 * 単元／課題／資料の3シートを行き来しながら unit_id を貼って回るのは煩雑なので、
 * 教師が一気に書ける作業面をつくる。正本はこれまでどおり正規化された3シートで、
 * 単元シートは「取り込む」「書き出す」で行き来する。
 *
 * 取り込みは何度でもやり直せる（冪等）。
 * シートに書き戻した task_id / resource_id を目印に、次からは追加ではなく更新になる。
 */

var US = {
  MARK: '単元シート',
  TASK_MARK: '■ 課題',
  RES_MARK: '■ 資料',
  PREFIX: '単元_',

  // 見出し（B列に値）。並び順がそのまま行順になる
  FIELDS: [
    ['教科', ''],
    ['学年', ''],
    ['単元名', ''],
    ['単元の問い・目標', ''],
    ['単元の出口（成果物イメージ）', ''],
    ['総時数', ''],
    ['確認タイム間隔（分・0で使わない）', ''],
    ['裁量レベル（1指定／2選択／3自由）', '2']
  ],
  TASK_COLS: ['種別', 'タイトル', '説明', 'めやす分', '公開', 'task_id（自動・消さない）'],
  RES_COLS: ['課題番号（空＝いつでも使える）', 'アイコン', 'タイトル', '補足', '種別', 'URL', '公開', 'resource_id（自動・消さない）']
};

// シートの見出しと、単元シートの列名の対応
US.FIELD_MAP = {
  '教科': '教科',
  '学年': '学年',
  '単元名': '単元名',
  '単元の問い・目標': '単元目標',
  '単元の出口（成果物イメージ）': '成果物イメージ',
  '総時数': '総時数',
  '確認タイム間隔（分・0で使わない）': '確認タイム間隔',
  '裁量レベル（1指定／2選択／3自由）': '裁量レベル'
};

/* ==================== メニューから呼ぶもの ==================== */

/** 新しい単元シートを作る（空のひな形） */
function unitSheetNew() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(C.APP_NAME, '単元名を入れてください。\n（この名前でシートを作ります）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = String(res.getResponseText() || '').trim();
  if (!name) { ui.alert(C.APP_NAME, '単元名が空です。', ui.ButtonSet.OK); return; }

  // 打ち込んだ単元名は最初から入れておく（取り込みでここを見る）
  var sheet = buildUnitSheet_(name, '', { '単元名': name }, [], []);
  SpreadsheetApp.getActive().setActiveSheet(sheet);
  toastUi_('単元シートを作りました。書けたらメニューの「単元シートを取り込む」を実行してください。');
}

/** 既存の単元を単元シートに書き出す（あとから直したいとき） */
function unitSheetExport() {
  var ui = SpreadsheetApp.getUi();
  var units = Repo.readAll(C.SH.UNIT);
  if (!units.length) { ui.alert(C.APP_NAME, '単元がまだありません。', ui.ButtonSet.OK); return; }

  var list = units.map(function (u, i) {
    return (i + 1) + '. ' + (u['教科'] || '') + '「' + u['単元名'] + '」（' + u['状態'] + '）';
  }).join('\n');
  var res = ui.prompt(C.APP_NAME, '書き出す単元の番号を入れてください。\n\n' + list, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var n = Number(String(res.getResponseText() || '').trim());
  if (!n || n < 1 || n > units.length) { ui.alert(C.APP_NAME, '番号が正しくありません。', ui.ButtonSet.OK); return; }

  var unit = units[n - 1];
  var unitId = unit['unit_id'];
  var tasks = Repo.where(C.SH.TASK, { unit_id: unitId })
    .sort(function (a, b) { return Number(a['並び']) - Number(b['並び']); });
  var taskRow = {};
  tasks.forEach(function (t, i) { taskRow[t['task_id']] = i + 1; });
  var resources = Repo.where(C.SH.RES, { unit_id: unitId });

  var sheet = buildUnitSheet_(unit['単元名'], unitId, unit, tasks, resources, taskRow);
  SpreadsheetApp.getActive().setActiveSheet(sheet);
  toastUi_('「' + unit['単元名'] + '」を書き出しました。');
}

/**
 * いま開いている単元シートを取り込む。
 * すでにある課題・資料は更新、新しい行は追加。
 * シートから消えた課題・資料は、子どもの記録がなければ消し、あれば残して知らせる。
 */
function unitSheetImport() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var parsed;
  try {
    parsed = parseUnitSheet_(sheet);
  } catch (err) {
    ui.alert(C.APP_NAME, String(err.message || err), ui.ButtonSet.OK);
    return;
  }

  var r;
  try {
    r = importUnitSheet_(sheet, parsed);
  } catch (err2) {
    ui.alert(C.APP_NAME, String(err2.message || err2), ui.ButtonSet.OK);
    return;
  }
  ui.alert(C.APP_NAME,
    '「' + r.unitName + '」を取り込みました。\n\n' +
    '課題：追加 ' + r.taskAdded + ' ／ 更新 ' + r.taskUpdated + ' ／ 削除 ' + r.taskDeleted + '\n' +
    '資料：追加 ' + r.resAdded + ' ／ 更新 ' + r.resUpdated + ' ／ 削除 ' + r.resDeleted +
    (r.kept.length ? '\n\n消さずに残したもの（子どもの記録があります）：\n・' + r.kept.join('\n・') : '') +
    (r.skipped.length ? '\n\n読めなかった行：\n・' + r.skipped.join('\n・') : '') +
    '\n\n単元デザインの画面を開き直すと反映されます。',
    ui.ButtonSet.OK);
}

/* ==================== シートの組み立て ==================== */

/** 単元シートを作る（あれば中身を作り直す） */
function buildUnitSheet_(unitName, unitId, unit, tasks, resources, taskRow) {
  var ss = SpreadsheetApp.getActive();
  var name = sheetNameFor_(unitName);
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  else s.clear();

  var rows = [];
  rows.push([US.MARK, unitId || '', '← B1は単元のIDです。自動で入ります。消さないでください']);
  US.FIELDS.forEach(function (f) {
    var key = US.FIELD_MAP[f[0]];
    var v = unit ? unit[key] : f[1];
    rows.push([f[0], v === undefined || v === null ? f[1] : v, '']);
  });
  rows.push(['', '', '']);

  var taskMarkRow = rows.length + 1;
  rows.push([US.TASK_MARK, '上から順に並びます。行を入れ替えれば順番が変わります。', '']);
  rows.push(US.TASK_COLS.slice());
  (tasks || []).forEach(function (t) {
    rows.push([t['種別'], t['タイトル'], t['説明'], t['めやす分'],
      truthy_(t['公開']) ? '公開' : '非公開', t['task_id']]);
  });
  // 書き足す余白
  for (var i = 0; i < 6; i++) rows.push(['', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);

  var resMarkRow = rows.length + 1;
  rows.push([US.RES_MARK, '課題番号は上の課題の並び（1、2、3…）。空なら単元共通＝いつでも使える資料。', '']);
  rows.push(US.RES_COLS.slice());
  (resources || []).forEach(function (r) {
    var no = r['task_id'] && taskRow && taskRow[r['task_id']] ? taskRow[r['task_id']] : '';
    rows.push([no, r['アイコン'], r['タイトル'], r['補足'], r['種別'], r['URL'],
      truthy_(r['公開']) ? '公開' : '非公開', r['resource_id']]);
  });
  for (var j = 0; j < 6; j++) rows.push(['', '', '', '', '', '', '', '']);

  var width = US.RES_COLS.length;
  var grid = rows.map(function (row) {
    var out = row.slice();
    while (out.length < width) out.push('');
    return out;
  });
  s.getRange(1, 1, grid.length, width).setValues(grid);

  // 見た目：見出しを太字に、区切りに色を付ける
  s.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#E3ECF5');
  s.getRange(2, 1, US.FIELDS.length, 1).setFontWeight('bold');
  [taskMarkRow, resMarkRow].forEach(function (rn) {
    s.getRange(rn, 1, 1, width).setFontWeight('bold').setBackground('#EDF0EA');
    s.getRange(rn + 1, 1, 1, width).setFontWeight('bold').setBackground('#F5F6F2');
  });
  s.setColumnWidth(1, 220);
  s.setColumnWidth(2, 260);
  s.setColumnWidth(3, 320);

  // 決まった選択肢はプルダウンにして、打ち間違いを減らす
  var fieldRow = function (label) { return US.FIELDS.map(function (f) { return f[0]; }).indexOf(label) + 2; };
  applyValidation_(s, fieldRow('学年'), 2, C.CHOICES.GRADE, 1);
  applyValidation_(s, fieldRow('裁量レベル（1指定／2選択／3自由）'), 2, C.CHOICES.DISCRETION, 1);
  applyValidation_(s, taskMarkRow + 2, 1, [C.TASK_KIND.MUST, C.TASK_KIND.CHOICE, C.TASK_KIND.ADVANCED]);
  applyValidation_(s, taskMarkRow + 2, 5, ['公開', '非公開']);
  applyValidation_(s, resMarkRow + 2, 5, C.RES_KIND);
  applyValidation_(s, resMarkRow + 2, 7, ['公開', '非公開']);

  return s;
}

/** 列にプルダウンを設定（既定で60行ぶん。書き足すぶんも先に用意しておく） */
function applyValidation_(sheet, startRow, col, values, rows) {
  try {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(values, true).setAllowInvalid(true).build();
    sheet.getRange(startRow, col, rows || 60, 1).setDataValidation(rule);
  } catch (e) { /* 検証が使えなくても取り込みはできる */ }
}

/** シート名に使える形にする（重複しても同じ単元なら同じシートを使う） */
function sheetNameFor_(unitName) {
  var safe = String(unitName).replace(/[\[\]\*\/\\\?:]/g, '_').slice(0, 80) || '単元';
  return US.PREFIX + safe;
}

/* ==================== 読み取り ==================== */

/** 単元シートを読んで {unitId, fields, tasks, resources} にする */
function parseUnitSheet_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length || String(values[0][0]).trim() !== US.MARK) {
    throw new Error('このシートは単元シートではありません。\nA1が「' + US.MARK + '」のシートを開いてから実行してください。');
  }

  var taskAt = -1, resAt = -1;
  for (var i = 0; i < values.length; i++) {
    var a = String(values[i][0]).trim();
    if (a === US.TASK_MARK) taskAt = i;
    if (a === US.RES_MARK) resAt = i;
  }
  if (taskAt < 0 || resAt < 0 || resAt < taskAt) {
    throw new Error('「' + US.TASK_MARK + '」と「' + US.RES_MARK + '」の行が見つかりません。\n書き出し直してから編集してください。');
  }

  // 単元の項目（A列が見出し、B列が値）
  var fields = {};
  for (var r = 1; r < taskAt; r++) {
    var label = String(values[r][0]).trim();
    var key = US.FIELD_MAP[label];
    if (key) fields[key] = values[r][1];
  }

  // 課題（見出し行の次から、資料の区切りまで）
  var tasks = [];
  for (var t = taskAt + 2; t < resAt; t++) {
    var row = values[t];
    var title = String(row[1] == null ? '' : row[1]).trim();
    if (!title) continue;
    tasks.push({
      row: t + 1,
      kind: String(row[0] == null ? '' : row[0]).trim(),
      title: title,
      desc: String(row[2] == null ? '' : row[2]),
      mins: row[3],
      published: String(row[4]).trim() === '公開',
      taskId: String(row[5] == null ? '' : row[5]).trim()
    });
  }

  // 資料（見出し行の次から最後まで）
  var resources = [];
  for (var x = resAt + 2; x < values.length; x++) {
    var rr = values[x];
    var rtitle = String(rr[2] == null ? '' : rr[2]).trim();
    if (!rtitle) continue;
    resources.push({
      row: x + 1,
      taskNo: String(rr[0] == null ? '' : rr[0]).trim(),
      icon: String(rr[1] == null ? '' : rr[1]).trim() || '📄',
      title: rtitle,
      note: String(rr[3] == null ? '' : rr[3]),
      kind: String(rr[4] == null ? '' : rr[4]).trim() || 'その他',
      url: String(rr[5] == null ? '' : rr[5]).trim(),
      published: String(rr[6]).trim() !== '非公開',
      resourceId: String(rr[7] == null ? '' : rr[7]).trim()
    });
  }

  return {
    unitId: String(values[0][1] == null ? '' : values[0][1]).trim(),
    fields: fields,
    tasks: tasks,
    resources: resources,
    taskIdCol: 6,
    resIdCol: 8
  };
}

/* ==================== 取り込み ==================== */

function importUnitSheet_(sheet, p) {
  var name = String(p.fields['単元名'] || '').trim();
  if (!name) throw new Error('単元名が空です。');

  var kinds = [C.TASK_KIND.MUST, C.TASK_KIND.CHOICE, C.TASK_KIND.ADVANCED];
  var out = {
    unitName: name, taskAdded: 0, taskUpdated: 0, taskDeleted: 0,
    resAdded: 0, resUpdated: 0, resDeleted: 0, kept: [], skipped: []
  };

  /* --- 単元 --- */
  var unitId = p.unitId;
  var unit = unitId ? firstWhere_(C.SH.UNIT, { unit_id: unitId }) : null;
  var unitFields = {
    '教科': p.fields['教科'] || '',
    '学年': p.fields['学年'] || '',
    '単元名': name,
    '単元目標': p.fields['単元目標'] || '',
    '成果物イメージ': p.fields['成果物イメージ'] || '',
    '総時数': p.fields['総時数'] || '',
    '裁量レベル': p.fields['裁量レベル'] || '2',
    '確認タイム間隔': Number(p.fields['確認タイム間隔']) || 0,
    '更新時刻': Repo.now()
  };

  if (unit) {
    Repo.updateByKey(C.SH.UNIT, 'unit_id', unitId, unitFields);
  } else {
    unitId = Repo.uuid();
    var row = { unit_id: unitId, '他者参照': 'FALSE', '他者参照モード': '記名', '状態': C.UNIT_STATE.DRAFT };
    for (var k in unitFields) row[k] = unitFields[k];
    Repo.append(C.SH.UNIT, row);
    sheet.getRange(1, 2).setValue(unitId);
  }

  /* --- 課題 --- */
  var existingTasks = Repo.where(C.SH.TASK, { unit_id: unitId });
  var seenTasks = {};
  var rowToTaskId = {};   // 資料の「課題番号」を解決するため

  p.tasks.forEach(function (t, ix) {
    if (kinds.indexOf(t.kind) < 0) {
      out.skipped.push(t.row + '行目「' + t.title + '」：種別が「' + t.kind + '」（必須／選択／発展のどれかにしてください）');
      return;
    }
    var mins = t.mins === '' || t.mins == null ? '' : Number(t.mins);
    if (mins !== '' && isNaN(mins)) mins = '';

    var fields = {
      '並び': ix + 1, '種別': t.kind, 'タイトル': t.title,
      '説明': t.desc || '', 'めやす分': mins, '公開': t.published ? 'TRUE' : 'FALSE'
    };

    var id = t.taskId;
    if (id && firstWhere_(C.SH.TASK, { task_id: id, unit_id: unitId })) {
      Repo.updateByKey(C.SH.TASK, 'task_id', id, fields);
      out.taskUpdated++;
    } else {
      id = Repo.uuid();
      var trow = { task_id: id, unit_id: unitId };
      for (var f in fields) trow[f] = fields[f];
      Repo.append(C.SH.TASK, trow);
      sheet.getRange(t.row, p.taskIdCol).setValue(id);
      out.taskAdded++;
    }
    seenTasks[id] = true;
    rowToTaskId[String(ix + 1)] = id;
  });

  // シートから消えた課題：記録がなければ消す、あれば残して知らせる
  existingTasks.forEach(function (t) {
    if (seenTasks[t['task_id']]) return;
    if (taskRecordCount_(t['task_id']) > 0) {
      out.kept.push('課題「' + t['タイトル'] + '」');
      return;
    }
    Repo.remove(C.SH.RES, { task_id: t['task_id'] });
    Repo.remove(C.SH.USTRAT, { task_id: t['task_id'] });
    Repo.remove(C.SH.TASK, { task_id: t['task_id'] });
    out.taskDeleted++;
  });

  /* --- 資料 --- */
  var existingRes = Repo.where(C.SH.RES, { unit_id: unitId });
  var seenRes = {};

  p.resources.forEach(function (r) {
    if (r.url && !/^https?:\/\//i.test(r.url)) {
      out.skipped.push(r.row + '行目「' + r.title + '」：URLは http:// か https:// で始めてください');
      return;
    }
    var taskId = '';
    if (r.taskNo) {
      taskId = rowToTaskId[String(Number(r.taskNo))] || '';
      if (!taskId) {
        out.skipped.push(r.row + '行目「' + r.title + '」：課題番号 ' + r.taskNo + ' の課題がありません');
        return;
      }
    }

    var fields = {
      task_id: taskId, 'アイコン': r.icon, 'タイトル': r.title, '補足': r.note,
      '種別': r.kind, 'URL': r.url, '公開': r.published ? 'TRUE' : 'FALSE'
    };

    var id = r.resourceId;
    if (id && firstWhere_(C.SH.RES, { resource_id: id, unit_id: unitId })) {
      Repo.updateByKey(C.SH.RES, 'resource_id', id, fields);
      out.resUpdated++;
    } else {
      id = Repo.uuid();
      var rrow = { resource_id: id, unit_id: unitId };
      for (var g in fields) rrow[g] = fields[g];
      Repo.append(C.SH.RES, rrow);
      sheet.getRange(r.row, p.resIdCol).setValue(id);
      out.resAdded++;
    }
    seenRes[id] = true;
  });

  // 資料は記録を持たないので、シートから消えたものはそのまま消す
  existingRes.forEach(function (r) {
    if (seenRes[r['resource_id']]) return;
    Repo.remove(C.SH.RES, { resource_id: r['resource_id'] });
    out.resDeleted++;
  });

  return out;
}

/** その課題にぶら下がる子どもの記録の件数 */
function taskRecordCount_(taskId) {
  var n = 0;
  [C.SH.PROG, C.SH.SEL, C.SH.SUSE, C.SH.LOG].forEach(function (sh) {
    n += Repo.where(sh, { task_id: taskId }).length;
  });
  return n;
}

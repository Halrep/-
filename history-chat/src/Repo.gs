/**
 * Repo.gs
 * シートCRUDの共通層。
 * - 主キーは UUID（行番号をIDにしない）
 * - 書き込みは LockService で直列化（同時アクセスでの行ずれを防ぐ）
 * - 読み取りは見出しをキーにしたオブジェクト配列で返す
 */
var Repo = (function () {

  function ss() { return SpreadsheetApp.getActive(); }

  /**
   * 1回の実行のあいだだけ持つ読み取りキャッシュ。
   * getDataRange().getValues() はシートを丸ごと読むので、1リクエストの中で
   * 同じシートを何度も読むと、そのぶんそのまま待ち時間になる。
   * 書き込んだシートはその場で捨てるので、同じ実行の中でも最新が返る。
   */
  var cache = {};
  function drop(name) { delete cache[name]; }

  function sheet(name) {
    var s = ss().getSheetByName(name);
    if (!s) {
      throw new Error('シート「' + name + '」がありません。メニュー「' + C.APP_NAME +
        ' ▸ 初期セットアップ」を実行してください。');
    }
    return s;
  }

  function exists(name) { return !!ss().getSheetByName(name); }

  /** 全行を {列名: 値} の配列で返す（空行はスキップ）。__row に実シート行番号を持たせる */
  function readAll(name) {
    if (cache[name]) return cache[name];
    var s = sheet(name);
    var values = s.getDataRange().getValues();
    if (values.length < 2) { cache[name] = []; return cache[name]; }
    var h = values[0];
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (row.join('') === '') continue;
      var obj = {};
      for (var c = 0; c < h.length; c++) obj[h[c]] = row[c];
      obj.__row = i + 1;
      out.push(obj);
    }
    cache[name] = out;
    return out;
  }

  /** 条件（{列:値, ...} すべて一致）に合う行を配列で返す */
  function where(name, match) {
    return readAll(name).filter(function (r) {
      for (var k in match) {
        if (String(r[k]) !== String(match[k])) return false;
      }
      return true;
    });
  }

  function firstWhere(name, match) {
    var rows = where(name, match);
    return rows.length ? rows[0] : null;
  }

  /**
   * 1行追加する。obj に無い列は空で埋める。
   * 呼び出し側でロックを取っていない場合は、ここで取る。
   */
  function append(name, obj) {
    return withLock(function () {
      var s = sheet(name);
      var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      var row = h.map(function (col) {
        return obj[col] === undefined || obj[col] === null ? '' : obj[col];
      });
      s.appendRow(row);
      drop(name);
      return obj;
    });
  }

  /** 複数行をまとめて追加する（1往復ぶんの発言など、ロックを1回で済ませたいとき） */
  function appendMany(name, objs) {
    if (!objs.length) return 0;
    return withLock(function () {
      var s = sheet(name);
      var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      var rows = objs.map(function (obj) {
        return h.map(function (col) {
          return obj[col] === undefined || obj[col] === null ? '' : obj[col];
        });
      });
      s.getRange(s.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
      drop(name);
      return rows.length;
    });
  }

  /** キー列が一致する行の一部の列を更新する */
  function updateByKey(name, keyCol, keyVal, patch) {
    return withLock(function () {
      var s = sheet(name);
      var values = s.getDataRange().getValues();
      var h = values[0];
      var ki = h.indexOf(keyCol);
      if (ki < 0) throw new Error('列「' + keyCol + '」がありません（' + name + '）');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][ki]) !== String(keyVal)) continue;
        for (var col in patch) {
          var ci = h.indexOf(col);
          if (ci >= 0) s.getRange(i + 1, ci + 1).setValue(patch[col]);
        }
        drop(name);
        return true;
      }
      return false;
    });
  }

  /**
   * 書き込みを直列化する。
   * ネストして呼ばれたときは二重に取らない（append を withLock の中から呼べる）。
   */
  var held = false;
  function withLock(fn) {
    if (held) return fn();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    held = true;
    try { return fn(); }
    finally { held = false; lock.releaseLock(); }
  }

  function uuid() { return Utilities.getUuid(); }
  function now() { return new Date(); }

  return {
    ss: ss, sheet: sheet, exists: exists,
    readAll: readAll, where: where, firstWhere: firstWhere,
    append: append, appendMany: appendMany, updateByKey: updateByKey,
    withLock: withLock, drop: drop, uuid: uuid, now: now
  };
})();

/**
 * Repo.gs
 * シートCRUDの共通層。
 * - 主キーは UUID（行番号をIDにしない）
 * - 書き込みは LockService で直列化（同時アクセスでの行ずれを防ぐ）
 * - 読み取りは見出しをキーにしたオブジェクト配列で返す
 */
var Repo = (function () {

  function ss() { return SpreadsheetApp.getActive(); }

  function sheet(name) {
    var s = ss().getSheetByName(name);
    if (!s) {
      throw new Error('シート「' + name + '」がありません。メニュー「' + C.APP_NAME +
        ' ▸ 初期セットアップ」を実行してください。');
    }
    return s;
  }

  /** 見出し行を配列で返す */
  function headers(name) {
    var s = sheet(name);
    return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  }

  /** 全行を {列名: 値} の配列で返す（空行はスキップ）。__row に実シート行番号を持たせる */
  function readAll(name) {
    var s = sheet(name);
    var values = s.getDataRange().getValues();
    if (values.length < 2) return [];
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

  /** 1行追加。obj の見出しに無いキーは無視、足りない列は空文字。ロックで直列化 */
  function append(name, obj) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var s = sheet(name);
      var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      var row = h.map(function (col) { return obj.hasOwnProperty(col) ? obj[col] : ''; });
      s.appendRow(row);
      return obj;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * 条件に一致する最初の行を patch で更新。無ければ match+patch を1行追加。
   * 「1児童1レコード」の目標・進度・振り返りなどに使う。ロックで直列化。
   * 戻り値: 'updated' | 'inserted'
   */
  function upsert(name, match, patch) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var s = sheet(name);
      var values = s.getDataRange().getValues();
      var h = values[0];
      var cols = {};
      h.forEach(function (col, i) { cols[col] = i; });

      for (var i = 1; i < values.length; i++) {
        var hit = true;
        for (var mk in match) {
          if (cols[mk] === undefined || String(values[i][cols[mk]]) !== String(match[mk])) { hit = false; break; }
        }
        if (hit) {
          for (var pk in patch) {
            if (cols[pk] !== undefined) s.getRange(i + 1, cols[pk] + 1).setValue(patch[pk]);
          }
          return 'updated';
        }
      }
      // 見つからなければ追加
      var merged = {};
      for (var a in match) merged[a] = match[a];
      for (var b in patch) merged[b] = patch[b];
      var newRow = h.map(function (col) { return merged.hasOwnProperty(col) ? merged[col] : ''; });
      s.appendRow(newRow);
      return 'inserted';
    } finally {
      lock.releaseLock();
    }
  }

  /** キー1つで行を特定して patch 更新。戻り値: true/false */
  function updateByKey(name, keyField, keyValue, patch) {
    return upsert(name, keyObj(keyField, keyValue), patch) === 'updated';
  }

  function keyObj(k, v) { var o = {}; o[k] = v; return o; }

  function uuid() { return Utilities.getUuid(); }
  function now() { return new Date(); }

  return {
    sheet: sheet,
    headers: headers,
    readAll: readAll,
    where: where,
    append: append,
    upsert: upsert,
    updateByKey: updateByKey,
    uuid: uuid,
    now: now
  };
})();

/** Date を ms(number) に。空や不正値は 0 を返す（クライアントでの時刻計算用） */
function toMs_(v) {
  if (!v) return 0;
  if (typeof v.getTime === 'function') { var t = v.getTime(); return isNaN(t) ? 0 : t; } // Date（realm非依存）
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { var d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime(); }
  return 0;
}

/** 真偽の緩い判定（シートの TRUE/'TRUE'/1 などを吸収） */
function truthy_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === '○';
}

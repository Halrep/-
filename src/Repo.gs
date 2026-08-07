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
   *
   * getDataRange().getValues() はシートを丸ごと読むので、1リクエストの中で
   * 同じシートを何度も読むと、そのぶんそのまま待ち時間になる
   * （例：単元シートの取り込みは課題1件ごとに firstWhere_ で全件を読み直していた）。
   * 書き込んだシートはその場で捨てるので、同じ実行の中でも最新が返る。
   *
   * 注意：返す行オブジェクトはキャッシュと共有される。呼び出し側で書き換えないこと
   *      （書き換えは Repo.append / upsert / updateByKey / remove を通す）。
   */
  var cache = {};
  function drop(name) { delete cache[name]; }
  function dropAll() { cache = {}; }

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

  /** 1行追加。obj の見出しに無いキーは無視、足りない列は空文字。ロックで直列化 */
  function append(name, obj) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var s = sheet(name);
      var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      var row = h.map(function (col) { return obj.hasOwnProperty(col) ? obj[col] : ''; });
      s.appendRow(row);
      drop(name);
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
          drop(name);
          return 'updated';
        }
      }
      // 見つからなければ追加
      var merged = {};
      for (var a in match) merged[a] = match[a];
      for (var b in patch) merged[b] = patch[b];
      var newRow = h.map(function (col) { return merged.hasOwnProperty(col) ? merged[col] : ''; });
      s.appendRow(newRow);
      drop(name);
      return 'inserted';
    } finally {
      lock.releaseLock();
    }
  }

  /** キー1つで行を特定して patch 更新。戻り値: true/false */
  function updateByKey(name, keyField, keyValue, patch) {
    return upsert(name, keyObj(keyField, keyValue), patch) === 'updated';
  }

  /** match に一致する行を消す。消した件数を返す（下から消して行番号のズレを避ける） */
  function remove(name, match) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var s = sheet(name);
      var values = s.getDataRange().getValues();
      var h = values[0];
      var cols = {};
      h.forEach(function (col, i) { cols[col] = i; });

      var hits = [];
      for (var i = 1; i < values.length; i++) {
        var hit = true;
        for (var mk in match) {
          if (cols[mk] === undefined || String(values[i][cols[mk]]) !== String(match[mk])) { hit = false; break; }
        }
        if (hit) hits.push(i + 1);
      }
      for (var j = hits.length - 1; j >= 0; j--) s.deleteRow(hits[j]);
      drop(name);
      return hits.length;
    } finally {
      lock.releaseLock();
    }
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
    dropCache: dropAll,
    updateByKey: updateByKey,
    remove: remove,
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

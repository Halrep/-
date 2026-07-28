/**
 * Repo.gs
 * シートCRUDと、名寄せ・キャッシュの中核。
 *
 * このアプリの設計上いちばん大事な層。
 * 「みんなの図鑑」に既にある生き物は Gemini を呼ばずにここから返す。
 * 日本の子供が調べる身近な生き物は数百種で頭打ちになるので、
 * 運用が進むほど API 呼び出しも待ち時間も GAS のクォータ消費も逓減していく。
 *
 * - 主キーは creature_id（UUID）。行番号をIDにしない
 * - 書き込みは LockService で直列化する
 * - 読み取りは CacheService に載せる（図鑑が育っても遅くならないように）
 */
var Repo = (function () {

  function ss() { return SpreadsheetApp.getActive(); }

  function sheet(name) {
    var s = ss().getSheetByName(name);
    if (!s) {
      throw new Error('シート「' + name + '」がありません。' +
        'メニュー「' + C.APP_NAME + ' ▸ 初期セットアップ」を実行してください。');
    }
    return s;
  }

  /** 全行を {列名: 値} の配列で返す。__row に実シート行番号を持たせる */
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

  /** 見出しの順に値を並べて1行追記する */
  function append(name, obj) {
    var s = sheet(name);
    var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    var row = h.map(function (k) {
      var v = obj[k];
      return (v === undefined || v === null) ? '' : v;
    });
    s.appendRow(row);
    return row;
  }

  /** creature_id で1行更新する */
  function updateById(name, id, patch) {
    var s = sheet(name);
    var rows = readAll(name);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].creature_id) !== String(id)) continue;
      var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      for (var k in patch) {
        var col = h.indexOf(k);
        if (col >= 0) s.getRange(rows[i].__row, col + 1).setValue(patch[k]);
      }
      return true;
    }
    return false;
  }

  /* ==================== 名寄せ ==================== */

  /**
   * 別名索引を {正規化キー: creature_id} と {ゆるいキー: creature_id} の
   * 2枚の辞書に畳んで返す。CacheService に載せる。
   */
  function aliasIndex() {
    var cache = CacheService.getScriptCache();
    var hit = cache.get('aliasIndex');
    if (hit) {
      try { return JSON.parse(hit); } catch (e) { /* 壊れていたら作り直す */ }
    }
    var exact = {}, loose = {};
    readAll(C.SH.ALIAS).forEach(function (r) {
      var id = String(r.creature_id);
      if (!id) return;
      var key = Kana.normalize(r['別名']);
      if (!key) return;
      exact[key] = id;
      // ゆるいキーは衝突しうるので、先に登録されたほうを優先する
      var lk = Kana.loosen(r['別名']);
      if (lk && !loose[lk]) loose[lk] = id;
    });
    var idx = { exact: exact, loose: loose };
    try { cache.put('aliasIndex', JSON.stringify(idx), C.CACHE_SEC); } catch (e) { /* 6MB超なら諦める */ }
    return idx;
  }

  function clearAliasCache() {
    CacheService.getScriptCache().remove('aliasIndex');
  }

  /**
   * 入力文字列から creature_id を引く。
   * 1段目＝正規化キーの完全一致、2段目＝ゆるいキーの一致。
   * 見つからなければ null。
   */
  function findIdByName(input) {
    var idx = aliasIndex();
    var k = Kana.normalize(input);
    if (!k) return null;
    if (idx.exact[k]) return idx.exact[k];
    var lk = Kana.loosen(input);
    if (lk && idx.loose[lk]) return idx.loose[lk];
    return null;
  }

  /** creature_id で図鑑の1行を返す。hidden の行は返さない */
  function getCreature(id) {
    var rows = readAll(C.SH.ZUKAN);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].creature_id) === String(id)) {
        if (String(rows[i].status) === C.STATUS.HIDDEN) return null;
        return rows[i];
      }
    }
    return null;
  }

  /** 図鑑の全行（公開分のみ）。一覧画面用 */
  function listCreatures() {
    return readAll(C.SH.ZUKAN).filter(function (r) {
      return String(r.status) !== C.STATUS.HIDDEN;
    });
  }

  /** 次の図鑑番号（No.001 の連番）を返す */
  function nextNumber() {
    var rows = readAll(C.SH.ZUKAN);
    var max = 0;
    rows.forEach(function (r) {
      var n = parseInt(r['番号'], 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return max + 1;
  }

  /* ==================== 書き込み ==================== */

  /**
   * 新しい生き物を図鑑に登録し、別名も索引に張る。
   * 同時アクセスで同じ生き物が二重登録されないよう、ロックの内側で
   * もう一度キャッシュを引き直す（ダブルチェック）。
   */
  function saveCreature(rec, aliases) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      clearAliasCache();
      var dup = findIdByName(rec['標準和名']);
      if (dup) return dup; // 待っている間に他の人が登録していた

      rec.creature_id = Utilities.getUuid();
      rec['番号'] = nextNumber();
      rec['初回登録日時'] = new Date();
      rec['閲覧回数'] = 1;
      rec.status = C.STATUS.PUBLISHED;
      append(C.SH.ZUKAN, rec);

      // 標準和名・よみ・別名をすべて索引に張る
      var names = [rec['標準和名'], rec['よみ']].concat(aliases || []);
      var seen = {};
      names.forEach(function (n) {
        var key = Kana.normalize(n);
        if (!key || seen[key]) return;
        seen[key] = true;
        append(C.SH.ALIAS, { '別名': String(n), 'creature_id': rec.creature_id });
      });

      clearAliasCache();
      return rec.creature_id;
    } finally {
      lock.releaseLock();
    }
  }

  /** 閲覧回数を1増やす（失敗しても検索は止めない） */
  function bumpViews(id) {
    try {
      var row = getCreature(id);
      if (!row) return;
      var n = parseInt(row['閲覧回数'], 10);
      updateById(C.SH.ZUKAN, id, { '閲覧回数': (isNaN(n) ? 0 : n) + 1 });
    } catch (e) {
      console.warn('閲覧回数の更新に失敗: ' + e);
    }
  }

  /** 検索ログを1行残す。保護者が異常な入力に気づけるようにする */
  function log(input, hit, id, ms) {
    try {
      append(C.SH.LOG, {
        '日時': new Date(), '入力': String(input),
        'ヒット種別': hit, 'creature_id': id || '', '所要ミリ秒': ms
      });
    } catch (e) {
      console.warn('検索ログの記録に失敗: ' + e);
    }
  }

  return {
    readAll: readAll,
    append: append,
    updateById: updateById,
    aliasIndex: aliasIndex,
    clearAliasCache: clearAliasCache,
    findIdByName: findIdByName,
    getCreature: getCreature,
    listCreatures: listCreatures,
    nextNumber: nextNumber,
    saveCreature: saveCreature,
    bumpViews: bumpViews,
    log: log
  };
})();

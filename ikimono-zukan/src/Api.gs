/**
 * Api.gs
 * 画面から google.script.run で呼ばれるサーバー関数。
 *
 * 検索の流れ（構想書 §1.2）
 *   入力 → 名寄せ → みんなの図鑑を探す
 *     ヒット  … シートから即座に返す（API呼び出しゼロ・約1秒）
 *     ミス    … Gemini → 安全フィルタ → 画像 → シートに追記（20秒前後）
 *
 * 画面に渡す時点で、ふりがな記法は HTML に、危険度と法規制は
 * 「どのカードを出さないか」に変換しておく。画面側に判断を残さない。
 */

/* ==================== 公開関数 ==================== */

/** 生き物を調べる */
function apiSearch(input) {
  var t0 = Date.now();
  var q = String(input || '').trim();
  if (!q) return { found: false, reason: 'empty' };
  if (q.length > 30) return { found: false, reason: 'toolong' };

  try {
    // --- 1. みんなの図鑑を探す ---
    var id = Repo.findIdByName(q);
    if (id) {
      var row = Repo.getCreature(id);
      if (row) {
        Repo.bumpViews(id);
        Repo.log(q, C.HIT.CACHE, id, Date.now() - t0);
        return viewFromRow_(row);
      }
    }

    // --- 2. Gemini に聞く ---
    var g = GeminiApi.lookup(q);
    if (!g || !g.is_creature || !g.canonical_name) {
      Repo.log(q, C.HIT.NOTFOUND, '', Date.now() - t0);
      return { found: false, reason: 'notcreature', input: q };
    }

    // 標準和名でもう一度キャッシュを引く。
    // 「だんごむし」で登録済みのものを「まるむし」で引いた場合、ここで拾える
    var again = Repo.findIdByName(g.canonical_name);
    if (again) {
      var r2 = Repo.getCreature(again);
      if (r2) {
        addAliases_(again, [q].concat(g.aliases || []));
        Repo.bumpViews(again);
        Repo.log(q, C.HIT.CACHE, again, Date.now() - t0);
        return viewFromRow_(r2);
      }
    }

    // --- 3. 安全フィルタ（AIより強い） ---
    var names = [g.canonical_name, g.reading].concat(g.aliases || []);
    var s = Safety.apply(g, names);

    // --- 4. 写真 ---
    var img = null;
    try {
      img = Images.fetchFor(g.wikipedia_title, g.canonical_name);
    } catch (e) {
      console.warn('画像の取得に失敗: ' + e);
    }

    // --- 5. 図鑑に追記 ---
    var rec = {
      '標準和名': s.canonical_name,
      'よみ': s.reading || '',
      'カテゴリ': C.CATEGORY.indexOf(s.category) >= 0 ? s.category : 'そのほか',
      '概要': s.summary || '',
      '生息地_json': JSON.stringify(s.habitat || {}),
      '捕まえ方_json': JSON.stringify(s.catching || {}),
      '餌_json': JSON.stringify(s.food || {}),
      '飼い方_json': JSON.stringify(s.keeping || {}),
      '危険度': s.danger_level || C.DANGER.SAFE,
      '危険メモ_json': JSON.stringify({
        notes: s.danger_notes || [],
        messages: s.safety_messages || [],
        hideCatching: !!s.hide_catching,
        hideKeeping: !!s.hide_keeping,
        overrides: s.overrides || []
      }),
      '法規制': s.legal_status || C.LEGAL.NONE,
      '放出禁止': !!s.release_warning,
      '飼育難易度': s.keeping_difficulty || C.DIFFICULTY.NORMAL,
      '画像ID': img ? img.fileId : '',
      '画像種別': img ? img.kind : C.IMG.NONE,
      '画像クレジット': img ? img.credit : '',
      '出典URL': (s.sources || []).join('\n')
    };
    var newId = Repo.saveCreature(rec, [q].concat(s.aliases || []));
    Repo.log(q, C.HIT.NEW, newId, Date.now() - t0);

    var saved = Repo.getCreature(newId);
    return saved ? viewFromRow_(saved) : { found: false, reason: 'savefailed' };

  } catch (e) {
    console.error(e);
    Repo.log(q, 'error', '', Date.now() - t0);
    return { found: false, reason: 'error', message: String(e.message || e) };
  }
}

/** みんなの図鑑の一覧 */
function apiList() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('list');
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* 作り直す */ }
  }
  var items = Repo.listCreatures().map(function (r) {
    return {
      id: String(r.creature_id),
      no: plateNo_(r['番号']),
      name: String(r['標準和名']),
      cat: String(r['カテゴリ']),
      img: thumbUrl_(r['画像ID'], 240),
      flag: flagOf_(r)
    };
  }).sort(function (a, b) { return a.no < b.no ? -1 : 1; });

  var out = { items: items, categories: C.CATEGORY };
  try { cache.put('list', JSON.stringify(out), 60); } catch (e) { /* 大きすぎたら諦める */ }
  return out;
}

/** 一覧から1件開く */
function apiGet(id) {
  var row = Repo.getCreature(id);
  if (!row) return { found: false, reason: 'notfound' };
  Repo.bumpViews(id);
  return viewFromRow_(row);
}

/** さがす画面の初期表示（最近の登録と、よく調べられている生き物） */
function apiHome() {
  var all = Repo.listCreatures();
  var recent = all.slice().sort(function (a, b) {
    return new Date(b['初回登録日時']) - new Date(a['初回登録日時']);
  }).slice(0, 4).map(function (r) {
    return {
      id: String(r.creature_id), no: plateNo_(r['番号']),
      name: String(r['標準和名']), cat: String(r['カテゴリ']),
      img: thumbUrl_(r['画像ID'], 120), isNew: true
    };
  });
  var popular = all.slice().sort(function (a, b) {
    return (parseInt(b['閲覧回数'], 10) || 0) - (parseInt(a['閲覧回数'], 10) || 0);
  }).slice(0, 8).map(function (r) { return String(r['標準和名']); });

  return { total: all.length, recent: recent, popular: popular };
}

/* ==================== 内部 ==================== */

/** シートの1行を、画面がそのまま描けるオブジェクトにする */
function viewFromRow_(r) {
  var meta = parseJson_(r['危険メモ_json'], { notes: [], messages: [] });
  var danger = String(r['危険度'] || C.DANGER.SAFE);
  var legal = String(r['法規制'] || C.LEGAL.NONE);

  var hideCatching = !!meta.hideCatching ||
                     danger === C.DANGER.DANGER ||
                     legal === C.LEGAL.BANNED ||
                     legal === C.LEGAL.PROTECTED ||
                     legal === C.LEGAL.PERMIT;
  var hideKeeping = !!meta.hideKeeping ||
                    legal === C.LEGAL.BANNED ||
                    legal === C.LEGAL.PROTECTED ||
                    legal === C.LEGAL.PERMIT ||
                    String(r['飼育難易度']) === C.DIFFICULTY.NO;

  return {
    found: true,
    id: String(r.creature_id),
    no: plateNo_(r['番号']),
    name: String(r['標準和名']),
    reading: String(r['よみ'] || ''),
    cat: String(r['カテゴリ']),
    summary: html_(r['概要']),

    danger: danger,
    legal: legal,
    release: Safety.isTrue(r['放出禁止']) || legal === C.LEGAL.CONDITIONAL,
    difficulty: String(r['飼育難易度'] || C.DIFFICULTY.NORMAL),
    dangerNotes: (meta.notes || []).map(html_),
    safetyMessages: (meta.messages || []).map(html_),

    habitat: block_(parseJson_(r['生息地_json'], {}), ['places', 'season']),
    catching: hideCatching ? null : block_(parseJson_(r['捕まえ方_json'], {}), ['tools', 'steps']),
    food: block_(parseJson_(r['餌_json'], {}), ['items', 'frequency']),
    keeping: hideKeeping ? null : block_(parseJson_(r['飼い方_json'], {}),
                                         ['container', 'environment', 'cautions']),
    hideCatching: hideCatching,
    hideKeeping: hideKeeping,

    image: {
      url: thumbUrl_(r['画像ID'], 800),
      kind: String(r['画像種別'] || C.IMG.NONE),
      credit: String(r['画像クレジット'] || '')
    },
    sources: String(r['出典URL'] || '').split('\n').filter(String),
    addedAt: formatDate_(r['初回登録日時'])
  };
}

/** 項目ブロックのテキストをHTMLに変換する */
function block_(o, keys) {
  var out = { text: html_(o.text) };
  keys.forEach(function (k) {
    var v = o[k];
    out[k] = Object.prototype.toString.call(v) === '[object Array]'
      ? v.map(html_) : html_(v);
  });
  return out;
}

/**
 * Gemini の出力を画面に流す唯一の経路。
 * 必ずエスケープしてから ｜漢字《かんじ》 を <ruby> に変換する。順序が逆だと防御にならない。
 */
function html_(s) {
  return Kana.toRuby(Kana.escapeHtml(s));
}

function parseJson_(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

/** 1 → "No.001" */
function plateNo_(n) {
  var v = parseInt(n, 10);
  if (isNaN(v)) return 'No.---';
  return 'No.' + ('00' + v).slice(-3);
}

/**
 * Drive の共有サムネイルURL。
 * data URI で埋め込むと一覧が数MBになるので、ここは URL で渡す。
 */
function thumbUrl_(fileId, size) {
  if (!fileId) return '';
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(String(fileId)) +
         '&sz=w' + (size || 400);
}

/** 一覧に出す小さな印 */
function flagOf_(r) {
  var d = String(r['危険度']), l = String(r['法規制']);
  if (d === C.DANGER.DANGER) return 'danger';
  if (l === C.LEGAL.BANNED || l === C.LEGAL.PROTECTED || l === C.LEGAL.PERMIT) return 'legal';
  if (l === C.LEGAL.CONDITIONAL) return 'release';
  return '';
}

function formatDate_(d) {
  if (!d) return '';
  try {
    return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd');
  } catch (e) { return ''; }
}

/** 既存の生き物に、新しい呼び方を索引として足す */
function addAliases_(id, names) {
  try {
    var idx = Repo.aliasIndex();
    var added = false;
    names.forEach(function (n) {
      var key = Kana.normalize(n);
      if (!key || idx.exact[key]) return;
      Repo.append(C.SH.ALIAS, { '別名': String(n), 'creature_id': id });
      idx.exact[key] = id;
      added = true;
    });
    if (added) Repo.clearAliasCache();
  } catch (e) {
    console.warn('別名の追加に失敗: ' + e);
  }
}

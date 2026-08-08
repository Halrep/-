/**
 * Figures.gs
 * 人物マスタと設定の読み出し。
 * 画面に渡すときは、事実メモや避ける話題といった「舞台裏」を落とす。
 * 子どもの端末に届くのは、画面に出すものだけ。
 */
var Figures = (function () {

  /** 設定シートを {キー: 値} で返す */
  function settings() {
    var out = {};
    C.SETTINGS_DEFAULT.forEach(function (d) { out[d[0]] = d[1]; });
    Repo.readAll(C.SHEET.SETTINGS).forEach(function (r) {
      if (r['キー'] !== '') out[String(r['キー'])] = r['値'];
    });
    return out;
  }

  function setSetting(key, value) {
    if (Repo.firstWhere(C.SHEET.SETTINGS, { 'キー': key })) {
      Repo.updateByKey(C.SHEET.SETTINGS, 'キー', key, { '値': value });
    } else {
      Repo.append(C.SHEET.SETTINGS, { 'キー': key, '値': value, '説明': '' });
    }
  }

  function num(v, dflt) {
    var n = Number(v);
    return isNaN(n) || v === '' ? dflt : n;
  }
  function bool(v) {
    return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1';
  }
  function lines(v) {
    return String(v || '').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });
  }

  /** 1行を、内部で使う人物オブジェクトにする */
  function toFigure(r) {
    return {
      id: String(r.figure_id),
      name: String(r['表示名'] || ''),
      yomi: String(r['よみ'] || ''),
      era: String(r['時代'] || ''),
      sub: String(r['一言紹介'] || ''),
      person: String(r['一人称'] || 'わたし'),
      tone: String(r['口調メモ'] || ''),
      voice: { rate: num(r['声_速さ'], 1), pitch: num(r['声_高さ'], 1) },
      sources: String(r['史料'] || ''),
      facts: String(r['事実メモ'] || ''),
      avoid: String(r['避ける話題'] || ''),
      seeds: lines(r['質問のたね']),
      portrait: {
        src:    String(r['肖像_URL'] || ''),
        title:  String(r['肖像_作品名'] || ''),
        by:     String(r['肖像_筆'] || ''),
        when:   String(r['肖像_制作年'] || ''),
        holder: String(r['肖像_所蔵'] || ''),
        cert:   String(r['肖像_確からしさ'] || C.CERT.LATE),
        note:   String(r['肖像_ひとこと'] || '')
      },
      open: bool(r['公開']),
      order: num(r['並び順'], 999)
    };
  }

  /** 全人物（教師画面用。事実メモも含む） */
  function all() {
    return Repo.readAll(C.SHEET.FIGURES)
      .filter(function (r) { return String(r.figure_id) !== ''; })
      .map(toFigure)
      .sort(function (a, b) { return a.order - b.order; });
  }

  function byId(id) {
    var hit = all().filter(function (f) { return f.id === String(id); });
    return hit.length ? hit[0] : null;
  }

  /**
   * 画面に渡す形。事実メモ・避ける話題・口調は落とす。
   * これらはプロンプトの材料であって、子どもに見せるものではない。
   */
  function forClient(f) {
    return {
      id: f.id, name: f.name, yomi: f.yomi, era: f.era, sub: f.sub,
      voice: f.voice, seeds: f.seeds, portrait: f.portrait,
      certLabel: C.CERT_LABEL[f.portrait.cert] || C.CERT_LABEL.late
    };
  }

  /** 公開されている人物だけ、画面用の形で返す */
  function published() {
    return all().filter(function (f) { return f.open; }).map(forClient);
  }

  return {
    settings: settings, setSetting: setSetting,
    all: all, byId: byId, published: published, forClient: forClient,
    num: num, bool: bool, lines: lines
  };
})();

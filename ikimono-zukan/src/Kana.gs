/**
 * Kana.gs
 * 文字列の正規化とふりがな記法の変換。
 *
 * 共有図鑑の生命線は名寄せにある。「だんごむし」「ダンゴムシ」「団子虫」「まるむし」を
 * 同じ1行に集約できるかどうかで、キャッシュのヒット率とAPI呼び出し回数が決まる。
 *
 * 正規化は2段階にしてある。
 *   normalize() … 表記ゆれを吸収した索引キー（カタカナ→ひらがな、全角→半角、記号除去）
 *   loosen()    … さらに小書き文字・濁点・長音を落とした「ゆるいキー」
 * 五十音キーボードを使う低学年は「しょうりょうばった」の小書きや濁点を落としがちなので、
 * normalize() で外したときの二段目の網として loosen() で拾う。
 *
 * 外部依存なし。tests/ から Node で直接テストできる。
 */
var Kana = (function () {

  // 濁音・半濁音 → 清音
  var DAKUTEN = {
    'が':'か','ぎ':'き','ぐ':'く','げ':'け','ご':'こ',
    'ざ':'さ','じ':'し','ず':'す','ぜ':'せ','ぞ':'そ',
    'だ':'た','ぢ':'ち','づ':'つ','で':'て','ど':'と',
    'ば':'は','び':'ひ','ぶ':'ふ','べ':'へ','ぼ':'ほ',
    'ぱ':'は','ぴ':'ひ','ぷ':'ふ','ぺ':'へ','ぽ':'ほ',
    'ゔ':'う'
  };

  // 小書き → 並字
  var SMALL = {
    'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お',
    'っ':'つ','ゃ':'や','ゅ':'ゆ','ょ':'よ','ゎ':'わ','ゕ':'か','ゖ':'け'
  };

  /** カタカナをひらがなに寄せる（長音符「ー」と、ひらがなに対応のないヷヸヹヺは触らない） */
  function kataToHira(s) {
    return s.replace(/[ァ-ヶ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  /**
   * 索引キーを作る。
   * 全角英数の半角化・濁点の合成は NFKC に任せ、そのうえで
   * カタカナをひらがなに寄せ、空白と記号を落とす。
   */
  function normalize(s) {
    if (s === null || s === undefined) return '';
    var t = String(s);
    if (t.normalize) t = t.normalize('NFKC');
    t = kataToHira(t);
    t = t.toLowerCase();
    // 空白（全角含む）と、名前に意味を持たない記号を落とす
    t = t.replace(/[\s　]/g, '');
    t = t.replace(/[!-\/:-@\[-`{-~！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～、。「」『』・…〜]/g, '');
    return t;
  }

  /**
   * ゆるいキー。normalize() でヒットしなかったときの二段目。
   * 小書き文字・濁点半濁点・長音符を落とすので
   * 「しようりようはつた」でも「ショウリョウバッタ」に届く。
   */
  function loosen(s) {
    var t = normalize(s);
    var out = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ch === 'ー' || ch === 'ー') continue;       // 長音符は落とす
      if (SMALL[ch]) ch = SMALL[ch];
      if (DAKUTEN[ch]) ch = DAKUTEN[ch];
      out += ch;
    }
    return out;
  }

  /**
   * ｜漢字《かんじ》 記法（青空文庫式）を <ruby> に変換する。
   * Gemini にこの記法で本文を返させることで、形態素解析の辞書を持たずに
   * ふりがなを実現できる。UIプレビューと同じ変換を使う。
   */
  function toRuby(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/｜([^《｜]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
  }

  /** ふりがな記法を外して素のテキストにする（ログや検索用） */
  function stripRuby(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/｜([^《｜]+)《([^》]+)》/g, '$1');
  }

  /**
   * ふりがなの付いていない漢字が残っているか。
   * ｜漢字《かんじ》 の区間を取り除いたあとに漢字が残れば true。
   * Gemini の出力検査と、登録済みの行の修復の両方で使う。
   */
  function hasBareKanji(s) {
    if (s === null || s === undefined) return false;
    var t = String(s).replace(/｜[^《｜]+《[^》]+》/g, '');
    return /[㐀-鿿々]/.test(t);
  }

  /**
   * HTMLエスケープ。Gemini の出力をそのまま画面に流し込まないための最低限の防御。
   * ふりがな変換より前に必ず通す。
   */
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    normalize: normalize,
    loosen: loosen,
    toRuby: toRuby,
    stripRuby: stripRuby,
    hasBareKanji: hasBareKanji,
    escapeHtml: escapeHtml,
    _kataToHira: kataToHira
  };
})();

/**
 * Safety.gs
 * 安全フィルタ。構想書 §5「第1層：人手の要注意リストが AI より優先する」の実装。
 *
 * 「捕まえ方」「飼い方」を子供に提示するアプリでは、AI の間違いがそのまま実害になる。
 * ハルシネーション対策の最後の砦がここで、AI の出力を無条件に上書きする。
 * 要注意リストはスプレッドシート上のマスタなので、保護者がコードを触らずに追記できる。
 *
 * 優先順位（下にいくほど強い）
 *   1. Gemini の出力
 *   2. カテゴリ規則（野鳥・けものは鳥獣保護管理法で捕獲に許可が要る）
 *   3. 要注意リストの名前パターン一致
 */
var Safety = (function () {

  /**
   * カテゴリ単位の規則。
   * 鳥獣保護管理法により、野鳥と野生の哺乳類は許可なく捕獲・飼育できない。
   * 子供がヒナを「保護」しようとして持ち帰る事故が多いため、
   * 個別の名前登録に頼らずカテゴリで一律に効かせる。
   */
  var CATEGORY_RULES = {
    'とり': {
      legal: 'permit_required',
      message: '｜野鳥《やちょう》は｜法律《ほうりつ》で｜守《まも》られて います。' +
               'つかまえたり、かったり しては いけません。' +
               'ヒナが｜落《お》ちて いても、まわりに｜親鳥《おやどり》が います。そっと して おきましょう。',
      hideCatch: true, hideKeep: true
    },
    'けもの': {
      legal: 'permit_required',
      message: '｜野生《やせい》の けものは｜法律《ほうりつ》で｜守《まも》られて います。' +
               'つかまえたり、かったり しては いけません。' +
               '｜病気《びょうき》を もって いる ことも あるので、さわらないで ください。',
      hideCatch: true, hideKeep: true
    }
  };

  /**
   * 要注意リストの初期データ。Setup 時にシートへ書き込まれる。
   * 名前パターンは正規化して部分一致で判定するので、
   * 「スズメバチ」は「オオスズメバチ」「キイロスズメバチ」にも当たる。
   */
  var SEED = [
    // ---- 毒・咬傷（素手で触らせない） ----
    ['スズメバチ', 'danger', 'none',
      'さされると いのちに かかわる ことが あります。ぜったいに｜近《ちか》づかないで ください。', true, true, '毒針・集団攻撃'],
    ['アシナガバチ', 'danger', 'none',
      'さされると とても いたく、はれます。｜巣《す》に｜近《ちか》づかないで ください。', true, true, '毒針'],
    ['ムカデ', 'danger', 'none',
      'かまれると｜強《つよ》い どくで はれます。｜見《み》つけても さわらないで ください。', true, true, '咬傷毒'],
    ['ゴケグモ', 'danger', 'invasive_banned',
      'つよい どくを もつ クモです。さわらず、おとなの｜人《ひと》に｜知《し》らせて ください。', true, true, 'セアカゴケグモ等・特定外来生物'],
    ['カバキコマチグモ', 'danger', 'none',
      'かまれると｜強《つよ》く いたみます。さわらないで ください。', true, true, '咬傷毒'],
    ['マムシ', 'danger', 'none',
      'どくヘビです。｜見《み》つけたら すぐに はなれて、おとなの｜人《ひと》を よんで ください。', true, true, '毒蛇'],
    ['ヤマカガシ', 'danger', 'none',
      'どくヘビです。おとなしく｜見《み》えても ぜったいに さわらないで ください。', true, true, '毒蛇'],
    ['ヒョウモンダコ', 'danger', 'none',
      'かまれると いのちに かかわる どくを もって います。ぜったいに さわらないで ください。', true, true, 'テトロドトキシン'],
    ['カツオノエボシ', 'danger', 'none',
      'さわると｜強《つよ》い どくで さされます。｜浜《はま》に｜打《う》ち｜上《あ》げられた ものも あぶないです。', true, true, '刺胞毒'],
    ['クラゲ', 'caution', 'none',
      'さされる｜種類《しゅるい》が います。｜素手《すで》で さわらないで ください。', true, true, '刺胞毒'],
    ['ゴンズイ', 'danger', 'none',
      'せびれと むなびれに どくの トゲが あります。さわらないで ください。', true, true, '毒棘'],
    ['ハオコゼ', 'danger', 'none',
      'せびれに どくの トゲが あります。さわらないで ください。', true, true, '毒棘'],
    ['アカエイ', 'danger', 'none',
      'しっぽに どくの トゲが あります。さわらないで ください。', true, true, '毒棘'],
    ['イラガ', 'danger', 'none',
      'さわると｜電気《でんき》が｜走《はし》った ように いたみます。さわらないで ください。', true, true, '毒毛虫'],
    ['ドクガ', 'danger', 'none',
      'どくの けが とんできて、はだが かゆく なります。｜近《ちか》づかないで ください。', true, true, '毒毛虫'],
    ['チャドクガ', 'danger', 'none',
      'どくの けで はだが とても かゆく なります。ツバキや サザンカに います。', true, true, '毒毛虫'],
    ['ヒアリ', 'danger', 'invasive_banned',
      'さされると とても いたく、あぶない アリです。｜見《み》つけたら おとなの｜人《ひと》に｜知《し》らせて ください。', true, true, '特定外来生物'],

    // ---- さわれるが手を洗う必要があるもの ----
    ['ヒキガエル', 'caution', 'none',
      'みみの うしろから どくを｜出《だ》します。さわった あとは｜必《かなら》ず｜手《て》を あらい、' +
      '｜目《め》を こすらないで ください。', false, false, '耳腺毒'],
    ['イモリ', 'caution', 'none',
      'はだに どくが あります。さわった あとは｜必《かなら》ず｜手《て》を あらって ください。', false, false, '皮膚毒'],

    // ---- 特定外来生物（飼育・生きた運搬すべて禁止） ----
    ['ウシガエル', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['カミツキガメ', 'danger', 'invasive_banned',
      'かまれると｜大《おお》けがを します。ぜったいに さわらないで ください。', true, true, '特定外来生物・咬傷'],
    ['アライグマ', 'danger', 'invasive_banned',
      '｜病気《びょうき》を もって いる ことが あります。さわらないで ください。', true, true, '特定外来生物'],
    ['ヌートリア', 'caution', 'invasive_banned', '', true, true, '特定外来生物'],
    ['ブルーギル', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['オオクチバス', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['ブラックバス', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['コクチバス', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['カダヤシ', 'safe', 'invasive_banned', '', true, true, '特定外来生物・メダカに似る'],
    ['オオヒキガエル', 'danger', 'invasive_banned',
      '｜強《つよ》い どくを もって います。さわらないで ください。', true, true, '特定外来生物'],
    ['クリハラリス', 'safe', 'invasive_banned', '', true, true, '特定外来生物（タイワンリス）'],
    ['タイワンリス', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['アルゼンチンアリ', 'safe', 'invasive_banned', '', true, true, '特定外来生物'],
    ['ツマアカスズメバチ', 'danger', 'invasive_banned',
      'さされると あぶない ハチです。ぜったいに｜近《ちか》づかないで ください。', true, true, '特定外来生物'],

    // ---- 条件付特定外来生物（飼育は可・野外への放出は違法） ----
    ['アメリカザリガニ', 'safe', 'conditional_invasive', '', false, false, '2023年6月〜条件付特定外来生物'],
    ['アカミミガメ', 'safe', 'conditional_invasive', '', false, false, '2023年6月〜条件付特定外来生物'],
    ['ミドリガメ', 'safe', 'conditional_invasive', '', false, false, 'アカミミガメの幼体の通称'],

    // ---- 天然記念物・保護種 ----
    ['オオサンショウウオ', 'safe', 'protected',
      '｜特別《とくべつ》｜天然《てんねん》｜記念物《きねんぶつ》です。さわる ことも できません。', true, true, '天然記念物'],
    ['ニホンカモシカ', 'safe', 'protected',
      '｜天然《てんねん》｜記念物《きねんぶつ》です。そっと｜見《み》まもりましょう。', true, true, '天然記念物'],
    ['ゲンゴロウ', 'caution', 'permit_required',
      'とても｜数《かず》が｜減《へ》って いる｜生《い》き｜物《もの》です。' +
      '｜売《う》り｜買《か》いは｜法律《ほうりつ》で きんし されて います。' +
      'かんさつ したら、もとの ばしょに かえして あげましょう。', false, true, '特定第二種国内希少野生動植物種'],
    ['タガメ', 'caution', 'permit_required',
      'とても｜数《かず》が｜減《へ》って いる｜生《い》き｜物《もの》です。' +
      '｜売《う》り｜買《か》いは｜法律《ほうりつ》で きんし されて います。' +
      'かんさつ したら、もとの ばしょに かえして あげましょう。', false, true, '特定第二種国内希少野生動植物種']
  ];

  /** 要注意リストを読み、正規化済みパターンの配列にして返す */
  function rules() {
    return Repo.readAll(C.SH.SAFETY).map(function (r) {
      return {
        pattern: Kana.normalize(r['名前パターン']),
        danger: String(r['危険度'] || '').trim(),
        legal: String(r['法規制'] || '').trim(),
        message: String(r['表示メッセージ'] || '').trim(),
        hideCatch: isTrue(r['捕獲を隠す']),
        hideKeep: isTrue(r['飼育を隠す'])
      };
    }).filter(function (r) { return r.pattern; });
  }

  function isTrue(v) {
    var s = String(v).toLowerCase().trim();
    return s === 'true' || s === 'はい' || s === '1' || s === 'yes' || v === true;
  }

  /** 危険度の強さ（大きいほど強い）。弱める方向の上書きはしない */
  function dangerRank(d) {
    return d === C.DANGER.DANGER ? 3 : d === C.DANGER.CAUTION ? 2 : 1;
  }

  /**
   * Gemini の出力に、カテゴリ規則と要注意リストを重ねる。
   * 元のオブジェクトは変更せず、上書き後の新しいオブジェクトを返す。
   *
   * @param {Object} g     Gemini が返した生き物データ
   * @param {Array}  names 照合に使う名前（標準和名・よみ・別名）
   * @return {Object} 上書き後のデータ。overrides に何が効いたかを残す
   */
  function apply(g, names) {
    var out = {};
    for (var k in g) out[k] = g[k];
    out.safety_messages = [];
    out.overrides = [];

    // --- カテゴリ規則 ---
    var cr = CATEGORY_RULES[g.category];
    if (cr) {
      out.legal_status = cr.legal;
      out.safety_messages.push(cr.message);
      if (cr.hideCatch) out.hide_catching = true;
      if (cr.hideKeep) out.hide_keeping = true;
      out.overrides.push('category:' + g.category);
    }

    // --- 要注意リスト（AIより強い） ---
    var hay = (names || []).concat([g.canonical_name]).map(Kana.normalize);
    rules().forEach(function (r) {
      var matched = hay.some(function (h) { return h && h.indexOf(r.pattern) >= 0; });
      if (!matched) return;

      if (r.danger && dangerRank(r.danger) > dangerRank(out.danger_level)) {
        out.danger_level = r.danger;
      }
      if (r.legal && r.legal !== C.LEGAL.NONE) out.legal_status = r.legal;
      if (r.message) out.safety_messages.push(r.message);
      if (r.hideCatch) out.hide_catching = true;
      if (r.hideKeep) out.hide_keeping = true;
      out.overrides.push('list:' + r.pattern);
    });

    // --- 法規制から導かれる、画面上の帰結 ---
    // 特定外来生物は生きた運搬も禁止なので、捕まえ方も出さない
    if (out.legal_status === C.LEGAL.BANNED) {
      out.hide_catching = true;
      out.hide_keeping = true;
    }
    if (out.legal_status === C.LEGAL.PROTECTED) {
      out.hide_catching = true;
      out.hide_keeping = true;
    }
    // 危険な生き物には捕まえ方を出さない
    if (out.danger_level === C.DANGER.DANGER) {
      out.hide_catching = true;
    }
    // 飼育を勧められない生き物は飼い方を出さない
    if (out.keeping_difficulty === C.DIFFICULTY.NO) {
      out.hide_keeping = true;
    }
    // 条件付特定外来生物は飼えるが、放出禁止の警告が常時ついてまわる
    if (out.legal_status === C.LEGAL.CONDITIONAL) {
      out.release_warning = true;
    }

    return out;
  }

  return {
    apply: apply,
    rules: rules,
    dangerRank: dangerRank,
    isTrue: isTrue,
    SEED: SEED,
    CATEGORY_RULES: CATEGORY_RULES
  };
})();

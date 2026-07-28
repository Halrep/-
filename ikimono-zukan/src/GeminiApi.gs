/**
 * GeminiApi.gs
 * Gemini API 呼び出し層。
 *
 * 構造化出力（responseJsonSchema）と Google 検索によるグラウンディング（googleSearch）を
 * 併用する。これにより「必ず同じフィールド構成で」「検索で裏づけた」情報が1回の呼び出しで得られる。
 *
 * APIキーは ScriptProperties に置き、この層だけが読む。
 * 子供の端末にキーが渡らないことが、GAS を選んだ最大の理由。
 */
var GeminiApi = (function () {

  var ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

  function apiKey() {
    var k = PropertiesService.getScriptProperties().getProperty(C.PROP.API_KEY);
    if (!k) {
      throw new Error('Gemini の API キーが未設定です。' +
        'スプレッドシートのメニュー「' + C.APP_NAME + ' ▸ APIキーを設定」から登録してください。');
    }
    return k;
  }

  function model() {
    return PropertiesService.getScriptProperties().getProperty(C.PROP.MODEL) || C.DEFAULT_MODEL;
  }

  /**
   * このキーで使えるモデルの一覧を返す。
   * モデル名は入れ替わるので、動かなくなったら GAS エディタから実行して
   * 「設定 ▸ スクリプトプロパティ」の GEMINI_MODEL を差し替える。
   */
  function listModels() {
    var res = UrlFetchApp.fetch(ENDPOINT.replace(/\/$/, ''), {
      method: 'get',
      headers: { 'x-goog-api-key': apiKey() },
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText());
    var names = (body.models || [])
      .filter(function (m) {
        return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
      })
      .map(function (m) { return m.name.replace('models/', ''); });
    console.log(names.join('\n'));
    return names;
  }

  /* ==================== 出力スキーマ ==================== */

  /**
   * 構想書 §4 のスキーマ。
   * danger_level と legal_status を必須にしているのが要。
   * 任意フィールドにすると、モデルは危険な生き物ほど饒舌に飼い方を語り、
   * 警告のほうを省略しがちになる。
   */
  function schema() {
    var textBlock = function (extra) {
      var props = { text: { type: 'string' } };
      for (var k in extra) props[k] = extra[k];
      var req = Object.keys(props);
      return { type: 'object', properties: props, required: req };
    };
    var strArray = { type: 'array', items: { type: 'string' } };

    return {
      type: 'object',
      required: [
        'is_creature', 'canonical_name', 'reading', 'aliases', 'category',
        'summary', 'habitat', 'catching', 'food', 'keeping',
        'danger_level', 'danger_notes', 'legal_status', 'release_warning',
        'keeping_difficulty', 'wikipedia_title'
      ],
      properties: {
        is_creature: { type: 'boolean' },
        canonical_name: { type: 'string' },
        reading: { type: 'string' },
        aliases: strArray,
        category: { type: 'string', enum: C.CATEGORY },

        summary: { type: 'string' },
        habitat: textBlock({ places: strArray, season: { type: 'string' } }),
        catching: textBlock({ tools: strArray, steps: strArray }),
        food: textBlock({ items: strArray, frequency: { type: 'string' } }),
        keeping: textBlock({
          container: { type: 'string' },
          environment: { type: 'string' },
          cautions: strArray
        }),

        danger_level: { type: 'string', enum: ['safe', 'caution', 'danger'] },
        danger_notes: strArray,
        legal_status: {
          type: 'string',
          enum: ['none', 'conditional_invasive', 'invasive_banned', 'protected', 'permit_required']
        },
        release_warning: { type: 'boolean' },
        keeping_difficulty: {
          type: 'string',
          enum: ['easy', 'normal', 'hard', 'not_recommended']
        },

        wikipedia_title: { type: 'string' }
      }
    };
  }

  /* ==================== プロンプト ==================== */

  var SYSTEM = [
    'あなたは日本の子供向けの図鑑を書く編集者です。日本国内で見られる生き物について答えます。',
    '',
    '【文章の書き方】',
    '・小学校2〜4年生が声に出して読める文章にする。1文を短く、やさしい言葉で書く。',
    '・漢字には必ずふりがなを付ける。ふりがなは ｜漢字《かんじ》 という記法で書く。',
    '　例：｜樹液《じゅえき》の｜出《で》て いる｜木《き》',
    '・熟語は1語にまとめてふりがなを付ける。1文字ずつに分けない。',
    '　○ ｜野鳥《やちょう》　× ｜野《や》｜鳥《ちょう》（表示が分断されて読みにくくなる）',
    '・カタカナ語と、小学校1〜2年で習う漢字（山・川・木・虫・水・手・目 など）には付けなくてよい。',
    '・生き物の名前そのものにはふりがなを付けない（reading フィールドで別に返すため）。',
    '',
    '【正確さ】',
    '・検索で裏づけが取れないことは書かない。断定できないことは書かない。',
    '・wikipedia_title には、日本語版 Wikipedia に実在する正確な記事名を入れる。',
    '　これは写真を探すのに使うので、通称ではなく記事名を入れること。',
    '・aliases には、子供が入力しそうな別の呼び方をすべて入れる。',
    '　ひらがな・カタカナ・漢字・地方名・俗称（例：だんごむし、団子虫、まるむし）。',
    '',
    '【安全】ここが最も重要です。',
    '・素手で捕まえる方法を書く前に、必ず危険性を評価する。',
    '・毒・咬傷・かぶれ・アレルギーの可能性が少しでもあれば danger_notes に具体的に書く。',
    '・飼育や捕獲が法律で規制されている可能性があれば legal_status を必ず立てる。',
    '　特定外来生物は invasive_banned、アメリカザリガニとアカミミガメは conditional_invasive、',
    '　天然記念物や希少種は protected、野鳥や野生哺乳類は permit_required。',
    '・野外に放してはいけない生き物は release_warning を true にする。',
    '・おうちで飼うのが難しい生き物は keeping_difficulty を not_recommended にする。',
    '・keeping には「観察したら元の場所に返してあげよう」という姿勢を必ず含める。',
    '',
    '【生き物でない入力】',
    '・入力が生き物の名前でない、または実在しない場合は is_creature を false にし、',
    '　ほかのフィールドは空文字・空配列・safe・none で埋める。'
  ].join('\n');

  /* ==================== 呼び出し ==================== */

  /**
   * 生き物の名前から図鑑データを取得する。
   * @param {string} name 子供が入力した文字列
   * @return {Object} スキーマどおりのオブジェクト。sources に出典URLが入る
   */
  function lookup(name) {
    var body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [{
          text: '「' + name + '」という生き物について、図鑑の項目を作ってください。\n' +
                '日本国内で見られる種を想定してください。'
        }]
      }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: schema()
      }
    };

    var res = request_(body);
    var cand = (res.candidates || [])[0];
    if (!cand) {
      throw new Error('Gemini から応答がありませんでした。しばらく待って もう一度お試しください。');
    }
    if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
      // SAFETY などで止まった場合。子供向けアプリなので、握りつぶさず「見つからなかった」に倒す
      console.warn('finishReason=' + cand.finishReason);
      return { is_creature: false, _finishReason: cand.finishReason };
    }

    var text = (cand.content && cand.content.parts || [])
      .map(function (p) { return p.text || ''; }).join('');
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Gemini の応答を読み取れませんでした。もう一度お試しください。');
    }

    data.sources = groundingUrls_(cand);
    return data;
  }

  /** グラウンディングで実際に参照されたURLを取り出す */
  function groundingUrls_(cand) {
    var gm = cand.groundingMetadata;
    if (!gm || !gm.groundingChunks) return [];
    var urls = [];
    gm.groundingChunks.forEach(function (c) {
      var w = c.web || c.retrievedContext;
      if (w && w.uri && urls.indexOf(w.uri) < 0) urls.push(w.uri);
    });
    return urls.slice(0, 8);
  }

  /** 429/503 は1回だけ待って再試行する */
  function request_(body) {
    var url = ENDPOINT + model() + ':generateContent';
    var opts = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey() },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    };

    for (var attempt = 0; attempt < 2; attempt++) {
      var res = UrlFetchApp.fetch(url, opts);
      var code = res.getResponseCode();
      if (code === 200) return JSON.parse(res.getContentText());

      if ((code === 429 || code === 503) && attempt === 0) {
        Utilities.sleep(2000);
        continue;
      }
      throw new Error(describeError_(code, res.getContentText()));
    }
  }

  /** APIのエラーを、原因のわかる日本語にする */
  function describeError_(code, text) {
    var detail = '';
    try { detail = (JSON.parse(text).error || {}).message || ''; } catch (e) { detail = text.slice(0, 200); }

    if (code === 400 && /API key not valid/i.test(detail)) {
      return 'Gemini の API キーが正しくありません。メニューから登録し直してください。';
    }
    if (code === 404) {
      return 'モデル「' + model() + '」が見つかりません。' +
             'GAS エディタで GeminiApi.listModels() を実行し、使えるモデル名を ' +
             'スクリプトプロパティ ' + C.PROP.MODEL + ' に設定してください。';
    }
    if (code === 429) {
      return 'Gemini の利用上限に達しました。しばらく待ってから もう一度お試しください。';
    }
    return 'Gemini の呼び出しに失敗しました（HTTP ' + code + '）: ' + detail;
  }

  return {
    lookup: lookup,
    listModels: listModels,
    schema: schema,
    _describeError: describeError_
  };
})();

/** GAS エディタから直接実行するためのラッパー */
function listModels() { return GeminiApi.listModels(); }

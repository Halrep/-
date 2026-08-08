/**
 * Chat.gs
 * ガードレール → プロンプト組み立て → Gemini 呼び出し → 保存。
 *
 * 【1往復の流れ】
 *  1. ガードレールを通す（公開人物か／文字数／本日の残り回数）
 *  2. 人物マスタの設定と直近の数往復からプロンプトを作る
 *  3. Gemini を呼ぶ（構造化出力で say / cite / guess を受け取る）
 *  4. 児童の発言と人物の返事を、まとめて1回のロックで保存する
 *
 * 失敗したときは児童の発言も保存しない。往復を消費させず「もう一度おくってみて」を出す。
 */
var Chat = (function () {

  /* ============================================================
     プロンプト
     ============================================================ */

  /**
   * 人物のシステムプロンプトを組み立てる。
   * 事実メモに書いてあることだけが「記録にある」扱いになり、
   * それ以外は必ず断りを入れてから話させる。ここがこのアプリの背骨。
   */
  function buildSystem(f) {
    var p = [];
    p.push('あなたは' + f.name + 'です。' + f.era + 'の時代に生きた人物として、一人称で話してください。');
    p.push('一人称は「' + f.person + '」。話し方: ' + f.tone);
    p.push('');
    p.push('【あなたが確かに知っていること】');
    p.push('次の各行は、実際に残っている史料に基づく事実です。行末の〔〕がその史料名です。');
    p.push(f.facts);
    p.push('');
    p.push('【守ること】');
    p.push('1. 上の「確かに知っていること」は、自信をもって語ってよい。' +
           'そのとき say にその内容を書き、cite にもとになった史料名を書く。');
    p.push('2. そこに書かれていないが、あなたの時代・立場から言えそうなことは、guess に書く。' +
           'guess には必ず「記録には残っておらぬが」等の断りを自分の言葉で入れること。cite は空にする。');
    p.push('3. あなたが死んだ後の出来事は「わしの死んだあとのことは、わからぬ」の意味のことを答える。' +
           '現代の物事を知ったふりをしない。');
    p.push('4. 相手は小学6年生。むずかしい言葉には、短い言い換えをそえる。' +
           'ふりがなは付けず、やさしい言い方に置きかえる。');
    p.push('5. say は3〜5文。長く語らない。guess があるときは、guess も2〜3文にとどめる。');
    p.push('6. 質問が「確かに知っていること」で答えられるなら、guess は空でよい。' +
           '無理に推測を足さない。');
    if (f.avoid) {
      p.push('7. 次の話題には触れない。向けられたら、やんわり別の話に戻す: ' + f.avoid);
    }
    p.push('');
    p.push('相手が名前や住所などの個人的なことを書いてきても、それには触れないこと。');
    p.push('出力は say / cite / guess の3つだけ。地の文やト書きは書かない。');
    return p.join('\n');
  }

  /** 直近の往復を Gemini の contents 形式にする */
  function buildContents(history, text) {
    var contents = history.map(function (m) {
      return {
        role: m.who === C.SPEAKER.CHILD ? 'user' : 'model',
        parts: [{ text: m.text }]
      };
    });
    contents.push({ role: 'user', parts: [{ text: text }] });
    return contents;
  }

  /* ============================================================
     Gemini
     ============================================================ */

  function apiKey() {
    return PropertiesService.getScriptProperties().getProperty(C.PROP.API_KEY) || '';
  }
  function hasKey() { return !!apiKey(); }

  /** この鍵で使えるモデルの一覧。教師が推測せずに選べるようにする */
  function listModels() {
    var key = apiKey();
    if (!key) throw new Error('APIキーが登録されていません。');
    var res = UrlFetchApp.fetch(C.GEMINI.BASE + '/models?key=' + encodeURIComponent(key) + '&pageSize=200',
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('モデル一覧を取れませんでした（' + res.getResponseCode() + '）。鍵が正しいか確かめてください。');
    }
    var data = JSON.parse(res.getContentText());
    return (data.models || []).filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
    }).map(function (m) {
      return { id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name };
    });
  }

  /**
   * Gemini を1回呼ぶ。
   * 構造化出力（responseMimeType + responseSchema）で say / cite / guess を受け取る。
   * 崩れて返ってきたときは、全体を say として扱う。
   */
  function callGemini(model, systemText, contents) {
    var key = apiKey();
    if (!key) throw new Error('NO_KEY');
    if (!model) throw new Error('NO_MODEL');

    var body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: contents,
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            say:   { type: 'STRING' },
            cite:  { type: 'STRING' },
            guess: { type: 'STRING' }
          },
          required: ['say']
        }
      }
    };

    var res = UrlFetchApp.fetch(
      C.GEMINI.BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      }
    );

    var code = res.getResponseCode();
    var raw = res.getContentText();
    if (code !== 200) {
      Logger.log('Gemini ' + code + ': ' + raw);
      if (code === 400 && raw.indexOf('API_KEY') >= 0) throw new Error('BAD_KEY');
      if (code === 404) throw new Error('BAD_MODEL');
      if (code === 429) throw new Error('QUOTA');
      throw new Error('API_' + code);
    }

    var data = JSON.parse(raw);
    var cand = (data.candidates || [])[0];
    if (!cand) throw new Error('EMPTY');
    // 安全フィルタなどで止まった場合
    if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
      throw new Error('BLOCKED');
    }
    var text = ((cand.content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
    if (!text) throw new Error('EMPTY');

    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { obj = { say: text, cite: '', guess: '' }; }

    return {
      say:   String(obj.say || '').trim(),
      cite:  String(obj.cite || '').trim(),
      guess: String(obj.guess || '').trim()
    };
  }

  /* ============================================================
     会話と発言
     ============================================================ */

  /** その人物との会話を取り出す。無ければ作る */
  function openConversation(userId, figureId) {
    var hit = Repo.where(C.SHEET.CONV, { user_id: userId, figure_id: figureId });
    if (hit.length) return hit[hit.length - 1];
    var row = {
      conversation_id: Repo.uuid(), user_id: userId, figure_id: figureId,
      '開始時刻': Repo.now(), '最終更新': Repo.now(), '往復数': 0
    };
    Repo.append(C.SHEET.CONV, row);
    return row;
  }

  /** 直近 n 往復ぶんの発言を、古い順で返す */
  function recent(conversationId, turns) {
    var all = Repo.where(C.SHEET.MSG, { conversation_id: conversationId });
    var take = all.slice(Math.max(0, all.length - turns * 2));
    return take.map(function (m) {
      var t = String(m['本文'] || '');
      if (m['話者'] === C.SPEAKER.FIGURE && m['推測']) t += '\n' + m['推測'];
      return { who: String(m['話者']), text: t };
    });
  }

  /** その日の往復数（上限の判定に使う） */
  function todayTurns(userId) {
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var convIds = {};
    Repo.where(C.SHEET.CONV, { user_id: userId }).forEach(function (c) {
      convIds[String(c.conversation_id)] = true;
    });
    var n = 0;
    Repo.readAll(C.SHEET.MSG).forEach(function (m) {
      if (m['話者'] !== C.SPEAKER.CHILD) return;
      if (!convIds[String(m.conversation_id)]) return;
      if (!m['時刻']) return;
      var d = Utilities.formatDate(new Date(m['時刻']), 'Asia/Tokyo', 'yyyy-MM-dd');
      if (d === today) n++;
    });
    return n;
  }

  /* ============================================================
     1往復
     ============================================================ */

  /**
   * 送る。返すのは画面に出すものだけ。
   * @return {{say:string, cite:string, guess:string, remain:number}}
   */
  function send(user, figureId, text) {
    var st = Figures.settings();
    var maxLen  = Figures.num(st['入力文字数上限'], 120);
    var maxDay  = Figures.num(st['1日の往復上限'], 30);
    var turns   = Figures.num(st['履歴の往復数'], 6);
    var model   = String(st['モデル'] || '').trim();

    // --- ガードレール ---
    text = String(text || '').trim();
    if (!text) throw new Error('からっぽです。');
    if (text.length > maxLen) throw new Error(maxLen + '文字までにしてね。');

    var f = Figures.byId(figureId);
    if (!f) throw new Error('その人物は見つかりません。');
    if (!f.open && user.role !== C.ROLE.TEACHER) throw new Error('その人物はいま話せません。');

    var used = maxDay > 0 ? todayTurns(user.id) : 0;
    if (maxDay > 0 && used >= maxDay) {
      throw new Error('きょうはもう ' + maxDay + 'かい 話しました。また あした。');
    }

    if (!hasKey()) throw new Error('NO_KEY');
    if (!model) throw new Error('NO_MODEL');

    // --- 呼ぶ ---
    var conv = openConversation(user.id, f.id);
    var history = recent(conv.conversation_id, turns);
    var reply = callGemini(model, buildSystem(f), buildContents(history, text));

    // --- 保存（1往復ぶんをまとめて1回のロックで） ---
    var t = Repo.now();
    var figureMsgId = Repo.uuid();
    Repo.appendMany(C.SHEET.MSG, [
      {
        message_id: Repo.uuid(), conversation_id: conv.conversation_id,
        '話者': C.SPEAKER.CHILD, '本文': text, '出典': '', '推測': '', '言いかえ': '',
        '時刻': t, '教師フラグ': false
      },
      {
        message_id: figureMsgId, conversation_id: conv.conversation_id,
        '話者': C.SPEAKER.FIGURE, '本文': reply.say, '出典': reply.cite, '推測': reply.guess,
        '言いかえ': '', '時刻': t, '教師フラグ': false
      }
    ]);
    Repo.updateByKey(C.SHEET.CONV, 'conversation_id', conv.conversation_id, {
      '最終更新': t,
      '往復数': Figures.num(conv['往復数'], 0) + 1
    });

    return {
      messageId: figureMsgId,
      say: reply.say, cite: reply.cite, guess: reply.guess,
      remain: maxDay > 0 ? Math.max(0, maxDay - (used + 1)) : -1
    };
  }

  /* ============================================================
     やさしく言いかえる
     ============================================================ */

  /**
   * すでに保存してある人物の発言を、もっとやさしい言葉で言い直す。
   *
   * 言い直す対象は message_id で指すので、画面から任意の文章を送らせない
   * （子どもの端末を通じて好きな文章を Gemini に投げられないようにする）。
   * 結果は「言いかえ」列に残す。どの返事でつまずいたかが、そのまま教師の手がかりになる。
   */
  function simplify(user, messageId) {
    var st = Figures.settings();
    var model = String(st['モデル'] || '').trim();
    if (!hasKey()) throw new Error('NO_KEY');
    if (!model) throw new Error('NO_MODEL');

    var msg = Repo.firstWhere(C.SHEET.MSG, { message_id: String(messageId) });
    if (!msg) throw new Error('その返事が見つかりません。');
    if (msg['話者'] !== C.SPEAKER.FIGURE) throw new Error('言いかえられるのは人物の返事だけです。');

    // 持ち主の確認は、保存済みを返す前に行う。
    // 順番を逆にすると、一度言いかえた返事だけ他人でも読めてしまう。
    var conv = Repo.firstWhere(C.SHEET.CONV, { conversation_id: String(msg.conversation_id) });
    if (!conv) throw new Error('その返事が見つかりません。');
    if (String(conv.user_id) !== String(user.id) && user.role !== C.ROLE.TEACHER) {
      throw new Error('ほかの人の会話は言いかえられません。');
    }

    // すでに言いかえてあれば、呼び直さずそれを返す（費用も待ち時間も要らない）
    if (String(msg['言いかえ'] || '') !== '') return { text: String(msg['言いかえ']) };

    var body = String(msg['本文'] || '');
    if (String(msg['推測'] || '') !== '') body += '\n' + msg['推測'];

    var sys = [
      'つぎの文を、小学5・6年生が読めるように やさしく言いかえてください。',
      '',
      '守ること',
      '1. 意味を変えない。新しいことを足さない。書いていないことを付け加えない。',
      '2. むずかしい言葉は、やさしい言葉に置きかえる。' +
        '置きかえられない歴史の言葉（御家人、執権など）は残し、すぐ後ろに（　）で短く説明する。',
      '3. 一文を短くする。長い文は2つに分ける。',
      '4. もとの人物の話し方（一人称や語尾）はそのままにする。',
      '5. 説明や前置きを書かない。言いかえた文だけを返す。'
    ].join('\n');

    var out = callGemini(model, sys, [{ role: 'user', parts: [{ text: body }] }]);
    var text = String(out.say || '').trim();
    if (!text) throw new Error('EMPTY');

    Repo.updateByKey(C.SHEET.MSG, 'message_id', String(messageId), { '言いかえ': text });
    return { text: text };
  }

  return {
    send: send, simplify: simplify, listModels: listModels, hasKey: hasKey,
    buildSystem: buildSystem, todayTurns: todayTurns,
    openConversation: openConversation, recent: recent
  };
})();

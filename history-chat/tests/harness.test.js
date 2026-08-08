/**
 * harness.test.js
 * GAS を使わずに、サーバー側のロジックを Node で動かして確かめる。
 *
 *   node history-chat/tests/harness.test.js
 *
 * SpreadsheetApp / UrlFetchApp / PropertiesService を差し替え、
 * シートは配列で持つ。Gemini は呼ばずに、決めた形の応答を返す。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

/* ============================================================
   GAS のかわり
   ============================================================ */
let uuidN = 0;
global.Utilities = {
  getUuid: () => 'uuid-' + (++uuidN),
  formatDate: (d) => new Date(d).toISOString().slice(0, 10)
};
global.Logger = { log: () => {} };
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => 'DUMMY-KEY' })
};

function load(file) { eval.call(global, fs.readFileSync(path.join(SRC, file), 'utf8')); }

/* ============================================================
   ものさし
   ============================================================ */
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + label + (extra ? ' :: ' + extra : '')); }
  else { fail++; console.log('  NG   ' + label + (extra ? ' :: ' + extra : '')); }
}
function expectErr(label, fn, frag) {
  try { fn(); fail++; console.log('  NG   ' + label + ' :: 例外が出なかった'); }
  catch (e) {
    const m = String(e.message || e);
    if (m.includes(frag)) { pass++; console.log('  OK   ' + label + ' :: ' + m); }
    else { fail++; console.log('  NG   ' + label + ' :: ' + m + '（期待: ' + frag + '）'); }
  }
}
function section(t) { console.log('\n■ ' + t); }

/* ============================================================
   偽シート
   ============================================================ */
load('Constants.gs');
load('Seed.gs');

const store = {};
function resetStore(openIds) {
  const rows = SEED.figureRows();
  (openIds || []).forEach(id => {
    const r = rows.find(x => x.figure_id === id);
    if (r) r['公開'] = true;
  });
  store[C.SHEET.FIGURES]  = rows;
  store[C.SHEET.SETTINGS] = C.SETTINGS_DEFAULT.map(d => ({ 'キー': d[0], '値': d[1], '説明': d[2] }));
  store[C.SHEET.CONV]     = [];
  store[C.SHEET.MSG]      = [];
  store[C.SHEET.USERS]    = [];
  store[C.SHEET.SETTINGS].find(r => r['キー'] === 'モデル')['値'] = 'gemini-test';
}

global.Repo = {
  readAll: n => store[n] || [],
  where: (n, m) => (store[n] || []).filter(r => Object.keys(m).every(k => String(r[k]) === String(m[k]))),
  firstWhere: (n, m) => global.Repo.where(n, m)[0] || null,
  append: (n, o) => { store[n].push(o); return o; },
  appendMany: (n, os) => { os.forEach(o => store[n].push(o)); return os.length; },
  updateByKey: (n, k, v, p) => {
    const r = store[n].find(x => String(x[k]) === String(v));
    if (r) Object.assign(r, p);
    return !!r;
  },
  exists: n => !!store[n],
  now: () => new Date(),
  uuid: () => global.Utilities.getUuid()
};

resetStore();
load('Figures.gs');

/* Gemini のかわり。lastBody に送った中身が残る */
let lastBody = null;
function replyOk(obj) {
  return () => {
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }]
      })
    };
  };
}
global.UrlFetchApp = {
  fetch: (url, opt) => {
    lastBody = opt && opt.payload ? JSON.parse(opt.payload) : null;
    return replyOk({ say: 'ふむ。', cite: '', guess: '' })();
  }
};
load('Chat.gs');

function useReply(obj) {
  global.UrlFetchApp.fetch = (url, opt) => {
    lastBody = opt && opt.payload ? JSON.parse(opt.payload) : null;
    return replyOk(obj)();
  };
}
function useRaw(code, text) {
  global.UrlFetchApp.fetch = () => ({ getResponseCode: () => code, getContentText: () => text });
}

const TEACHER = { id: 'T1', name: '先生', role: C.ROLE.TEACHER };
const CHILD   = { id: 'S1', name: 'こども', role: C.ROLE.STUDENT };

/* ============================================================
   1. 初期人物セット
   ============================================================ */
section('初期人物セット');
resetStore();
{
  const rows = store[C.SHEET.FIGURES];
  check('12人いる', rows.length === 12, String(rows.length));

  const cols = Object.keys(rows[0]);
  const missing = C.COLS.FIGURES.filter(c => !cols.includes(c));
  const extra = cols.filter(c => !C.COLS.FIGURES.includes(c));
  check('列がスキーマと一致', !missing.length && !extra.length, JSON.stringify({ missing, extra }));

  const figs = Figures.all();
  const okCert = [C.CERT.SAME, C.CERT.DEN, C.CERT.LATE, C.CERT.NONE];
  check('確からしさが4値のどれか', figs.every(f => okCert.includes(f.portrait.cert)));
  check('事実メモが全員に入っている', figs.every(f => f.facts.trim() !== ''));
  check('事実メモに史料〔〕が付いている', figs.every(f => f.facts.includes('〔')));
  check('最初の一言が全員に入っている', figs.every(f => f.hello.trim() !== ''),
    figs.filter(f => !f.hello.trim()).map(f => f.name).join());
  check('肖像のひとことが入っている', figs.every(f => f.portrait.note.trim() !== ''));
  check('並び順が1〜12', figs.map(f => f.order).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12');
  check('既定では誰も公開されていない', figs.every(f => !f.open));
  check('肖像なしは卑弥呼だけ',
    figs.filter(f => f.portrait.cert === C.CERT.NONE).map(f => f.name).join() === '卑弥呼');
  check('伝＝論争中は3人（聖徳太子・源頼朝・雪舟）',
    figs.filter(f => f.portrait.cert === C.CERT.DEN).length === 3);
}

/* ============================================================
   2. 舞台裏を画面に渡さない
   ============================================================ */
section('舞台裏を画面に渡さない');
{
  const c = Figures.forClient(Figures.byId('F-09'));
  const leaked = ['facts', 'avoid', 'tone', 'sources', 'person'].filter(k => k in c);
  check('事実メモ・避ける話題・口調が漏れない', leaked.length === 0, leaked.join());
  check('画面に必要なものは揃っている',
    !!(c.name && c.era && c.portrait && c.voice && c.seeds && c.certLabel));
  check('最初の一言は画面に渡す（人物から先に話しかけるため）', !!c.hello, c.hello);
}

/* ============================================================
   3. プロンプト
   ============================================================ */
section('プロンプト');
{
  const sys = Chat.buildSystem(Figures.byId('F-09'));
  check('事実メモが入る', sys.includes('桶狭間'));
  check('一人称が入る', sys.includes('一人称は「わし」'));
  check('推測に断りを入れる指示がある', sys.includes('記録には残っておらぬが'));
  check('死後のことを知らないと言う指示がある', sys.includes('死んだあとのことは'));
  check('避ける話題が入る', sys.includes('本能寺での最期のむごい描写'));
  check('個人的なことに触れない指示がある', sys.includes('名前や住所'));

  const himiko = Chat.buildSystem(Figures.byId('F-01'));
  check('避ける話題が空なら 7. を出さない', !/^7\./m.test(himiko));
}

/* ============================================================
   4. 1往復
   ============================================================ */
section('1往復');
resetStore(['F-09']);
useReply({ say: '琵琶湖のほとりよ。道が通じておる。', cite: '信長公記', guess: '湖が見えたはずだ。書き残しはない。' });
{
  const r = Chat.send(TEACHER, 'F-09', 'どうして 安土城を つくったの？');
  check('出典が返る', r.cite === '信長公記', r.cite);
  check('推測が返る', r.guess !== '');
  check('残り回数が減る', r.remain === 29, String(r.remain));
  check('発言が2行残る', store[C.SHEET.MSG].length === 2);
  check('会話が1件できる', store[C.SHEET.CONV].length === 1);
  check('推測は本文と別の列', store[C.SHEET.MSG][1]['推測'] !== '' &&
    !store[C.SHEET.MSG][1]['本文'].includes('書き残しはない'));
  check('往復数が1', Number(store[C.SHEET.CONV][0]['往復数']) === 1);

  Chat.send(TEACHER, 'F-09', '天守からは 何が 見えたの？');
  check('会話は増えない', store[C.SHEET.CONV].length === 1);
  check('発言は4行', store[C.SHEET.MSG].length === 4);
  check('履歴が contents に積まれる', lastBody.contents.length === 3, String(lastBody.contents.length));
  check('role が user/model で交互',
    lastBody.contents.map(c => c.role).join(',') === 'user,model,user');
  check('構造化出力を要求している',
    lastBody.generationConfig.responseMimeType === 'application/json');
  check('schema が say/cite/guess',
    Object.keys(lastBody.generationConfig.responseSchema.properties).join(',') === 'say,cite,guess');
}

/* ============================================================
   5. ガードレール
   ============================================================ */
section('ガードレール');
resetStore(['F-09']);
useReply({ say: 'ふむ。', cite: '', guess: '' });
{
  expectErr('空文字ははじく', () => Chat.send(TEACHER, 'F-09', '   '), 'からっぽ');
  expectErr('文字数超過ははじく', () => Chat.send(TEACHER, 'F-09', 'あ'.repeat(121)), '文字までに');
  expectErr('居ない人物ははじく', () => Chat.send(TEACHER, 'F-99', 'やあ'), '見つかりません');
  expectErr('児童は未公開人物と話せない', () => Chat.send(CHILD, 'F-01', 'やあ'), 'いま話せません');
  check('教師は未公開人物を試せる', !!Chat.send(TEACHER, 'F-01', 'こんにちは').say);
}

// 上限はここまでの往復数に左右されないよう、数えてから決める
resetStore(['F-09']);
{
  Figures.setSetting('1日の往復上限', 2);
  const a = Chat.send(TEACHER, 'F-09', '1回目');
  check('1回目の残りは1', a.remain === 1, String(a.remain));
  const b = Chat.send(TEACHER, 'F-09', '2回目');
  check('2回目で残り0', b.remain === 0, String(b.remain));
  expectErr('上限に当たると断られる', () => Chat.send(TEACHER, 'F-09', '3回目'), 'かい 話しました');

  Figures.setSetting('1日の往復上限', 0);
  check('上限0は無制限', Chat.send(TEACHER, 'F-09', 'まだいける').remain === -1);
}

/* ============================================================
   6. 応答が崩れたとき
   ============================================================ */
section('応答が崩れたとき');
resetStore(['F-09']);
{
  global.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ただの平文' }] } }]
    })
  });
  const r = Chat.send(TEACHER, 'F-09', 'こんにちは');
  check('JSONでなくても say に入る', r.say === 'ただの平文' && r.cite === '', r.say);

  global.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })
  });
  expectErr('安全フィルタを検知', () => Chat.send(TEACHER, 'F-09', 'あぶない話'), 'BLOCKED');

  useRaw(429, 'quota');
  expectErr('クォータ超過を検知', () => Chat.send(TEACHER, 'F-09', 'やあ'), 'QUOTA');
  useRaw(404, 'not found');
  expectErr('モデル名の誤りを検知', () => Chat.send(TEACHER, 'F-09', 'やあ'), 'BAD_MODEL');
}

/* ============================================================
   6.5 やさしく言いかえる
   ============================================================ */
section('やさしく言いかえる');
resetStore(['F-09']);
{
  useReply({ say: '安土に城を築いた。', cite: '信長公記', guess: '眺めはよかったはずだ。' });
  const sent = Chat.send(TEACHER, 'F-09', '安土城のこと');
  check('返事の message_id が返る', !!sent.messageId);

  let asked = null;
  global.UrlFetchApp.fetch = (url, opt) => {
    asked = JSON.parse(opt.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{
          text: JSON.stringify({ say: '安土（あづち）に お城を たてた。', cite: '', guess: '' })
        }] } }]
      })
    };
  };
  const e1 = Chat.simplify(TEACHER, sent.messageId);
  check('やさしい文が返る', e1.text.indexOf('お城') >= 0, e1.text);
  check('推測もまとめて言いかえに渡す',
    asked.contents[0].parts[0].text.indexOf('眺めはよかった') >= 0);
  check('小学生向けの指示が入る',
    asked.systemInstruction.parts[0].text.indexOf('小学5・6年生') >= 0);
  check('新しいことを足さない指示が入る',
    asked.systemInstruction.parts[0].text.indexOf('新しいことを足さない') >= 0);

  const saved = store[C.SHEET.MSG].find(m => m.message_id === sent.messageId);
  check('言いかえを列に残す（どこでつまずいたかが先生に残る）',
    String(saved['言いかえ']).indexOf('お城') >= 0);

  // 2回目は Gemini を呼ばない
  let called = false;
  global.UrlFetchApp.fetch = () => { called = true; throw new Error('呼んではいけない'); };
  const e2 = Chat.simplify(TEACHER, sent.messageId);
  check('2回目は呼び直さず保存済みを返す', !called && e2.text === e1.text);

  // 言いかえられるのは人物の発言だけ
  const childMsg = store[C.SHEET.MSG].find(m => m['話者'] === C.SPEAKER.CHILD);
  expectErr('子どもの発言は言いかえられない',
    () => Chat.simplify(TEACHER, childMsg.message_id), '人物の返事だけ');
  expectErr('存在しないIDははじく',
    () => Chat.simplify(TEACHER, 'nope'), '見つかりません');

  // 他人の会話は言いかえられない（画面から任意の文章を投げさせない設計の要）
  expectErr('ほかの子の会話は言いかえられない',
    () => Chat.simplify(CHILD, sent.messageId), 'ほかの人の会話');
}

/* ============================================================
   6.6 質問のたね
   ============================================================ */
section('質問のたね');
{
  const figs = Figures.all();
  check('全員に6つある', figs.every(f => f.seeds.length === 6),
    figs.map(f => f.seeds.length).join(','));
  check('たねに重複がない',
    figs.every(f => new Set(f.seeds).size === f.seeds.length));
}

/* ============================================================
   7. 失敗したら往復を消費させない
   ============================================================ */
section('失敗したら往復を消費させない');
resetStore(['F-09']);
{
  // まず1往復成功させてから、次を失敗させる（成功分が消えないことも見る）
  useReply({ say: 'ふむ。', cite: '信長公記', guess: '' });
  Chat.send(TEACHER, 'F-09', '成功する往復');
  const before = store[C.SHEET.MSG].length;
  check('成功分は残っている', before === 2, String(before));

  useRaw(500, 'boom');
  try { Chat.send(TEACHER, 'F-09', 'これは保存されないはず'); } catch (e) {}
  check('失敗した往復は児童の発言も保存しない', store[C.SHEET.MSG].length === before,
    '前=' + before + ' 後=' + store[C.SHEET.MSG].length);
  check('失敗しても往復数は増えない',
    Number(store[C.SHEET.CONV][0]['往復数']) === 1, String(store[C.SHEET.CONV][0]['往復数']));
}

/* ============================================================
   まとめ
   ============================================================ */
console.log('\n' + (fail === 0
  ? `=== すべて通過（${pass}件）===`
  : `=== ${fail}件の問題 ／ ${pass}件通過 ===`));
process.exit(fail ? 1 : 0);

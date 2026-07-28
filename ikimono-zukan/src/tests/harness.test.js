/**
 * いきもの図鑑 サーバーロジックのテスト。
 * 実際の src/*.gs を、GASグローバルを模したサンドボックスに読み込んで実行する。
 *
 *   node ikimono-zukan/src/tests/harness.test.js
 *
 * ネットワークを使う GeminiApi / Images は読み込まず、
 * Gemini の戻り値を模したオブジェクトを流し込んで安全フィルタを検証する。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const GS_ORDER = ['Constants.gs', 'Kana.gs', 'Repo.gs', 'Safety.gs', 'Api.gs'];

/* =================== インメモリ・スプレッドシート =================== */
function makeSheet(name) {
  let data = [];
  const width = () => data.reduce((m, r) => Math.max(m, r.length), 0);
  const pad = (row, n) => { const r = row.slice(); while (r.length < n) r.push(''); return r; };
  function range(row, col, numRows, numCols) {
    numRows = numRows || 1; numCols = numCols || 1;
    const R = {
      getValues() {
        const out = [];
        for (let i = 0; i < numRows; i++) {
          const src = data[row - 1 + i] || [];
          const line = [];
          for (let j = 0; j < numCols; j++) line.push(src[col - 1 + j] !== undefined ? src[col - 1 + j] : '');
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        for (let i = 0; i < vals.length; i++) {
          const r = row - 1 + i;
          if (!data[r]) data[r] = [];
          for (let j = 0; j < vals[i].length; j++) data[r][col - 1 + j] = vals[i][j];
        }
        return R;
      },
      setValue(v) { const r = row - 1; if (!data[r]) data[r] = []; data[r][col - 1] = v; return R; },
      setFontWeight() { return R; }, setBackground() { return R; }
    };
    return R;
  }
  return {
    getName() { return name; },
    getRange(r, c, nr, nc) { return range(r, c, nr, nc); },
    getDataRange() { return range(1, 1, Math.max(data.length, 1), Math.max(width(), 1)); },
    getLastRow() { return data.length; },
    getLastColumn() { return width(); },
    appendRow(row) { data.push(pad(row, Math.max(width(), row.length))); },
    setFrozenRows() {},
    _dump() { return data; }
  };
}

function makeSpreadsheet() {
  const sheets = {};
  return {
    _sheets: sheets,
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; }
  };
}

/* =================== GASグローバルのモック =================== */
const ss = makeSpreadsheet();
let uuidSeq = 0;
const cacheStore = {};
const props = {};

const sandbox = {
  console,
  SpreadsheetApp: { getActive: () => ss },
  CacheService: {
    getScriptCache: () => ({
      get: k => (cacheStore[k] === undefined ? null : cacheStore[k]),
      put: (k, v) => { cacheStore[k] = v; },
      remove: k => { delete cacheStore[k]; }
    })
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = v; }
    })
  },
  Utilities: {
    getUuid: () => 'uuid-' + (++uuidSeq),
    formatDate: (d) => new Date(d).toISOString().slice(0, 10)
  },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
GS_ORDER.forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
});
const { C, Kana, Repo, Safety } = sandbox;

/* =================== アサーション =================== */
let pass = 0, fail = 0; const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (期待: ' + expected + ' / 実際: ' + actual + ')');
}

/* =================== 準備 =================== */
function setupSheets() {
  [['ZUKAN', C.SH.ZUKAN], ['ALIAS', C.SH.ALIAS], ['SAFETY', C.SH.SAFETY], ['LOG', C.SH.LOG]]
    .forEach(([k, name]) => {
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, C.COL[k].length).setValues([C.COL[k]]);
    });
  const safety = ss.getSheetByName(C.SH.SAFETY);
  Safety.SEED.forEach(row => safety.appendRow(row));
}
setupSheets();

/* =================== 1. 文字列の正規化 =================== */
console.log('\n【1】名寄せの土台（Kana）');
eq(Kana.normalize('ダンゴムシ'), 'だんごむし', 'カタカナ→ひらがな');
eq(Kana.normalize('だんごむし'), 'だんごむし', 'ひらがなはそのまま');
eq(Kana.normalize('ダンゴムシ'), 'だんごむし', '全角英数まじりもNFKCで吸収');
eq(Kana.normalize(' アメリカ ザリガニ '), 'あめりかざりがに', '空白を落とす');
eq(Kana.normalize('カブトムシ！'), 'かぶとむし', '記号を落とす');
ok(Kana.normalize('カブトムシ') === Kana.normalize('かぶとむし'), 'カタカナとひらがなが同じキーになる');

console.log('\n【2】ゆるいキー（小書き・濁点の打ちもらしを拾う）');
eq(Kana.loosen('ショウリョウバッタ'), 'しようりようはつた', '小書きと濁点を落とす');
ok(Kana.loosen('しようりようはつた') === Kana.loosen('ショウリョウバッタ'),
   '小書きを打てなかった入力でも同じキーに落ちる');
ok(Kana.loosen('ダンゴムシ') === Kana.loosen('たんこむし'), '濁点なしの入力を拾える');

console.log('\n【3】ふりがな記法とエスケープ');
eq(Kana.toRuby('｜樹液《じゅえき》'), '<ruby>樹液<rt>じゅえき</rt></ruby>', 'ruby に変換される');
eq(Kana.stripRuby('｜樹液《じゅえき》が出る'), '樹液が出る', 'ふりがなを外せる');
{
  // 順序が命。エスケープ→ruby変換 でなければ防御にならない
  const evil = '<script>alert(1)</script>｜樹液《じゅえき》';
  const out = Kana.toRuby(Kana.escapeHtml(evil));
  ok(out.indexOf('<script>') < 0, 'スクリプトタグが無害化される');
  ok(out.indexOf('<ruby>樹液<rt>じゅえき</rt></ruby>') >= 0, '無害化してもふりがなは生きている');
  const wrong = Kana.escapeHtml(Kana.toRuby(evil));
  ok(wrong.indexOf('<ruby>') < 0, '順序を逆にすると ruby が壊れる（この順序では実装しない）');
}

/* =================== 4. 安全フィルタ =================== */
console.log('\n【4】安全フィルタ：要注意リストが AI より強い');
function gemini(over) {
  return Object.assign({
    is_creature: true, canonical_name: 'テスト', reading: 'てすと', aliases: [],
    category: 'むし', summary: '', habitat: {}, catching: {}, food: {}, keeping: {},
    danger_level: 'safe', danger_notes: [], legal_status: 'none',
    release_warning: false, keeping_difficulty: 'normal', wikipedia_title: ''
  }, over || {});
}
{
  // AI が「安全」「規制なし」と言い張っても、リストが上書きする
  const s = Safety.apply(gemini({ canonical_name: 'オオスズメバチ' }), ['オオスズメバチ']);
  eq(s.danger_level, 'danger', 'AIがsafeでも、スズメバチはdangerに上書きされる');
  ok(s.hide_catching === true, 'dangerなので「つかまえかた」を出さない');
  ok(s.safety_messages.length > 0, '子供向けの警告文が付く');
  ok(s.overrides.some(o => o.indexOf('スズメバチ') >= 0) ||
     s.overrides.some(o => o.indexOf('すずめばち') >= 0), '何が効いたか記録される');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'キイロスズメバチ' }), ['キイロスズメバチ']);
  eq(s.danger_level, 'danger', '部分一致なのでキイロスズメバチにも当たる');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'ウシガエル', category: 'かえる・とかげ・へび' }),
                         ['ウシガエル']);
  eq(s.legal_status, 'invasive_banned', '特定外来生物と判定される');
  ok(s.hide_catching === true, '特定外来生物は生きた運搬も禁止なので、つかまえかたも出さない');
  ok(s.hide_keeping === true, 'かいかたも出さない');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'アメリカザリガニ', category: 'みずのいきもの' }),
                         ['アメリカザリガニ']);
  eq(s.legal_status, 'conditional_invasive', '条件付特定外来生物と判定される');
  ok(s.release_warning === true, '放出禁止の警告が立つ');
  ok(!s.hide_catching, 'つかまえかたは出してよい');
  ok(!s.hide_keeping, 'かいかたも出してよい');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'ミドリガメ', category: 'かえる・とかげ・へび' }),
                         ['ミドリガメ']);
  eq(s.legal_status, 'conditional_invasive', '通称（ミドリガメ）でもアカミミガメの規制に当たる');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'ヒキガエル', category: 'かえる・とかげ・へび' }),
                         ['ヒキガエル']);
  eq(s.danger_level, 'caution', 'ヒキガエルは caution（触れるが手を洗う）');
  ok(!s.hide_catching, 'caution では つかまえかたを消さない');
}

console.log('\n【5】安全フィルタ：カテゴリ規則（鳥獣保護管理法）');
{
  const s = Safety.apply(gemini({ canonical_name: 'スズメ', category: 'とり' }), ['スズメ']);
  eq(s.legal_status, 'permit_required', '野鳥は許可が要る');
  ok(s.hide_catching === true, '野鳥のつかまえかたは出さない');
  ok(s.hide_keeping === true, '野鳥のかいかたも出さない');
  ok(s.safety_messages.join('').indexOf('ヒナ') >= 0, 'ヒナの持ち帰りを止める文言が入る');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'タヌキ', category: 'けもの' }), ['タヌキ']);
  eq(s.legal_status, 'permit_required', '野生哺乳類も許可が要る');
  ok(s.hide_catching === true, 'けもののつかまえかたは出さない');
}
{
  const s = Safety.apply(gemini({ canonical_name: 'カブトムシ', category: 'むし' }), ['カブトムシ']);
  eq(s.danger_level, 'safe', '安全な生き物は素通りする');
  eq(s.legal_status, 'none', '規制なしのまま');
  ok(!s.hide_catching && !s.hide_keeping, '4項目すべて出す');
}
{
  const s = Safety.apply(gemini({ keeping_difficulty: 'not_recommended' }), ['テスト']);
  ok(s.hide_keeping === true, '飼育を勧められない生き物はかいかたを出さない');
}
{
  // 弱める方向の上書きはしない
  const s = Safety.apply(gemini({ canonical_name: 'ヒキガエル', danger_level: 'danger' }),
                         ['ヒキガエル']);
  eq(s.danger_level, 'danger', 'AIがdangerと言っているものをcautionに弱めない');
}

/* =================== 6. 名寄せとキャッシュ =================== */
console.log('\n【6】共有図鑑のキャッシュ（名寄せ）');
const id1 = Repo.saveCreature({
  '標準和名': 'オカダンゴムシ', 'よみ': 'おかだんごむし', 'カテゴリ': 'むし',
  '概要': 'まるまる むし', '危険度': 'safe', '法規制': 'none'
}, ['ダンゴムシ', 'だんごむし', '団子虫', 'まるむし']);
ok(!!id1, '図鑑に登録できる');
eq(Repo.findIdByName('ダンゴムシ'), id1, 'カタカナで引ける');
eq(Repo.findIdByName('だんごむし'), id1, 'ひらがなで引ける');
eq(Repo.findIdByName('団子虫'), id1, '漢字で引ける');
eq(Repo.findIdByName('まるむし'), id1, '俗称で引ける');
eq(Repo.findIdByName('オカダンゴムシ'), id1, '標準和名で引ける');
eq(Repo.findIdByName('たんこむし'), id1, '濁点を打ちもらしても、ゆるいキーで拾える');
eq(Repo.findIdByName('カブトムシ'), null, '登録していないものは null');

const id2 = Repo.saveCreature({
  '標準和名': 'カブトムシ', 'よみ': 'かぶとむし', 'カテゴリ': 'むし', '危険度': 'safe', '法規制': 'none'
}, ['かぶとむし']);
eq(sandbox.plateNo_(1), 'No.001', '図鑑番号は No.001 の形');
{
  const row = Repo.getCreature(id2);
  eq(String(row['番号']), '2', '2件目は番号2');
  eq(String(row['閲覧回数']), '1', '登録時の閲覧回数は1');
  Repo.bumpViews(id2);
  eq(String(Repo.getCreature(id2)['閲覧回数']), '2', '閲覧するたびに増える');
}
eq(Repo.listCreatures().length, 2, '一覧は2件');

console.log('\n【7】hidden にすると画面から消える（保護者によるモデレーション）');
Repo.updateById(C.SH.ZUKAN, id2, { status: C.STATUS.HIDDEN });
eq(Repo.getCreature(id2), null, 'hidden の生き物は取得できない');
eq(Repo.listCreatures().length, 1, '一覧からも消える');
Repo.updateById(C.SH.ZUKAN, id2, { status: C.STATUS.PUBLISHED });

/* =================== 8. 画面に渡す形 =================== */
console.log('\n【8】画面に渡すオブジェクト（viewFromRow_）');
{
  const id3 = Repo.saveCreature({
    '標準和名': 'ウシガエル', 'よみ': 'うしがえる', 'カテゴリ': 'かえる・とかげ・へび',
    '概要': '｜牛《うし》の ような｜声《こえ》',
    '生息地_json': JSON.stringify({ places: ['池'], season: '5がつ', text: '｜夜《よる》に｜活動《かつどう》' }),
    '捕まえ方_json': '{}', '餌_json': '{}', '飼い方_json': '{}',
    '危険度': 'safe', '危険メモ_json': JSON.stringify({ notes: [], messages: ['ほうりつで かえません'] }),
    '法規制': 'invasive_banned', '放出禁止': true, '飼育難易度': 'not_recommended'
  }, ['うしがえる']);
  const v = sandbox.viewFromRow_(Repo.getCreature(id3));
  ok(v.found === true, '見つかった状態で返る');
  eq(v.catching, null, '特定外来生物は catching が null（画面に出さない）');
  eq(v.keeping, null, '特定外来生物は keeping が null');
  ok(v.hideCatching && v.hideKeeping, 'なぜ消したかもフラグで渡す');
  ok(v.summary.indexOf('<ruby>牛<rt>うし</rt></ruby>') >= 0, '概要のふりがながHTMLになっている');
  ok(v.habitat.text.indexOf('<ruby>') >= 0, '項目の中のふりがなも変換される');
  eq(v.habitat.places[0], '池', '配列の要素も通る');
  ok(v.release === true, '放出禁止が立っている');
}
{
  const id4 = Repo.saveCreature({
    '標準和名': 'スズメ', 'よみ': 'すずめ', 'カテゴリ': 'とり',
    '危険度': 'safe', '法規制': 'permit_required', '飼育難易度': 'not_recommended',
    '危険メモ_json': '{}'
  }, ['すずめ']);
  const v = sandbox.viewFromRow_(Repo.getCreature(id4));
  eq(v.catching, null, '野鳥は catching を出さない');
  eq(v.keeping, null, '野鳥は keeping を出さない');
}

/* =================== 9. 要注意リストの読み込み =================== */
console.log('\n【9】要注意リストがシートから読めている');
ok(Safety.rules().length >= 30, '初期データが30件以上ある（実際: ' + Safety.rules().length + '件）');
ok(Safety.rules().every(r => r.pattern), 'すべての行に名前パターンがある');
ok(Safety.isTrue('TRUE') && Safety.isTrue(true) && !Safety.isTrue('FALSE'),
   'シートの真偽値（TRUE/true/はい）を解釈できる');
{
  const banned = Safety.rules().filter(r => r.legal === 'invasive_banned');
  ok(banned.length >= 10, '特定外来生物が10件以上登録されている（実際: ' + banned.length + '件）');
  const cond = Safety.rules().filter(r => r.legal === 'conditional_invasive');
  eq(cond.length, 3, '条件付特定外来生物はアメリカザリガニ・アカミミガメ・ミドリガメの3件');
}

/* =================== 結果 =================== */
console.log('\n========================================');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
if (fail) { console.log('  失敗: ' + fails.join(' / ')); process.exit(1); }
console.log('  すべてのテストに合格しました 🎉');

/**
 * a11y.test.js
 * 見た目まわりのアクセシビリティを、実ファイルを読んで機械的に確かめる。
 *
 *   node history-chat/tests/a11y.test.js
 *
 * ブラウザは使わないので、実際の描画や読み上げソフトの挙動までは見られない。
 * ここで見るのは「作りの中に、あとから直しにくい欠陥が残っていないか」。
 * 実機での確認（読み上げ・マイク・明朝体の有無）は docs/VOICE.md §4 を見ること。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

let pass = 0, fail = 0, warn = 0;
const ok   = (l, x) => { pass++; console.log('  OK   ' + l + (x ? ' :: ' + x : '')); };
const ng   = (l, x) => { fail++; console.log('  NG   ' + l + (x ? ' :: ' + x : '')); };
const note = (l, x) => { warn++; console.log('  △    ' + l + (x ? ' :: ' + x : '')); };
const check = (l, c, x) => (c ? ok(l, x) : ng(l, x));
const section = t => console.log('\n■ ' + t);

/* ============================================================
   色のものさし（WCAG 2.1 相対輝度）
   ============================================================ */
function lum(hex) {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

const css = read('css.html');

/** :root で定義したトークンを取り出す */
const TOKEN = {};
(css.match(/--[\w-]+:\s*#[0-9A-Fa-f]{6}/g) || []).forEach(d => {
  const [k, v] = d.split(/:\s*/);
  if (!TOKEN[k]) TOKEN[k] = v;
});

/* ============================================================
   1. 文字と背景のコントラスト
   ============================================================ */
section('文字と背景のコントラスト（本文4.5:1 / 大きな文字3:1）');
{
  const T = TOKEN;
  const pairs = [
    ['人物の返事',        T['--sumi'],  T['--paper-hi'], 15.5, 4.5],
    ['読み上げ中の文',    T['--sumi'],  '#EFE7CF',       15.5, 4.5],
    ['自分の発言',        T['--paper'], T['--ai'],       15,   4.5],
    ['やさしく言いかえ',  T['--sumi'],  T['--ground'],   15.5, 4.5],
    ['出典',              T['--ai'],    T['--ai-soft'],  13,   4.5],
    ['記録にはない話',    T['--shu'],   T['--paper-hi'], 13,   4.5],
    ['確からしさ 論争中', T['--shu'],   T['--shu-soft'], 12,   4.5],
    ['確からしさ 想像',   T['--muted'], T['--ground'],   12,   4.5],
    ['一言紹介',          T['--muted'], T['--paper-hi'], 13,   4.5],
    ['残り回数',          T['--muted'], T['--paper'],    13,   4.5],
    ['見られています',    T['--ai'],    T['--ai-soft'],  13,   4.5],
    ['肖像のひとこと',    T['--shu'],   T['--ground'],   13,   4.5],
    ['質問のたね',        T['--ai'],    T['--paper-hi'], 14,   4.5],
    ['エラー',            T['--shu'],   T['--shu-soft'], 14,   4.5],
    ['送るボタン',        T['--paper'], T['--ai'],       14,   4.5],
    ['マイク押下中',      T['--paper'], T['--shu'],      22,   3.0]
  ];
  pairs.forEach(([label, fg, bg, px, need]) => {
    const v = ratio(fg, bg);
    check(`${label}（${px}px）`, v >= need, `${v}:1（要${need}）`);
  });
}

/* ============================================================
   2. フォーカスリングは、どの下地でも見えるか
   ============================================================ */
section('フォーカスリング（周囲と3:1 以上）');
{
  const T = TOKEN;
  const surfaces = [
    ['紙',        T['--paper'],    T['--shu']],
    ['白紙',      T['--paper-hi'], T['--shu']],
    ['生成り',    T['--ground'],   T['--shu']],
    ['藍の淡色',  T['--ai-soft'],  T['--shu']],
    ['朱の淡色',  T['--shu-soft'], T['--shu']],
    // 帯・ボタンの上は色を切りかえている（.bar button:focus-visible ほか）
    ['藍の帯',    T['--ai'],       T['--paper']],
    ['朱のマイク', T['--shu'],     T['--paper']]
  ];
  surfaces.forEach(([label, bg, ring]) => {
    const v = ratio(ring, bg);
    check(`${label}の上`, v >= 3, `${v}:1`);
  });
  check('帯の上でリング色を切りかえている',
    /\.bar button:focus-visible[\s\S]{0,220}outline-color:\s*var\(--paper\)/.test(css));
  check('フォーカスを消していない', !/outline:\s*(none|0)/.test(css));
}

/* ============================================================
   3. 文字の大きさとタップ領域（児童画面）
   ============================================================ */
section('児童画面の文字の大きさとタップ領域');
{
  // コメントを外してから読む。外さないと、直前のコメントがセレクタに混ざる
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...clean.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(m => ({
    sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2]
  }));
  const teacherOnly = /^(\.t-|\.card|\.health|\.sw|\.btn|\.row|select|input\[)/;
  const small = blocks.filter(b =>
    !b.sel.startsWith('@') && !teacherOnly.test(b.sel) &&
    /font-size:\s*([\d.]+)px/.test(b.body) &&
    parseFloat(b.body.match(/font-size:\s*([\d.]+)px/)[1]) < 12
  );
  check('12px未満の文字がない', small.length === 0,
    small.map(b => b.sel).join('、'));

  const taps = ['.seed', '.hear', '.snd', '.bar-back', '.about-t', '.mic', '.send'];
  taps.forEach(sel => {
    // セレクタは並記されることがある（.a,.b{...}）ので、その一つとして探す
    const b = blocks.find(x => x.sel.split(',').map(s => s.trim()).includes(sel));
    if (!b) { note(`${sel} が見つからない`); return; }
    const has44 = /min-height:\s*44px|height:\s*(4[4-9]|[5-9]\d)px/.test(b.body);
    check(`${sel} が44px以上`, has44);
  });
}

/* ============================================================
   4. 構造・ラベル・動的な変化
   ============================================================ */
section('児童画面の構造とラベル');
{
  const h = read('child.html');
  check('lang を持つ', /<html lang="ja">/.test(h));
  check('main がある', /<main/.test(h));
  check('会話が読み上げソフトに届く（role=log かつ aria-live）',
    /id="talk"[^>]*role="log"/.test(h) && /id="talk"[^>]*aria-live/.test(h));
  check('残り回数の変化を知らせる', /id="remain-l"[^>]*role="status"/.test(h));
  check('待ち（筆をとっています）を知らせる', /wait\.setAttribute\('role', 'status'\)/.test(h));
  check('マイクの状態を知らせる', /id="mic-state"[^>]*role="status"/.test(h));
  check('入力欄にラベルがある', /<textarea[^>]*aria-label=/.test(h));
  check('マイクボタンにラベルがある', /id="mic"[\s\S]{0,140}aria-label=/.test(h));
  check('「この絵について」が開く先を示す', /id="about-t"[^>]*aria-controls="about-b"/.test(h));
  check('飾りの肖像を読み上げから外す', /id="bar-face"[^>]*aria-hidden="true"/.test(h));
  check('肖像なしの影絵に代わりの文がある', /role="img"[\s\S]{0,80}aria-label=/.test(h));

  section('注意書き（ダイアログ）');
  check('role=dialog / aria-modal', /role="dialog"[^>]*aria-modal="true"/.test(h));
  check('見出しと本文に結びつけている',
    /aria-labelledby="notice-h"/.test(h) && /aria-describedby="notice-p"/.test(h));
  check('開いたらフォーカスを中へ移す', /\$\('notice-ok'\)\.focus\(\)/.test(h));
  check('Escape で閉じる', /e\.key === 'Escape'/.test(h));
  check('Tab が外へ出ない', /e\.key === 'Tab'/.test(h));
  check('閉じたら元の場所へ戻す', /noticeReturn\.focus\(\)/.test(h));

  section('画面の切りかえでフォーカスを置き去りにしない');
  check('人物を開いたら見出しへ移す', /\$\('bar-nm'\)\.focus\(\)/.test(h));
  check('もどったらカードへ戻す', /\.fig\[data-id=/.test(h));
  check('カードに戻り先の目印がある', /setAttribute\('data-id', f\.id\)/.test(h));
}

/* ============================================================
   5. 色だけに頼っていないか
   ============================================================ */
section('色だけで意味を伝えていないか');
{
  const cons = read('Constants.gs');
  ['same', 'den', 'late', 'none'].forEach(k => {
    check(`確からしさ ${k} に文字のラベルがある`,
      new RegExp(k + ':\\s*\'[^\']+\'').test(cons.split('CERT_LABEL')[1] || ''));
  });
  const h = read('child.html');
  check('推測の枠に「記録にはない話」の文字がある', /記録にはない話/.test(h));
  check('言いかえの枠に文字のラベルがある', /やさしく 言いかえると/.test(h));
}

/* ============================================================
   6. OS 側の設定を尊重しているか
   ============================================================ */
section('OS の設定');
{
  check('動きを減らす設定に従う', /prefers-reduced-motion/.test(css));
  check('強制ハイコントラストに対応', /@media \(forced-colors: active\)/.test(css));
  check('　読み上げ中の強調が色以外でも分かる',
    /forced-colors: active\)\{[\s\S]{0,200}text-decoration:\s*underline/.test(css));
  check('　推測の枠が消えない',
    /forced-colors: active\)[\s\S]{0,400}\.guess\{border-left:[^}]*CanvasText/.test(css));
  check('コントラストを上げる設定に従う', /prefers-contrast: more/.test(css));
}

/* ============================================================
   まとめ
   ============================================================ */
console.log('\n' + (fail === 0
  ? `=== すべて通過（${pass}件${warn ? ' ／ 注意' + warn + '件' : ''}）===`
  : `=== ${fail}件の問題 ／ ${pass}件通過 ===`));
console.log('※ 実機でしか分からないこと（読み上げが iframe で鳴るか、マイクの許可が下りるか、');
console.log('　 端末に明朝体が入っているか）は、先生の画面の「点検」で確かめること。');
process.exit(fail ? 1 : 0);

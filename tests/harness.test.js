/**
 * GASサーバーロジックの結合テスト用ハーネス。
 * 実際の src/*.gs を、GASグローバルを模したサンドボックスに読み込んで実行する。
 *
 * 単元内自由進度学習のモデル（公開単位＝単元、進度は課題ごと）を検証する。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const GS_ORDER = ['Constants.gs', 'Repo.gs', 'Auth.gs', 'Code.gs', 'Setup.gs', 'StudentApi.gs', 'TeacherApi.gs'];

/* ---------- インメモリ・スプレッドシート ---------- */
function makeSheet(name) {
  let data = [];
  const width = () => data.reduce((m, r) => Math.max(m, r.length), 0);
  function pad(row, n) { const r = row.slice(); while (r.length < n) r.push(''); return r; }
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
      setFontWeight() { return R; }, setBackground() { return R; },
      setNumberFormat() { return R; }, setFontColor() { return R; }
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
    deleteRow(r) { data.splice(r - 1, 1); },
    deleteRows(start, count) { data.splice(start - 1, count); },
    setFrozenRows() {}, autoResizeColumns() {},
    _dump() { return data; }
  };
}

function makeSpreadsheet() {
  const sheets = {};
  const ui = {
    alert: () => ui.Button.OK,
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', YES: 'YES', NO: 'NO' },
    createMenu() { const m = { addItem() { return m; }, addSeparator() { return m; }, addToUi() {} }; return m; }
  };
  const ss = {
    getSheetByName(n) { return sheets[n]; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
    deleteSheet(s) { delete sheets[s.getName()]; },
    getUi() { return ui; },
    toast() {},
    _sheets: sheets
  };
  return { ss, ui };
}

/* ---------- GASサービスのモック ---------- */
let CURRENT_EMAIL = '';
let uuidCounter = 0;
const { ss, ui } = makeSpreadsheet();

function pad2(n) { return n < 10 ? '0' + n : String(n); }

const sandbox = {
  console,
  SpreadsheetApp: { getActive() { return ss; }, getUi() { return ui; }, getActiveSpreadsheet() { return ss; } },
  LockService: { getScriptLock() { return { waitLock() { return true; }, releaseLock() {} }; } },
  Session: {
    getActiveUser() { return { getEmail() { return CURRENT_EMAIL; } }; },
    getEffectiveUser() { return { getEmail() { return CURRENT_EMAIL; } }; }
  },
  Utilities: {
    getUuid() { return 'uuid-' + (++uuidCounter); },
    // 'yyyy-MM-dd' だけ対応すれば足りる
    formatDate(d, tz, fmt) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  },
  PropertiesService: { getScriptProperties() { return { getProperty() { return null; } }; } },
  CacheService: { getScriptCache() { return { get() { return null; }, put() {} }; } },
  HtmlService: {
    createTemplateFromFile() { return { evaluate() { return { setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }; } }; },
    createHtmlOutputFromFile() { return { getContent() { return ''; } }; },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
  }
};
vm.createContext(sandbox);

let code = '';
for (const f of GS_ORDER) code += fs.readFileSync(path.join(SRC, f), 'utf8') + '\n';
vm.runInContext(code, sandbox, { filename: 'all.gs' });

/* ---------- テストユーティリティ ---------- */
let pass = 0, fail = 0; const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}
function call(fnName, ...args) {
  sandbox.__args = args;
  return vm.runInContext(fnName + '.apply(null, __args)', sandbox);
}
function asUser(email) { CURRENT_EMAIL = email; }
function sheetRows(name) { return vm.runInContext('Repo.readAll(' + JSON.stringify(name) + ')', sandbox); }
function backdate(min) { return vm.runInContext('new Date(Date.now()-' + min + '*60000)', sandbox); }

/* =================== テスト本体 =================== */
console.log('\n【1】初期セットアップ');
call('setupSheets');
const names = Object.keys(ss._sheets);
ok(names.length === 17, 'シートが17枚生成された（実際: ' + names.length + '）');
ok(sheetRows('方略マスタ').length === 6, '方略マスタに6枚のサンプル');
ok(sheetRows('単元').length === 1, 'デモ単元が1件');
const allTasks = sheetRows('課題');
ok(allTasks.length === 9, '課題が9件（必須4・選択3・発展2）');
ok(allTasks.filter(t => t['種別'] === '必須').length === 4, '必須ミッションが4件');
ok(allTasks.filter(t => t['種別'] === '発展').length === 2, '発展問題が2件');
ok(sheetRows('資料').filter(r => !r['task_id']).length === 2, 'いつでも使える資料が2件');
ok(sheetRows('資料').filter(r => r['task_id']).length === 6, '課題に紐づく資料が6件');

console.log('\n【2】名簿を登録（教師1・児童4）');
[
  ['T01', '山田先生', '山田先生', '0', 'teacher', 'teacher@school.jp'],
  ['U01', '青木', '青木', '1', 'student', 'a@school.jp'],
  ['U02', '石田', '石田', '2', 'student', 'b@school.jp'],
  ['U03', '上野', '上野', '3', 'student', 'c@school.jp'],
  ['U04', '遠藤', '遠藤', '4', 'student', 'd@school.jp']
].forEach(r => ss._sheets['名簿'].appendRow(r));
ok(sheetRows('名簿').length === 5, '名簿5名を登録');

console.log('\n【3】ロール判定');
asUser('teacher@school.jp'); ok(call('getContext').role === 'teacher', '教師メール→ teacher');
asUser('a@school.jp'); ok(call('getContext').role === 'student', '児童メール→ student');
asUser('unknown@school.jp'); ok(call('getContext').user === null, '名簿外→ user=null');

console.log('\n【4】単元を公開（本時ではなく単元が公開単位）');
asUser('teacher@school.jp');
const design = call('teacher_getDesign', null);
const unitId = design.unit.unitId;
ok(design.unit.state === '準備中', '初期状態は準備中');
call('teacher_setUnitState', unitId, '公開中');
ok(call('currentUnit_')['状態'] === '公開中', '公開中の単元を currentUnit_ が拾える');

console.log('\n【5】児童に課題プールが届く');
asUser('a@school.jp');
let st = call('student_getState');
ok(st.hasUnit === true, '公開中の単元が見える');
ok(st.unit.outcome.indexOf('新聞') >= 0, '単元の出口（成果物イメージ）が届く');
ok(st.tasks.length === 8, '公開済みの課題8件だけが見える（⑨は非公開）');
ok(st.mustProgress.total === 4, '必須は4件');
ok(st.commonResources.length === 2, 'いつでも使える資料が2件');
const t1 = st.tasks[0], t4 = st.tasks[3];
ok(t1.resources.length === 1 && t1.resources[0].kind === '動画', '課題①に動画資料が紐づく');
ok(t4.strategies.length === 2, '課題④に推奨方略が2件紐づく');
ok(st.commonStrategies.length === 1, '単元共通の方略が1件');

console.log('\n【6】自分のペース・自分の順序で進める');
// ③ → ① の順に取り組む（教師の刻んだ順に縛られない）
const t3 = st.tasks[2];
call('student_setProgress', t3.taskId, 2);        // ③ 完了
call('student_setProgress', t1.taskId, 1);        // ① 取組中
call('student_saveSelection', t3.taskId, '学習形態', 'ひとりで');
call('student_saveSelection', t1.taskId, '学習形態', 'ペアで');   // 課題ごとに違う形態
call('student_useStrategy', t1.taskId, 'S01', true);
st = call('student_getState');
ok(st.tasks[2].status === 2 && st.tasks[0].status === 1, '課題ごとに違う進度を保持（③完了・①取組中）');
ok(st.tasks[2].selections['学習形態'] === 'ひとりで', '③はひとりで');
ok(st.tasks[0].selections['学習形態'] === 'ペアで', '①はペアで（課題ごとに取り組み方が変えられる）');
ok(st.tasks[0].strategyUse['S01'] === true, '課題ごとの「つかった！」を保持');
ok(st.mustProgress.done === 1, '必須の達成は1件');

console.log('\n【7】選択の変更履歴（調整の記録）');
call('student_saveSelection', t1.taskId, '学習形態', 'グループで');
const sels = sheetRows('選択').filter(r => r['user_id'] === 'U01' && r['task_id'] === t1.taskId && r['カテゴリ'] === '学習形態');
ok(sels.length === 2, '同じ課題の学習形態が2件（履歴が残る）');
ok(sels.find(r => r['選んだ値'] === 'グループで')['変更前の値'] === 'ペアで', '変更前の値が記録される');

console.log('\n【8】同じ時間に、子どもによって違う課題にいる');
asUser('b@school.jp');
const stB = call('student_getState');
call('student_setProgress', stB.tasks[4].taskId, 1);   // Bは選択課題⑤に取り組み中
call('student_saveSelection', stB.tasks[4].taskId, '学習形態', 'ひとりで');
asUser('c@school.jp');
const stC = call('student_getState');
[0, 1, 2, 3].forEach(i => call('student_setProgress', stC.tasks[i].taskId, 2));  // Cは必須を全部完了
call('student_setProgress', stC.tasks[7].taskId, 1);   // 発展⑧へ
call('student_saveSelection', stC.tasks[7].taskId, '学習形態', 'グループで');
// D は未着手のまま

console.log('\n【9】教師モニタ：誰がどの課題にいるか');
asUser('teacher@school.jp');
const mon = call('teacher_getMonitor');
ok(mon.hasUnit === true, 'モニタに単元あり');
ok(mon.tiles.length === 4, 'タイルは児童4名');
const byNo = {}; mon.tiles.forEach(t => byNo[t.number] = t);
ok(byNo['1'].doingTitle.indexOf('しくみを図に') >= 0, 'Aがいま取り組んでいる課題名が出る');
ok(byNo['2'].doingTitle.indexOf('武家諸法度') >= 0, 'Bは選択課題に取り組み中');
ok(byNo['3'].status === 'done' && byNo['3'].doneMust === 4, 'Cは必須を全部終えて done');
ok(byNo['4'].status === 'none', 'Dは未着手');
ok(mon.taskDistribution.length === 9, '課題分布は9件（非公開も教師には見える）');
const distT1 = mon.taskDistribution.find(d => d.title.indexOf('しくみを図に') >= 0);
ok(distT1.doing === 1 && distT1.done === 1, '課題①に 取組中1・完了1');
ok(mon.regulation.I === 1 && mon.regulation.We === 2, 'I/You/We の集計（Aはグループに変更済）');

console.log('\n【10】段階的公開（環境は変えないと風景になる）');
const hidden = mon.taskDistribution.find(d => !d.published);
ok(!!hidden, '非公開の課題が1件ある（説明動画）');
call('teacher_setTaskPublish', hidden.taskId, true);
asUser('a@school.jp');
ok(call('student_getState').tasks.length === 9, '教師が公開すると児童に9件目が現れる');

console.log('\n【11】実行中の他者参照');
const peers = call('student_getPeers');
ok(peers.enabled === true, '他者参照が有効');
ok(peers.cards.length === 4, 'クラス4名分');
const meCard = peers.cards.find(c => c.isMe);
ok(meCard && meCard.name === 'あなた', '自分は「あなた」と表示');
const cCard = peers.cards.find(c => c.number === '3');
ok(cCard.doneMust === 4 && cCard.stage === 'できた', 'Cの必須達成が見える');
ok(peers.cards.find(c => c.number === '2').doingTitle.indexOf('武家諸法度') >= 0, '他児がいま取り組む課題が見える');
ok(peers.cards[0].helpOn === undefined, 'こまった状態は他児に渡さない');

console.log('\n【12】きょうの計画と振り返り（日ごと）');
call('student_saveGoal', '集中して', '必須①と②を終える', ['S01', 'S03'], 70);
call('student_saveCheckpoint', 15, '調整する', '思ったより時間がかかる');
call('student_saveReflection', {
  achievement: 80, planGap: '遅れた', planGapReason: '資料を読むのに時間がかかった',
  selfEval: '参勤交代のしくみは説明できた', attrGood: ['やり方（工夫）がよかった'],
  attrHard: ['時間が足りなかった'], materialRequest: '年表がもう少し大きいと読みやすい',
  mood: '💪', nextPlan: '次は先に時間配分を決める'
});
const stR = call('student_getState');
ok(stR.my.goal.efficacy === 70, '自己効力感が保存される');
ok(stR.my.checkpoints.length === 1, '確認タイムが記録される');
ok(stR.my.reflection.planGap === '遅れた', '計画とのズレが保存される');
ok(stR.my.reflection.materialRequest.indexOf('年表') >= 0, '教材リクエストが保存される');
const pf = call('student_getPortfolio');
ok(pf.items.length === 1 && pf.items[0].achievement === 80, 'ポートフォリオに当日の振り返り');

console.log('\n【13】教師：ふりかえり一覧とフィードバック');
asUser('teacher@school.jp');
const refl = call('teacher_getReflections', null);
ok(refl.rows.length === 4, '一覧は4名分');
const rA = refl.rows.find(r => r.userId === 'U01');
ok(rA.hasRefl && rA.planGap === '遅れた', 'Aは記入済み・計画とのズレが見える');
ok(rA.materialRequest.indexOf('年表') >= 0, '教材リクエストが教師に届く');
ok(refl.rows.find(r => r.userId === 'U04').hasRefl === false, 'D（未記入）を把握できる');
call('teacher_toggleShare', 'U01', refl.day, true);
ok(call('teacher_getReflections', null).rows.find(r => r.userId === 'U01').shared === true, '共有トグルが反映');
call('teacher_sendFeedback', 'U01', '③から始めた判断がよかったね');
asUser('a@school.jp');
ok(call('student_getPortfolio').feedback.length === 1, '先生のコメントが児童に届く');

console.log('\n【14】無操作の検知');
const progSheet = ss._sheets['進度'];
const pv = progSheet.getDataRange().getValues(); const ph = pv[0];
const puid = ph.indexOf('user_id'), pup = ph.indexOf('更新時刻');
for (let i = 1; i < pv.length; i++) if (pv[i][puid] === 'U02') progSheet.getRange(i + 1, pup + 1).setValue(backdate(25));
const selSheet = ss._sheets['選択'];
const sv = selSheet.getDataRange().getValues(); const sh = sv[0];
const suid = sh.indexOf('user_id'), sat = sh.indexOf('選択時刻');
for (let i = 1; i < sv.length; i++) if (sv[i][suid] === 'U02') selSheet.getRange(i + 1, sat + 1).setValue(backdate(25));
asUser('teacher@school.jp');
const monIdle = call('teacher_getMonitor').tiles.find(t => t.number === '2');
ok(monIdle.status === 'idle' && monIdle.idleMin >= 10, 'B（25分無操作）→ idle');

console.log('\n【15】単元の設定（教師）');
call('teacher_setChoice', unitId, '場所', true);
asUser('a@school.jp');
ok(call('student_getState').choices.length === 3, '場所を開放すると選択カテゴリが3つに');
asUser('teacher@school.jp');
call('teacher_setPeerRef', unitId, false, false);
asUser('a@school.jp');
ok(call('student_getPeers').enabled === false, '教師が無効化すると他者参照が閉じる');

console.log('\n【16】見取りの作り替え：環境の診断');
asUser('teacher@school.jp');
const mon2 = call('teacher_getMonitor');
ok(!!mon2.diagnosis, '環境の診断が返る');
ok(typeof mon2.diagnosis.message === 'string' && mon2.diagnosis.message.length > 0, '診断メッセージがある');
ok(['ok', 'watch', 'review'].indexOf(mon2.diagnosis.level) >= 0, 'レベルは ok/watch/review');
ok(mon2.diagnosis.idleCount >= 1, '手が止まっている人数を数える（Bが該当）');
ok(mon2.diagnosis.adjustCount === 1, '確認タイムで「調整する」を選んだ人数を数える');
// 立ち止まりが3割を超えると、個人ではなく環境の見直しを促す
asUser('b@school.jp'); call('student_raiseHelp', true);
asUser('d@school.jp'); call('student_raiseHelp', true);
asUser('teacher@school.jp');
const diagR = call('teacher_getMonitor').diagnosis;
ok(diagR.level === 'review', '立ち止まりが多いと review レベルになる');
ok(diagR.message.indexOf('手引き') >= 0 || diagR.message.indexOf('環境') >= 0,
  'メッセージが子どもではなく環境の見直しを促す');

console.log('\n【17】見取りメモ（事実と解釈を分ける）');
call('teacher_saveObservation', 'U01', '白地図を3分見て手が止まった', '色分けの基準を決められないのかも');
const det = call('teacher_getStudentDetail', 'U01');
ok(det.observations.length === 1, '見取りメモが1件記録される');
ok(det.observations[0].fact.indexOf('白地図') >= 0, '事実が保存される');
ok(det.observations[0].interpretation.indexOf('基準') >= 0, '解釈（仮説）が保存される');
let obsErr = '';
try { call('teacher_saveObservation', 'U01', '', ''); } catch (e) { obsErr = String(e.message || e); }
ok(obsErr.length > 0, '事実も解釈も空なら保存を拒否する');

/* =================== 結果 =================== */
console.log('\n========================================');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
if (fail) { console.log('  失敗: ' + fails.join(' / ')); process.exit(1); }
else console.log('  すべての結合テストに合格しました 🎉');

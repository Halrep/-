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
const GS_ORDER = ['Constants.gs', 'Repo.gs', 'Auth.gs', 'Code.gs', 'Setup.gs', 'UnitSheet.gs', 'StudentApi.gs', 'TeacherApi.gs'];

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
      setNumberFormat() { return R; }, setFontColor() { return R; },
      setDataValidation() { return R; }
    };
    return R;
  }
  return {
    getName() { return name; },
    getSheetId() { return Math.abs(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)); },
    getRange(r, c, nr, nc) { return range(r, c, nr, nc); },
    getDataRange() { if (global.__count) global.__reads[name] = (global.__reads[name] || 0) + 1;
      return range(1, 1, Math.max(data.length, 1), Math.max(width(), 1)); },
    getLastRow() { return data.length; },
    getLastColumn() { return width(); },
    appendRow(row) { data.push(pad(row, Math.max(width(), row.length))); },
    deleteRow(r) { data.splice(r - 1, 1); },
    deleteRows(start, count) { data.splice(start - 1, count); },
    setFrozenRows() {}, autoResizeColumns() {}, setColumnWidth() {},
    clear() { data = []; },
    _dump() { return data; }
  };
}

function makeSpreadsheet() {
  const sheets = {};
  let active = null;
  const ui = {
    alert: (...a) => { ui.lastAlert = a[a.length - 2]; return ui.Button.OK; },
    prompt: () => ({
      getSelectedButton: () => (ui.promptCancel ? ui.Button.CANCEL : ui.Button.OK),
      getResponseText: () => ui.promptText || ''
    }),
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
    ButtonSetOkCancel: 'OK_CANCEL',
    createMenu() { const m = { addItem() { return m; }, addSeparator() { return m; }, addToUi() {} }; return m; }
  };
  const ss = {
    getSheetByName(n) { return sheets[n]; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
    deleteSheet(s) { delete sheets[s.getName()]; },
    getUi() { return ui; },
    toast() {},
    getUrl() { return 'https://docs.google.com/spreadsheets/d/ABC123/edit'; },
    setActiveSheet(s) { active = s; return s; },
    getActiveSheet() { return active; },
    _sheets: sheets
  };
  return { ss, ui };
}

/* ---------- インメモリ Drive ---------- */
let driveSeq = 0;
const driveFiles = {};    // id -> {id,name,mime,bytes,trashed,parentId}
const driveFolders = {};  // id -> {id,name,trashed,parentId}

function makeDriveFile(rec) {
  return {
    getId() { return rec.id; },
    getName() { return rec.name; },
    setTrashed(v) { rec.trashed = !!v; return this; },
    isTrashed() { return rec.trashed; },
    getBlob() {
      return {
        getContentType() { return rec.mime; },
        getBytes() { return rec.bytes; },
        getName() { return rec.name; }
      };
    }
  };
}

function makeDriveFolder(rec) {
  const F = {
    getId() { return rec.id; },
    getName() { return rec.name; },
    isTrashed() { return rec.trashed; },
    setTrashed(v) { rec.trashed = !!v; return F; },
    createFolder(name) {
      const r = { id: 'fold-' + (++driveSeq), name, trashed: false, parentId: rec.id };
      driveFolders[r.id] = r;
      return makeDriveFolder(r);
    },
    getFoldersByName(name) {
      const hits = Object.values(driveFolders)
        .filter(f => f.parentId === rec.id && f.name === name && !f.trashed)
        .map(makeDriveFolder);
      let i = 0;
      return { hasNext() { return i < hits.length; }, next() { return hits[i++]; } };
    },
    createFile(blob) {
      const r = {
        id: 'file-' + (++driveSeq), name: blob.getName(), mime: blob.getContentType(),
        bytes: blob.getBytes(), trashed: false, parentId: rec.id
      };
      driveFiles[r.id] = r;
      return makeDriveFile(r);
    }
  };
  return F;
}

const driveRootRec = { id: 'root', name: 'My Drive', trashed: false, parentId: null };
driveFolders['root'] = driveRootRec;

const DriveApp = {
  createFolder(name) { return makeDriveFolder(driveRootRec).createFolder(name); },
  getFolderById(id) {
    if (!driveFolders[id]) throw new Error('no folder ' + id);
    return makeDriveFolder(driveFolders[id]);
  },
  getFileById(id) {
    if (!driveFiles[id]) throw new Error('no file ' + id);
    return makeDriveFile(driveFiles[id]);
  }
};

/* ---------- GASサービスのモック ---------- */
let CURRENT_EMAIL = '';
let uuidCounter = 0;
const { ss, ui } = makeSpreadsheet();
const scriptProps = {};
let lastRender = null;
global.__reads = {}; global.__count = false;   // シート読み取り回数の計測

function pad2(n) { return n < 10 ? '0' + n : String(n); }

const sandbox = {
  console,
  SpreadsheetApp: {
    getActive() { return ss; }, getUi() { return ui; }, getActiveSpreadsheet() { return ss; },
    newDataValidation() {
      const b = { requireValueInList() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
      return b;
    }
  },
  LockService: { getScriptLock() { return { waitLock() { return true; }, releaseLock() {} }; } },
  Session: {
    getActiveUser() { return { getEmail() { return CURRENT_EMAIL; } }; },
    getEffectiveUser() { return { getEmail() { return CURRENT_EMAIL; } }; }
  },
  DriveApp,
  Utilities: {
    getUuid() { return 'uuid-' + (++uuidCounter); },
    formatDate(d, tz, fmt) {
      const map = {
        yyyy: String(d.getFullYear()), MM: pad2(d.getMonth() + 1), dd: pad2(d.getDate()),
        HH: pad2(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds())
      };
      return String(fmt).replace(/yyyy|MM|dd|HH|mm|ss/g, m => map[m]);
    },
    base64Decode(s) { return Array.from(Buffer.from(s, 'base64')); },
    base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
    newBlob(bytes, mime, name) {
      return {
        getBytes() { return bytes; },
        getContentType() { return mime; },
        getName() { return name; }
      };
    }
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(k) { return Object.prototype.hasOwnProperty.call(scriptProps, k) ? scriptProps[k] : null; },
        setProperty(k, v) { scriptProps[k] = String(v); return this; },
        deleteProperty(k) { delete scriptProps[k]; return this; }
      };
    }
  },
  CacheService: { getScriptCache() { return { get() { return null; }, put() {} }; } },
  ScriptApp: { getService() { return { getUrl() { return 'https://script.google.com/a/macros/school.jp/s/AKfy/exec'; } }; } },
  HtmlService: {
    // どのファイルを、どんな bootstrap で描画したかを覚えて doGet を検証できるようにする
    createTemplateFromFile(name) {
      const t = {
        __file: name,
        evaluate() {
          lastRender = { file: t.__file, bootstrap: t.bootstrap };
          return { setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } };
        }
      };
      return t;
    },
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
function truthy_G(v) { return vm.runInContext('truthy_(__args[0])', Object.assign(sandbox, { __args: [v] })); }
function C_HEADERS(name) { return vm.runInContext('C.HEADERS[' + JSON.stringify(name) + ']', sandbox); }
function backdate(min) { return vm.runInContext('new Date(Date.now()-' + min + '*60000)', sandbox); }
function dropCache() { vm.runInContext('Repo.dropCache()', sandbox); }

/* =================== テスト本体 =================== */
console.log('\n【1】初期セットアップ');
call('setupSheets');
const names = Object.keys(ss._sheets);
ok(names.length === 18, 'シートが18枚生成された（実際: ' + names.length + '）');
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
dropCache();   // Repo を通さずシートを書き換えたので（本番では呼び出しごとに実行が分かれる）
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

console.log('\n【18】振り返りの作り替え：計画とのズレと改善リスト');
asUser('c@school.jp');
call('student_saveReflection', {
  achievement: 95, planGap: '早く進んだ', planGapReason: '動画が分かりやすかった',
  selfEval: '発展に進めた', attrGood: ['やり方（工夫）がよかった'], attrHard: [],
  materialRequest: '白地図に県名が入っていると助かる', mood: '😊', nextPlan: '新聞の下書きを進める'
});
asUser('teacher@school.jp');
const imp = call('teacher_getImprovements');
ok(imp.hasUnit === true, '改善リストが返る');
ok(imp.requests.length === 2, '教材リクエストが2件集まる（A・C）');
ok(imp.requests.every(r => r.name && r.request), 'リクエストに児童名と内容が入る');
ok(imp.planGap['遅れた'] === 1 && imp.planGap['早く進んだ'] === 1, '計画とのズレの分布が集計される');
ok(imp.hardTop.length >= 1 && imp.hardTop[0].count >= 1, 'むずかしかった理由が集計される');
const reflC = call('teacher_getReflections', null).rows.find(r => r.userId === 'U03');
ok(reflC.planGap === '早く進んだ', '一覧に計画とのズレが出る');
ok(reflC.planGapReason.indexOf('動画') >= 0, 'ズレの理由が保存される');

console.log('\n【19】課題ごとの理解度とメモ（学びの足跡）');
asUser('a@school.jp');
// 理解度は評価ではなく自己申告。進度とは別に、同じ行へ記録する。
call('student_saveTaskNote', t1.taskId, 2, '年表は下から読むと流れが分かった');
call('student_saveTaskNote', t3.taskId, 4, '');
let stN = call('student_getState');
ok(stN.understandingLevels.length === 4, '理解度の目盛りが4段階返る');
ok(stN.tasks[0].understanding === 2, '課題①の理解度が保存される');
ok(stN.tasks[0].memo.indexOf('年表') >= 0, '課題①のメモが保存される');
ok(stN.tasks[2].understanding === 4, '課題ごとに違う理解度を持てる');
ok(stN.tasks[0].status === 1, 'メモを書いても進度は変わらない');
// 進度の更新でメモが消えない（upsert が渡した列だけを書く）
call('student_setProgress', t1.taskId, 2);
stN = call('student_getState');
ok(stN.tasks[0].status === 2, '進度が完了に変わる');
ok(stN.tasks[0].memo.indexOf('年表') >= 0, '進度を変えてもメモが残る');
ok(stN.tasks[0].understanding === 2, '進度を変えても理解度が残る');
// 未選択に戻せる（言い切らない自由）
call('student_saveTaskNote', t3.taskId, '', '');
ok(call('student_getState').tasks[2].understanding === null, '理解度は未選択に戻せる');
// 進度は1人1課題1件のまま
ok(sheetRows('進度').filter(r => r['user_id'] === 'U01' && r['task_id'] === t1.taskId).length === 1,
  'メモを足しても進度は1人1課題1件');

console.log('\n【20】足跡は単元をまたいで残る');
const fp = call('student_getPortfolio');
ok(fp.tasks.length >= 2, '課題ごとの足跡が返る');
const fpT1 = fp.tasks.find(t => t.taskId === t1.taskId);
ok(fpT1.memo.indexOf('年表') >= 0, '足跡にメモが載る');
ok(fpT1.understanding === 2, '足跡に理解度が載る');
ok(fpT1.used.length >= 1, '足跡に使った工夫が載る');
ok(fpT1.unitLabel.indexOf('社会') >= 0, '足跡がどの単元のものか分かる');
ok(fp.tasks.every(t => t.status > 0 || t.memo || t.understanding != null),
  '手つかずの課題は足跡に含めない');
ok(fp.items.length >= 1, '日ごとのきろくが返る');
ok(fp.items[0].goalDo !== undefined, '振り返りに、その日立てた計画が並ぶ');
ok(Array.isArray(fp.trend), '推移が返る');
// 単元が終わっても、前の単元の足跡は子どもの画面から消えない
asUser('teacher@school.jp');
call('teacher_setUnitState', unitId, '終了');
asUser('a@school.jp');
const fp2 = call('student_getPortfolio');
ok(fp2.tasks.length >= 2, '単元が終了しても課題の足跡が残る');
ok(fp2.tasks.every(t => t.isCurrent === false), '終わった単元は「いまの単元」ではない');
ok(fp2.items.length >= 1, '終了後も日ごとのきろくが残る');
asUser('teacher@school.jp');
call('teacher_setUnitState', unitId, '公開中');

console.log('\n【21】教師は理解度とメモを見取りに使える');
asUser('teacher@school.jp');
const detN = call('teacher_getStudentDetail', 'U01');
const dT1 = detN.tasks.find(t => t.title === stN.tasks[0].title);
ok(dT1.understanding === 2, '教師詳細に理解度が届く');
ok(dT1.memo.indexOf('年表') >= 0, '教師詳細にメモが届く');
ok(detN.understandingLevels.length === 4, '教師側にも理解度の目盛りが届く');
// 「完了」なのに理解度が低い＝環境（手引き・資料）を見直すサイン
ok(dT1.status === 2 && dT1.understanding <= 2, '完了なのに分かりぐあいが低い状態を検出できる');

console.log('\n【22】カメラ：学びログの写真を残す');
// 1x1 の JPEG をクライアントが縮小して送ってきたつもりのデータ
const PIX = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
asUser('a@school.jp');
const savedA = call('student_saveLog', t1.taskId, PIX, 'ノートに年表をまとめた');
ok(savedA.ok === true, '写真が保存できる');
ok(sheetRows('学びログ').length === 1, '学びログが1件記録される');
const logRowA = sheetRows('学びログ')[0];
ok(!!logRowA['ファイルID'], 'Drive のファイルIDが残る');
ok(logRowA['ファイル名'].indexOf('U01') === 0, 'ファイル名が生徒IDで始まる');
ok(logRowA['ファイル名'].indexOf('青木') >= 0, 'ファイル名に氏名が入る');
ok(/_\d{8}_\d{6}\./.test(logRowA['ファイル名']), 'ファイル名に撮影年月日と時刻が入る');
ok(logRowA['task_id'] === t1.taskId, '写真が課題に結びつく');
// フォルダは 単元 → 日付 の順に掘られる
const folderNames = Object.values(driveFolders).map(f => f.name);
ok(folderNames.indexOf('SRLアプリ_学びのきろく') >= 0, '置き場のルートフォルダができる');
ok(folderNames.some(n => n.indexOf('社会') >= 0 && n.indexOf('_') >= 0), '教科と単元名のフォルダができる');
ok(folderNames.indexOf(call('today_')) >= 0, '日付のフォルダができる');
// 2枚目は同じフォルダに入る（撮るたびにフォルダが増えない）
call('student_saveLog', t1.taskId, PIX, '');
ok(Object.values(driveFolders).filter(f => f.name === call('today_')).length === 1,
  '同じ日の写真は同じフォルダに入る');
// 画像は一覧では返さず、1枚ずつ取りに行く
const myLogs = call('student_getLogs', 'mine');
ok(myLogs.items.length === 2, '自分の学びログが2件返る');
ok(myLogs.items[0].dataUrl === undefined, '一覧に画像本体は含まれない（転送量を抑える）');
ok(myLogs.items[0].taskTitle.length > 0, '一覧にどの課題の写真か出る');
ok(call('student_getLogImage', savedA.log.logId).dataUrl === PIX, '画像を1枚ずつ取り出せる');
// 形式と大きさの検査
let badErr = '';
try { call('student_saveLog', t1.taskId, 'javascript:alert(1)', ''); } catch (e) { badErr = String(e.message || e); }
ok(badErr.indexOf('形式') >= 0, '画像でないデータは弾く');
let bigErr = '';
try { call('student_saveLog', t1.taskId, 'data:image/jpeg;base64,' + 'A'.repeat(5 * 1024 * 1024), ''); }
catch (e) { bigErr = String(e.message || e); }
ok(bigErr.indexOf('大きすぎ') >= 0, '大きすぎる画像は弾く');

console.log('\n【23】ビュー：みんなの学びログ');
asUser('b@school.jp');
call('student_saveLog', stB.tasks[4].taskId, PIX, '白地図をぬった');
asUser('teacher@school.jp');
call('teacher_setPeerRef', unitId, true, false);
asUser('a@school.jp');
const classLogs = call('student_getLogs', 'class');
ok(classLogs.classOpen === true, '他者参照が開いていればみんなの学びログが開く');
ok(classLogs.items.length === 3, '自分2件＋石田さん1件で3件');
ok(classLogs.items.some(i => i.who === '石田'), '記名モードでは名前が出る');
ok(classLogs.items.filter(i => i.mine).length === 2, '自分の写真が2件と分かる');
// 匿名モードでは自分以外の名前を伏せる
asUser('teacher@school.jp');
call('teacher_setPeerRef', unitId, true, true);
asUser('a@school.jp');
const anonLogs = call('student_getLogs', 'class');
ok(anonLogs.items.filter(i => !i.mine).every(i => i.who === 'クラスの人'), '匿名モードでは名前を伏せる');
ok(anonLogs.items.filter(i => i.mine).every(i => i.who === 'じぶん'), '匿名でも自分の写真は分かる');
// 教師が他者参照を閉じたら、他の子の写真は見えない
asUser('teacher@school.jp');
call('teacher_setPeerRef', unitId, false, false);
asUser('a@school.jp');
ok(call('student_getLogs', 'class').classOpen === false, '他者参照を閉じるとみんなの学びログも閉じる');
ok(call('student_getLogs', 'mine').items.length === 2, '閉じても自分の写真は見られる');

console.log('\n【24】学びログの見せる・消すは本人が決める');
const otherLog = (() => {
  asUser('teacher@school.jp');
  return call('teacher_getLogs', 'U02').items[0].logId;
})();
asUser('teacher@school.jp'); call('teacher_setPeerRef', unitId, true, false);
// 他人の写真は消せない
asUser('a@school.jp');
let delErr = '';
try { call('student_deleteLog', otherLog); } catch (e) { delErr = String(e.message || e); }
ok(delErr.indexOf('自分の写真') >= 0, '他人の写真は取り消せない');
let shareErr = '';
try { call('student_setLogShare', otherLog, false); } catch (e) { shareErr = String(e.message || e); }
ok(shareErr.indexOf('自分の写真') >= 0, '他人の写真の共有は変えられない');
// 共有を切ると、他の子からは見えなくなる
asUser('b@school.jp');
call('student_setLogShare', otherLog, false);
asUser('a@school.jp');
ok(call('student_getLogs', 'class').items.length === 2, '共有を切った写真はみんなの学びログから消える');
let imgErr = '';
try { call('student_getLogImage', otherLog); } catch (e) { imgErr = String(e.message || e); }
ok(imgErr.indexOf('見られません') >= 0, '共有していない写真は画像も取れない');
asUser('b@school.jp');
ok(call('student_getLogs', 'mine').items.length === 1, '共有を切っても本人は見られる');
// 取り消すと Drive の実体もゴミ箱に入る
const delFileId = sheetRows('学びログ').find(r => r['log_id'] === otherLog)['ファイルID'];
call('student_deleteLog', otherLog);
ok(sheetRows('学びログ').length === 2, '取り消した写真は学びログから消える');
ok(driveFiles[delFileId].trashed === true, '取り消すと Drive の写真もゴミ箱に入る');

console.log('\n【25】教師は学びログを見取りに使える');
asUser('teacher@school.jp');
const tLogs = call('teacher_getLogs', 'U01');
ok(tLogs.items.length === 2, '教師は児童の学びログ一覧を見られる');
ok(tLogs.items.some(i => i.comment.indexOf('年表') >= 0), 'ひとことが教師に届く');
ok(call('teacher_getLogImage', savedA.log.logId).dataUrl === PIX, '教師は画像を取り出せる');
// 記録消去は学びログに触れない（シートだけ消すと Drive に写真が残る）
ok(vm.runInContext('C.RECORD_SHEETS.indexOf(C.SH.LOG)', sandbox) === -1,
  '記録消去の対象に学びログを入れない');

console.log('\n【26】アプリから単元・課題・資料を編集する');
asUser('teacher@school.jp');
const newUnit = call('teacher_createUnit', { '教科': '理科', '学年': '6年', '単元名': '水よう液の性質' });
ok(!!newUnit.unitId, '単元をアプリからおこせる');
const nu = call('teacher_getDesign', newUnit.unitId);
ok(nu.unit.state === '準備中', 'できた単元は準備中から始まる');
ok(nu.unit.subject === '理科' && nu.unit.unitName === '水よう液の性質', '教科と単元名が入る');
ok(nu.tasks.length === 0, '課題はまだ0件');
let nameErr = '';
try { call('teacher_createUnit', { '単元名': '  ' }); } catch (e) { nameErr = String(e.message || e); }
ok(nameErr.indexOf('単元名') >= 0, '単元名が空なら断る');

// 課題を3件足して並べ替える
const nt1 = call('teacher_saveTask', null, { unitId: newUnit.unitId, '種別': '必須', 'タイトル': 'リトマス紙で調べる', 'めやす分': 45 });
const nt2 = call('teacher_saveTask', null, { unitId: newUnit.unitId, '種別': '必須', 'タイトル': '結果を表にまとめる', 'めやす分': 45 });
const nt3 = call('teacher_saveTask', null, { unitId: newUnit.unitId, '種別': '発展', 'タイトル': '身のまわりの液体を調べる', 'めやす分': 45 });
let tasks3 = call('teacher_getDesign', newUnit.unitId).tasks;
ok(tasks3.length === 3, '課題を3件追加できる');
ok(tasks3.every(t => t.published === false), '追加した課題は非公開で入る（段階的公開のため）');
ok(tasks3.map(t => t.order).join(',') === '1,2,3', '並びは追加した順に振られる');

call('teacher_moveTask', nt3.taskId, -1);
tasks3 = call('teacher_getDesign', newUnit.unitId).tasks;
ok(tasks3[1].taskId === nt3.taskId, '課題を1つ上に動かせる');
ok(tasks3.map(t => t.order).join(',') === '1,2,3', '入れ替えても並びは通し番号のまま');
ok(call('teacher_moveTask', tasks3[0].taskId, -1).moved === false, '先頭より上には動かせない');

// 編集と入力の検査
call('teacher_saveTask', nt1.taskId, { '種別': '選択', 'タイトル': 'リトマス紙で調べる（改）', '説明': '安全めがねをつけよう', 'めやす分': 30 });
const edited = call('teacher_getDesign', newUnit.unitId).tasks.filter(t => t.taskId === nt1.taskId)[0];
ok(edited.kind === '選択' && edited.mins === 30, '課題の種別とめやす分を更新できる');
ok(edited.desc.indexOf('安全めがね') >= 0, '説明を更新できる');
let kindErr = '';
try { call('teacher_saveTask', null, { unitId: newUnit.unitId, '種別': 'なんでも', 'タイトル': 'X' }); } catch (e) { kindErr = String(e.message || e); }
ok(kindErr.indexOf('種別') >= 0, '種別が必須／選択／発展のどれでもなければ断る');
let titleErr = '';
try { call('teacher_saveTask', null, { unitId: newUnit.unitId, '種別': '必須', 'タイトル': '' }); } catch (e) { titleErr = String(e.message || e); }
ok(titleErr.indexOf('タイトル') >= 0, 'タイトルが空なら断る');

// 資料
const nr = call('teacher_saveResource', null, {
  unitId: newUnit.unitId, taskId: nt1.taskId, 'アイコン': '🎬',
  'タイトル': 'リトマス紙の使い方', '種別': '動画', 'URL': 'https://www.nhk.or.jp/school/'
});
ok(!!nr.resourceId, '課題に資料を足せる');
const withRes = call('teacher_getDesign', newUnit.unitId).tasks.filter(t => t.taskId === nt1.taskId)[0];
ok(withRes.resources.length === 1 && withRes.resources[0].resourceId === nr.resourceId, '資料が課題に紐づいて返る');
const commonRes = call('teacher_saveResource', null, { unitId: newUnit.unitId, 'タイトル': '安全のきまり', '種別': '手もと資料' });
ok(call('teacher_getDesign', newUnit.unitId).commonResources.length === 1, 'task_id なしなら「いつでも使える資料」になる');
let urlErr = '';
try { call('teacher_saveResource', null, { unitId: newUnit.unitId, 'タイトル': 'X', 'URL': 'javascript:alert(1)' }); }
catch (e) { urlErr = String(e.message || e); }
ok(urlErr.indexOf('URL') >= 0, 'http(s) 以外のURLは断る（子どもの画面にリンクを出すため）');
call('teacher_setResourcePublish', nr.resourceId, false);
ok(call('teacher_getDesign', newUnit.unitId).tasks.filter(t => t.taskId === nt1.taskId)[0].resources[0].published === false,
  '資料だけ隠せる');
call('teacher_deleteResource', commonRes.resourceId);
ok(call('teacher_getDesign', newUnit.unitId).commonResources.length === 0, '資料を消せる');

console.log('\n【27】記録がぶら下がっているものは消させない');
// 記録のない課題は消せる（資料も道連れ）
call('teacher_deleteTask', nt2.taskId);
const afterDel = call('teacher_getDesign', newUnit.unitId);
ok(afterDel.tasks.length === 2, '記録のない課題は消せる');
ok(afterDel.tasks.map(t => t.order).join(',') === '1,2', '消したあと並びが詰まる');
// 記録のある課題・単元は消せない
asUser('teacher@school.jp');
let delTaskErr = '';
try { call('teacher_deleteTask', t1.taskId); } catch (e) { delTaskErr = String(e.message || e); }
ok(delTaskErr.indexOf('記録') >= 0 && delTaskErr.indexOf('公開') >= 0,
  '記録のある課題は断り、「公開を切る」を案内する');
let delUnitErr = '';
try { call('teacher_deleteUnit', unitId); } catch (e) { delUnitErr = String(e.message || e); }
ok(delUnitErr.indexOf('終了') >= 0, '記録のある単元は断り、「終了」を案内する');
const del1 = call('teacher_getUnitDeletable', unitId);
ok(del1.canDelete === false && del1.recordCount > 0, '記録のある単元は消せないと返る（押したときだけ数える）');
ok(call('teacher_getDesign', unitId).unitRecordCount === undefined,
  '単元の読み込みでは記録を数えない（記録系10シートを読まずに済ませる）');
// 記録のない単元は課題ごと消せる
call('teacher_deleteUnit', newUnit.unitId);
ok(sheetRows('単元').filter(u => u['unit_id'] === newUnit.unitId).length === 0, '記録のない単元は消せる');
ok(sheetRows('課題').filter(t => t['unit_id'] === newUnit.unitId).length === 0, '単元を消すと課題も消える');
ok(sheetRows('資料').filter(r => r['unit_id'] === newUnit.unitId).length === 0, '単元を消すと資料も消える');

console.log('\n【28】デモモード：役割を行き来する');
// 既定ではオフ。児童は児童画面のまま
ok(call('isDemoMode_') === false, '既定ではデモモードはオフ');
asUser('a@school.jp');
call('doGet', { parameter: {} });
ok(lastRender.file === 'student', '児童は児童画面');
call('doGet', { parameter: { as: 'teacher' } });
ok(lastRender.file === 'student', 'オフのあいだ児童は教師画面に行けない');
let roleErr = '';
try { call('teacher_getMonitor'); } catch (e) { roleErr = String(e.message || e); }
ok(roleErr.indexOf('教師のみ') >= 0, 'オフのあいだ児童は教師の操作を通せない');
// 教師はいつでも児童画面を下見できる
asUser('teacher@school.jp');
call('doGet', { parameter: {} });
ok(lastRender.file === 'teacher', '教師は教師画面');
call('doGet', { parameter: { as: 'student' } });
ok(lastRender.file === 'student', '教師はデモモードでなくても児童画面を下見できる');
ok(lastRender.bootstrap.canSwitch.indexOf('https://') === 0, '切り替えリンク用のURLが渡る');

// オンにすると児童も行き来できる
vm.runInContext('PropertiesService.getScriptProperties().setProperty(C.DEMO_PROP, "TRUE")', sandbox);
ok(call('isDemoMode_') === true, 'デモモードをオンにできる');
asUser('a@school.jp');
call('doGet', { parameter: { as: 'teacher' } });
ok(lastRender.file === 'teacher', 'オンなら児童も教師画面を開ける');
ok(lastRender.bootstrap.demo === true, '画面にデモ中であることが渡る');
ok(call('teacher_getMonitor').hasUnit === true, 'オンなら児童でも教師の操作が通る');
call('doGet', { parameter: { as: 'student' } });
ok(lastRender.file === 'student', 'オンでも児童画面に戻れる');
// 名簿にいない人はデモモードでも入れない
asUser('unknown@school.jp');
call('doGet', { parameter: { as: 'teacher' } });
ok(lastRender.file === 'unauthorized', 'デモモードでも名簿外は入れない');
let unkErr = '';
try { call('teacher_getMonitor'); } catch (e) { unkErr = String(e.message || e); }
ok(unkErr.indexOf('名簿') >= 0, 'デモモードでも名簿外は教師の操作を通せない');
// 戻す
vm.runInContext('PropertiesService.getScriptProperties().setProperty(C.DEMO_PROP, "FALSE")', sandbox);
asUser('a@school.jp');
call('doGet', { parameter: { as: 'teacher' } });
ok(lastRender.file === 'student', 'オフに戻すと元の役割どおりになる');

console.log('\n【29】単元シート：1枚で目標・課題・資料を書く');
asUser('teacher@school.jp');
// 既存の単元を書き出す（1件目＝デモ単元）
ui.promptText = '1';
call('unitSheetExport');
const usName = '単元_' + sheetRows('単元')[0]['単元名'];
const usSheet = ss._sheets[usName];
ok(!!usSheet, '単元シートが作られる');
const grid = usSheet._dump();
ok(grid[0][0] === '単元シート', 'A1が目印になっている');
ok(grid[0][1] === unitId, 'B1に unit_id が入る（次の取り込みで更新になる）');
const labelCol = grid.map(r => String(r[0]));
ok(labelCol.indexOf('■ 課題') > 0 && labelCol.indexOf('■ 資料') > labelCol.indexOf('■ 課題'),
  '課題と資料の区切りが順に並ぶ');
ok(labelCol.indexOf('単元の出口（成果物イメージ）') > 0, '単元の項目が縦に並ぶ');
const taskMarkAt = labelCol.indexOf('■ 課題');
ok(grid[taskMarkAt + 1][0] === '種別' && grid[taskMarkAt + 1][5].indexOf('task_id') === 0,
  '課題の見出しに task_id 列がある');
ok(grid[taskMarkAt + 2][1] === sheetRows('課題').filter(t => t['unit_id'] === unitId)
  .sort((a, b) => Number(a['並び']) - Number(b['並び']))[0]['タイトル'], '課題が並び順に書き出される');
const resMarkAt = labelCol.indexOf('■ 資料');
ok(grid[resMarkAt + 2][0] === '' || Number(grid[resMarkAt + 2][0]) > 0,
  '資料の課題番号は番号か空（unit_id を貼らなくてよい）');

console.log('\n【30】単元シートの取り込み（何度でもやり直せる）');
// 新しい単元シートを1枚おこして書き込む
ui.promptText = 'ふりこの動き';
call('unitSheetNew');
const nsName = '単元_ふりこの動き';
const ns = ss._sheets[nsName];
ok(!!ns, '空のひな形が作られる');

const setCell = (sheet, row, col, v) => sheet.getRange(row, col, 1, 1).setValue(v);
const findRow = (sheet, label) => sheet._dump().map(r => String(r[0])).indexOf(label) + 1;
setCell(ns, findRow(ns, '教科'), 2, '理科');
setCell(ns, findRow(ns, '学年'), 2, '5年');
setCell(ns, findRow(ns, '単元の問い・目標'), 2, 'ふりこが1往復する時間は何で決まるのか');
setCell(ns, findRow(ns, '単元の出口（成果物イメージ）'), 2, '実験レポート');
const nsTaskTop = findRow(ns, '■ 課題') + 2;
[['必須','ふりこをつくる','糸とおもりで', 45, '公開'],
 ['必須','長さを変えて調べる','', 45, '非公開'],
 ['発展','身のまわりのふりこ','', 45, '非公開']].forEach((r, i) => {
  r.forEach((v, c) => setCell(ns, nsTaskTop + i, c + 1, v));
});
const nsResTop = findRow(ns, '■ 資料') + 2;
[[1, '🎬', 'ふりこのつくり方', '動画3分', '動画', 'https://www.nhk.or.jp/school/', '公開'],
 ['', '📖', '安全のきまり', '', '手もと資料', '', '公開']].forEach((r, i) => {
  r.forEach((v, c) => setCell(ns, nsResTop + i, c + 1, v));
});

ss.setActiveSheet(ns);
call('unitSheetImport');
const newUnitRow = sheetRows('単元').filter(u => u['単元名'] === 'ふりこの動き')[0];
ok(!!newUnitRow, '単元が1件できる');
ok(newUnitRow['状態'] === '準備中', '取り込んだ単元は準備中');
ok(newUnitRow['教科'] === '理科' && newUnitRow['学年'] === '5年', '教科と学年が入る');
ok(newUnitRow['成果物イメージ'] === '実験レポート', '単元の出口が入る');
const nsId = newUnitRow['unit_id'];
ok(ns._dump()[0][1] === nsId, 'B1に unit_id が書き戻される');

const nsTasks = sheetRows('課題').filter(t => t['unit_id'] === nsId)
  .sort((a, b) => Number(a['並び']) - Number(b['並び']));
ok(nsTasks.length === 3, '課題が3件入る');
ok(nsTasks.map(t => t['並び']).join(',') === '1,2,3', 'シートの行順が並びになる');
ok(nsTasks[0]['タイトル'] === 'ふりこをつくる' && nsTasks[2]['種別'] === '発展', '種別とタイトルが入る');
ok(truthy_G(nsTasks[0]['公開']) === true && truthy_G(nsTasks[1]['公開']) === false,
  '「公開／非公開」がそのまま入る');
ok(ns._dump()[nsTaskTop - 1][5].length > 0, '課題の task_id がシートに書き戻される');

const nsRes = sheetRows('資料').filter(r => r['unit_id'] === nsId);
ok(nsRes.length === 2, '資料が2件入る');
ok(nsRes.filter(r => r['task_id'] === nsTasks[0]['task_id']).length === 1,
  '課題番号1が1つ目の課題に結びつく');
ok(nsRes.filter(r => !r['task_id']).length === 1, '課題番号が空なら「いつでも使える資料」になる');

// 2回目の取り込みは追加ではなく更新（冪等）
setCell(ns, nsTaskTop, 2, 'ふりこをつくる（改）');
call('unitSheetImport');
const again = sheetRows('課題').filter(t => t['unit_id'] === nsId);
ok(again.length === 3, '取り込み直しても課題が増えない');
ok(again.filter(t => t['タイトル'] === 'ふりこをつくる（改）').length === 1, '2回目は更新になる');
ok(sheetRows('単元').filter(u => u['unit_id'] === nsId).length === 1, '単元も増えない');

// 行を消すと消える（記録がなければ）
setCell(ns, nsTaskTop + 2, 2, '');
setCell(ns, nsTaskTop + 2, 6, '');
call('unitSheetImport');
ok(sheetRows('課題').filter(t => t['unit_id'] === nsId).length === 2, 'シートから消した課題は消える');

// 種別の打ち間違いと不正URLは取り込まず、理由を知らせる
setCell(ns, nsTaskTop + 2, 1, 'ひっす');
setCell(ns, nsTaskTop + 2, 2, 'まちがえた課題');
call('unitSheetImport');
ok(sheetRows('課題').filter(t => t['タイトル'] === 'まちがえた課題').length === 0, '種別が不正な行は取り込まない');
ok(String(ui.lastAlert).indexOf('読めなかった行') >= 0, '読めなかった行を知らせる');
setCell(ns, nsTaskTop + 2, 2, '');
setCell(ns, nsTaskTop + 2, 1, '');

// 記録のある課題はシートから消しても残す
asUser('a@school.jp');
const keepTask = sheetRows('課題').filter(t => t['unit_id'] === nsId)[0];
vm.runInContext('Repo.append(C.SH.PROG, {progress_id:"keep1", unit_id:' + JSON.stringify(nsId) +
  ', task_id:' + JSON.stringify(keepTask['task_id']) + ', user_id:"U01", "状態":1, "更新時刻": Repo.now()})', sandbox);
asUser('teacher@school.jp');
setCell(ns, nsTaskTop, 2, '');
call('unitSheetImport');
ok(sheetRows('課題').filter(t => t['task_id'] === keepTask['task_id']).length === 1,
  '子どもの記録がある課題は、シートから消しても残す');
ok(String(ui.lastAlert).indexOf('消さずに残した') >= 0, '残したことを知らせる');

// 単元シートでないところで実行したら断る
ss.setActiveSheet(ss._sheets['名簿']);
call('unitSheetImport');
ok(String(ui.lastAlert).indexOf('単元シートではありません') >= 0, '単元シート以外では断る');

console.log('\n【31】反映のタイムラグを減らす');
asUser('teacher@school.jp');
// 保存の戻り値に最新の画面が載る（保存→取り直しの2往復をやめる）
const savedTask = call('teacher_saveTask', null, { unitId: nsId, '種別': '選択', 'タイトル': '往復時間をはかる' });
ok(!!savedTask.design, '課題の保存が最新の画面を返す');
ok(savedTask.design.tasks.filter(t => t.taskId === savedTask.taskId).length === 1, '返った画面に追加分が入っている');
const savedRes = call('teacher_saveResource', null, { unitId: nsId, 'タイトル': 'ストップウォッチの使い方' });
ok(!!savedRes.design, '資料の保存が最新の画面を返す');
ok(savedRes.design.commonResources.filter(r => r.resourceId === savedRes.resourceId).length === 1,
  '返った画面に資料が入っている');
ok(!!call('teacher_moveTask', savedTask.taskId, -1).design, '並べ替えも最新の画面を返す');
ok(!!call('teacher_deleteTask', savedTask.taskId).design, '削除も最新の画面を返す');

// 児童は版を見て更新に気づける
asUser('a@school.jp');
const v1 = call('student_getVersion').version;
ok(typeof v1 === 'string' && v1.length > 0, '児童は軽い版チェックができる');
ok(call('student_getVersion').version === v1, '何も変わらなければ版は同じ');
asUser('teacher@school.jp');
const extra = call('teacher_saveTask', null, { unitId: unitId, '種別': '選択', 'タイトル': '追加の課題' });
call('teacher_setTaskPublish', extra.taskId, true);
asUser('a@school.jp');
ok(call('student_getVersion').version !== v1, '先生が課題を公開すると版が変わる');
asUser('teacher@school.jp');
call('teacher_setTaskPublish', extra.taskId, false);
asUser('a@school.jp');
ok(call('student_getVersion').version === v1, '非公開に戻すと版も戻る');

console.log('\n【32】決まった選択肢はプルダウンにする');
const vs = vm.runInContext('C.VALIDATIONS', sandbox);
ok(vs['名簿']['役割'].join(',') === 'teacher,student', '名簿の役割がプルダウン対象');
ok(vs['課題']['種別'].join(',') === '必須,選択,発展', '課題の種別がプルダウン対象');
ok(vs['資料']['種別'].indexOf('動画') >= 0, '資料の種別がプルダウン対象');
ok(vs['単元']['状態'].join(',') === '準備中,公開中,終了', '単元の状態がプルダウン対象');
ok(vs['単元']['他者参照'].join(',') === 'TRUE,FALSE', 'TRUE/FALSE の列もプルダウン対象');
Object.keys(vs).forEach(function (sh) {
  Object.keys(vs[sh]).forEach(function (col) {
    ok(C_HEADERS(sh).indexOf(col) >= 0, 'プルダウン指定「' + sh + '.' + col + '」が実際の列に存在する');
  });
});

console.log('\n【33】この子の画面を見る（読み取り専用）');
asUser('teacher@school.jp');
// 先生の画面から児童の画面へ
call('doGet', { parameter: { as: 'student', who: 'U01' } });
ok(lastRender.file === 'student', '児童画面が返る');
ok(lastRender.bootstrap.viewingName === '青木', '誰の画面を見ているかが画面に渡る');
ok(lastRender.bootstrap.readOnly === true, '読み取り専用として渡る');
// 以降のサーバー関数もその子として動く（URLの引数は残らないので状態で持つ）
const seen = call('student_getState');
ok(seen.me.userId === 'U01', '続くサーバー関数もその子として動く');
ok(seen.tasks[0].memo.indexOf('年表') >= 0, 'その子が書いたメモが見える');
ok(seen.tasks[0].understanding === 2, 'その子の分かりぐあいが見える');
ok(call('student_getPortfolio').tasks.length >= 1, 'その子の学びの足跡が見える');
ok(call('teacher_getMonitor').hasUnit === true, '見ている最中でも先生の操作は通る（本人の役割で判定）');

// 書き込みはすべて断る
const writeCalls = [
  ['student_saveGoal', ['集中して', 'テスト', [], 50]],
  ['student_setProgress', [t1.taskId, 1]],
  ['student_saveTaskNote', [t1.taskId, 4, '先生が書いた']],
  ['student_saveSelection', [t1.taskId, '学習形態', 'ひとりで']],
  ['student_useStrategy', [t1.taskId, 'S01', false]],
  ['student_raiseHelp', [true]],
  ['student_saveCheckpoint', [10, '順調', '']],
  ['student_saveReflection', [{ achievement: 10 }]],
  ['student_saveLog', [t1.taskId, PIX, '']]
];
let blocked = 0;
writeCalls.forEach(function (c) {
  try { call(c[0], ...c[1]); } catch (e) {
    if (String(e.message || e).indexOf('読み取り専用') >= 0) blocked++;
  }
});
ok(blocked === writeCalls.length, '書き込みは' + writeCalls.length + '件すべて断る');
ok(call('student_getState').tasks[0].memo.indexOf('年表') >= 0, '断ったのでその子のメモは変わらない');
ok(call('student_getState').tasks[0].understanding === 2, '断ったので分かりぐあいも変わらない');

// 見るのをやめると先生に戻る
call('doGet', { parameter: { as: 'teacher' } });
ok(lastRender.file === 'teacher', '「見るのをやめる」で先生画面に戻れる');
ok(!lastRender.bootstrap.viewingName, '見ている相手が消える');
ok(call('getContext').user.userId === 'T01', '自分に戻る');
// 戻ったあとは自分として書ける
call('doGet', { parameter: { as: 'student' } });
ok(lastRender.bootstrap.readOnly === false, '自分の児童画面は読み取り専用ではない');

// 児童は他人の画面を見に行けない
asUser('b@school.jp');
call('doGet', { parameter: { as: 'student', who: 'U01' } });
ok(call('student_getState').me.userId === 'U02', '児童は who を付けても他人になれない');
// 教師でも、児童以外は見に行けない
asUser('teacher@school.jp');
call('doGet', { parameter: { as: 'student', who: 'T01' } });
ok(call('getContext').viewingUser === null, '教師を見る対象には選べない');
call('doGet', { parameter: { as: 'student', who: 'U99' } });
ok(call('getContext').viewingUser === null, '名簿にないIDは無視する');
call('doGet', { parameter: { as: 'teacher' } });

// 見に行く状態は人ごとに分かれている（1人の設定が全員に及ばない）
call('doGet', { parameter: { as: 'student', who: 'U01' } });
asUser('c@school.jp');
ok(call('student_getState').me.userId === 'U03', '先生が誰かを見ていても、児童は自分のまま');
asUser('teacher@school.jp');
ok(call('student_getState').me.userId === 'U01', '先生は見ている相手のまま');
call('doGet', { parameter: { as: 'teacher' } });
ok(call('getContext').viewingUser === null, '後片付け');

console.log('\n【34】読み込みを軽くする・シートへのリンク');
asUser('teacher@school.jp');
// 同じ実行の中で同じシートを読み直さない
dropCache();
global.__reads = {}; global.__count = true;
call('teacher_getDesign', unitId);
global.__count = false;
const reads = Object.values(global.__reads).reduce((a, b) => a + b, 0);
ok(reads <= 8, '単元の読み込みでシートを読むのは8回まで（実際: ' + reads + '）');
ok(!global.__reads['進度'] && !global.__reads['振り返り'],
  '単元の読み込みで記録系シートを読まない');
// 書いたシートはその場でキャッシュを捨てるので、同じ実行でも最新が返る
const beforeN = call('teacher_getDesign', unitId).tasks.length;
const addT = call('teacher_saveTask', null, { unitId: unitId, '種別': '選択', 'タイトル': 'キャッシュ確認' });
ok(addT.design.tasks.length === beforeN + 1, '書き込み直後の読み取りに追加分が反映される');
call('teacher_deleteTask', addT.taskId);

// シートへのリンク
const links = call('teacher_getSheetLinks');
ok(links.spreadsheet.indexOf('http') === 0, 'スプレッドシートのURLが返る');
ok(links.sheets.length >= 4, 'よく開くシートのリンクが返る');
ok(links.sheets.every(s => /#gid=\d+/.test(s.url)), '各シートに #gid が付く');
ok(links.sheets.some(s => s.name === '名簿'), '名簿へのリンクがある');
ok(links.sheets.some(s => s.name === '学びログ'), '学びログへのリンクがある');
// いま公開中の単元に単元シートがあれば、それも返す
ui.promptText = '1';
call('unitSheetExport');
ok(call('teacher_getSheetLinks').unitSheet !== null, '公開中の単元の単元シートへのリンクが返る');

/* =================== 結果 =================== */
console.log('\n========================================');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
if (fail) { console.log('  失敗: ' + fails.join(' / ')); process.exit(1); }
else console.log('  すべての結合テストに合格しました 🎉');

/**
 * GASサーバーロジックの結合テスト用ハーネス。
 * 実際の src/*.gs を、GASグローバルを模したサンドボックスに読み込んで実行する。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const GS_ORDER = ['Constants.gs','Repo.gs','Auth.gs','Code.gs','Setup.gs','StudentApi.gs','TeacherApi.gs'];

/* ---------- インメモリ・スプレッドシート ---------- */
function makeSheet(name){
  let data = []; // 2D配列（各セルはそのままの値）
  const width = () => data.reduce((m,r)=>Math.max(m,r.length),0);
  function pad(row, n){ const r=row.slice(); while(r.length<n) r.push(''); return r; }
  function range(row,col,numRows,numCols){
    numRows = numRows || 1; numCols = numCols || 1;
    const R = {
      getValues(){
        const out=[];
        for(let i=0;i<numRows;i++){
          const src = data[row-1+i] || [];
          const line=[];
          for(let j=0;j<numCols;j++) line.push(src[col-1+j] !== undefined ? src[col-1+j] : '');
          out.push(line);
        }
        return out;
      },
      setValues(vals){
        for(let i=0;i<vals.length;i++){
          const r = row-1+i;
          if(!data[r]) data[r]=[];
          for(let j=0;j<vals[i].length;j++) data[r][col-1+j]=vals[i][j];
        }
        return R;
      },
      setValue(v){
        const r=row-1; if(!data[r]) data[r]=[]; data[r][col-1]=v; return R;
      },
      setFontWeight(){return R;}, setBackground(){return R;},
      setNumberFormat(){return R;}, setFontColor(){return R;}
    };
    return R;
  }
  return {
    getName(){return name;},
    getRange(r,c,nr,nc){ return range(r,c,nr,nc); },
    getDataRange(){ return range(1,1,Math.max(data.length,1),Math.max(width(),1)); },
    getLastRow(){ return data.length; },
    getLastColumn(){ return width(); },
    appendRow(row){ data.push(pad(row, Math.max(width(), row.length))); },
    deleteRow(r){ data.splice(r-1,1); },
    deleteRows(start,count){ data.splice(start-1,count); },
    setFrozenRows(){}, autoResizeColumns(){},
    _dump(){ return data; }
  };
}

function makeSpreadsheet(){
  const sheets = {};
  const ui = {
    alert: (...a)=>{ lastAlert = a; return ui.Button.OK; },
    ButtonSet:{ OK:'OK', YES_NO:'YES_NO' },
    Button:{ OK:'OK', YES:'YES', NO:'NO' },
    createMenu(){ const m={ addItem(){return m;}, addSeparator(){return m;}, addToUi(){} }; return m; }
  };
  let lastAlert=null;
  const ss = {
    getSheetByName(n){ return sheets[n]; },
    insertSheet(n){ sheets[n]=makeSheet(n); return sheets[n]; },
    deleteSheet(s){ delete sheets[s.getName()]; },
    getUi(){ return ui; },
    toast(){},
    _sheets:sheets
  };
  return { ss, ui };
}

/* ---------- GASサービスのモック ---------- */
let CURRENT_EMAIL = '';           // ログイン中ユーザー（テストで差し替え）
let uuidCounter = 0;
const { ss, ui } = makeSpreadsheet();

const sandbox = {
  console,
  SpreadsheetApp: {
    getActive(){ return ss; },
    getUi(){ return ui; },
    getActiveSpreadsheet(){ return ss; }
  },
  LockService: { getScriptLock(){ return { waitLock(){return true;}, releaseLock(){} }; } },
  Session: {
    getActiveUser(){ return { getEmail(){ return CURRENT_EMAIL; } }; },
    getEffectiveUser(){ return { getEmail(){ return CURRENT_EMAIL; } }; }
  },
  Utilities: { getUuid(){ return 'uuid-' + (++uuidCounter); } },
  PropertiesService: { getScriptProperties(){ return { getProperty(){ return null; } }; } },
  CacheService: { getScriptCache(){ return { get(){return null;}, put(){} }; } },
  HtmlService: {
    createTemplateFromFile(){ return { evaluate(){ return { setTitle(){return this;}, addMetaTag(){return this;}, setXFrameOptionsMode(){return this;} }; } }; },
    createHtmlOutputFromFile(){ return { getContent(){ return ''; } }; },
    XFrameOptionsMode:{ ALLOWALL:'ALLOWALL' }
  }
};
vm.createContext(sandbox);

// 全 .gs を1つの共有スコープに読み込む（GASの挙動を再現）
let code = '';
for(const f of GS_ORDER) code += fs.readFileSync(path.join(SRC,f),'utf8') + '\n';
vm.runInContext(code, sandbox, { filename:'all.gs' });

/* ---------- テストユーティリティ ---------- */
let pass=0, fail=0; const fails=[];
function ok(cond, label){ if(cond){pass++; console.log('  ✓ '+label);} else {fail++; fails.push(label); console.log('  ✗ '+label);} }
function run(fn){ return vm.runInContext('('+fn+')()', sandbox); }
function call(fnName, ...args){
  sandbox.__args = args;
  return vm.runInContext(fnName+'.apply(null, __args)', sandbox);
}
function asUser(email){ CURRENT_EMAIL = email; }
function sheetRows(name){ // 見出しキーのオブジェクト配列
  return vm.runInContext('Repo.readAll('+JSON.stringify(name)+')', sandbox);
}

/* =================== テスト本体 =================== */
console.log('\n【1】初期セットアップ');
call('setupSheets');
const names = Object.keys(ss._sheets);
ok(names.length === 16, 'シートが16枚生成された（実際: '+names.length+'）');
ok(sheetRows('方略マスタ').length === 6, '方略マスタに6枚のサンプル');
ok(sheetRows('選択肢マスタ').length === 11, '選択肢マスタに11件');
ok(sheetRows('単元').length === 1, 'デモ単元が1件');
ok(sheetRows('本時').length === 1, 'デモ本時が1件');
ok(sheetRows('本時_資料').length === 5, '資料が5件');
ok(sheetRows('本時_選択肢設定').length === 4, '選択肢設定4カテゴリ');

console.log('\n【2】名簿を登録（教師1・児童4）');
const roster = [
  ['T01','山田先生','山田先生','0','teacher','teacher@school.jp'],
  ['U01','青木','青木','1','student','a@school.jp'],
  ['U02','石田','石田','2','student','b@school.jp'],
  ['U03','上野','上野','3','student','c@school.jp'],
  ['U04','遠藤','遠藤','4','student','d@school.jp']
];
roster.forEach(r=> ss._sheets['名簿'].appendRow(r));
ok(sheetRows('名簿').length === 5, '名簿5名を登録');

console.log('\n【3】ロール判定（doGetの出し分け根拠）');
asUser('teacher@school.jp');
ok(call('getContext').role === 'teacher', '教師メール→ roleがteacher');
asUser('a@school.jp');
ok(call('getContext').role === 'student', '児童メール→ roleがstudent');
asUser('unknown@school.jp');
ok(call('getContext').user === null, '名簿外→ user=null（unauthorized画面へ）');

console.log('\n【4】本時を公開（教師）');
asUser('teacher@school.jp');
const design = call('teacher_getDesign', null);
const lessonId = design.lesson.lessonId;
ok(design.lesson.state === '下書き', '初期状態は下書き');
call('teacher_setLessonState', lessonId, '公開中');
ok(call('currentLesson_')['状態'] === '公開中', '公開中になり currentLesson_ が拾える');

console.log('\n【5】児童Aの見通す→やってみる');
asUser('a@school.jp');
let st = call('student_getState');
ok(st.hasLesson === true, '公開中の本時が見える');
ok(st.lesson.task.indexOf('大名') >= 0, '課題文が届く');
ok(st.recommendedStrategies.length === 2, 'おすすめ方略が2枚');
ok(st.choices.length === 3, '開放カテゴリは3つ（場所は非開放）');
ok(st.checklist.length === 4, 'チェック項目が4つ');
call('student_saveGoal', '集中して・協力して', '白地図に色分け＋説明文3文', ['S01','S03']);
call('student_saveSelection', '学習形態', 'ペアで');
call('student_saveSelection', 'ツール', '教科書,資料集');   // 複数選択
call('student_useStrategy', 'S01', true);
// 4項目すべて完了 → done 判定を狙う
[0,1,2,3].forEach(i=> call('student_setProgress', i, 2, '項目'+i));
st = call('student_getState');
ok(st.my.goal && st.my.goal.regulate.length === 2, '目標のRegulateが保存・復元される');
ok(Array.isArray(st.my.selections['ツール']) && st.my.selections['ツール'].length === 2, '複数選択が配列で復元される');
ok(st.my.selections['学習形態'] === 'ペアで', '単一選択が復元される');
ok(st.my.strategyUse['S01'] === true, '「つかった！」が復元される');
ok(st.checklist.every(c=>c.status===2), '進度が全完了で復元される');

console.log('\n【6】選択の変更履歴（調整の記録）');
call('student_saveSelection', '学習形態', 'ひとりで');  // ペア→ひとり
const sels = sheetRows('選択').filter(r=> r['user_id']==='U01' && r['カテゴリ']==='学習形態');
ok(sels.length === 2, '学習形態の選択が2件（履歴が残る）');
const changed = sels.find(r=> r['選んだ値']==='ひとりで');
ok(changed && changed['変更前の値']==='ペアで', '変更前の値が記録されている');

console.log('\n【7】児童B=こまった / C=busy / D=none');
asUser('b@school.jp'); call('student_saveGoal','','途中まで',[]); call('student_raiseHelp', true);
asUser('c@school.jp'); call('student_saveGoal','ねばり強く','取組中',['S02']); call('student_setProgress',0,1,'項目0');
// D は何もしない

console.log('\n【8】教師の授業モニタ');
asUser('teacher@school.jp');
const mon = call('teacher_getMonitor');
ok(mon.hasLesson === true, 'モニタに本時あり');
ok(mon.tiles.length === 4, 'タイルは児童4名');
const byNo = {}; mon.tiles.forEach(t=> byNo[t.number]=t);
ok(byNo['1'].status === 'done', 'A（全完了）→ done');
ok(byNo['2'].status === 'help', 'B（こまった）→ help');
ok(byNo['3'].status === 'busy', 'C（取組中）→ busy');
ok(byNo['4'].status === 'none', 'D（未着手）→ none');
ok(mon.counts.done===1 && mon.counts.help===1 && mon.counts.busy===1 && mon.counts.none===1, 'カウント集計が一致');
ok(byNo['1'].doneCount===4 && byNo['1'].total===4, 'Aの進度 4/4');

console.log('\n【9】無操作検知（10分）');
// コンテキスト内realmでバックデートDateを生成（GASの単一realmを再現）
const backdated = () => vm.runInContext('new Date(Date.now()-20*60000)', sandbox);
// Cの目標更新時刻を20分前に書き換えて idle を誘発
const goalSheet = ss._sheets['目標'];
const gvals = goalSheet.getDataRange().getValues();
const h = gvals[0]; const uidCol=h.indexOf('user_id'); const upCol=h.indexOf('更新時刻');
for(let i=1;i<gvals.length;i++){ if(gvals[i][uidCol]==='U03'){ goalSheet.getRange(i+1, upCol+1).setValue(backdated()); } }
// Cの進度も20分前に
const progSheet = ss._sheets['進度'];
const pvals = progSheet.getDataRange().getValues(); const ph=pvals[0]; const puid=ph.indexOf('user_id'); const pup=ph.indexOf('更新時刻');
for(let i=1;i<pvals.length;i++){ if(pvals[i][puid]==='U03'){ progSheet.getRange(i+1,pup+1).setValue(backdated()); } }
const mon2 = call('teacher_getMonitor');
const c2 = mon2.tiles.find(t=>t.number==='3');
ok(c2.status === 'idle', 'C（20分無操作）→ idle');
ok(c2.idleMin >= 10, 'idleMin が10分以上（実際: '+c2.idleMin+'）');

console.log('\n【10】児童詳細とフィードバック');
const detail = call('teacher_getStudentDetail', 'U01');
ok(detail.goal.doText.indexOf('白地図')>=0, '詳細に目標が出る');
ok(detail.regulateNames.length === 2, '詳細にRegulate方略名が2件');
call('teacher_sendFeedback', 'U01', 'しくみ図の色分けがいいね！');
ok(sheetRows('フィードバック').length === 1, 'フィードバックが保存された');

console.log('\n【11】振り返りとポートフォリオ');
asUser('a@school.jp');
call('student_saveReflection', { achievement:80, selfEval:'参勤交代を説明できた', attrGood:['やり方（工夫）がよかった'], attrHard:['時間が足りなかった'], mood:'😊', nextPlan:'次は先に時間配分を決める' });
const pf = call('student_getPortfolio');
ok(pf.items.length === 1, 'ポートフォリオに振り返り1件');
ok(pf.items[0].feedback.length === 1, '先生コメントがポートフォリオに反映');
ok(pf.items[0].achievement === 80, '達成度80が記録');

console.log('\n【12】振り返り一覧と共有');
asUser('teacher@school.jp');
const refl = call('teacher_getReflections', null);
ok(refl.rows.length === 4, 'ふりかえり一覧は4名分');
const a = refl.rows.find(r=>r.userId==='U01');
ok(a.hasRefl === true && a.achievement === 80, 'Aは記入済み・達成度80');
const undone = refl.rows.find(r=>r.userId==='U04');
ok(undone.hasRefl === false, 'D（未記入）を把握できる');
call('teacher_toggleShare', 'U01', refl.lessonId, true);
const refl2 = call('teacher_getReflections', null);
ok(refl2.rows.find(r=>r.userId==='U01').shared === true, '「みんなの工夫」への共有が反映');

console.log('\n【13】本時デザインの編集（選択肢の開放トグル）');
call('teacher_setChoice', lessonId, '場所', true);
asUser('c@school.jp');
const stc = call('student_getState');
ok(stc.choices.length === 4, '場所を開放すると児童の選択カテゴリが4つに増える');

console.log('\n【14】①単元の出口の可視化');
asUser('a@school.jp');
const stA = call('student_getState');
ok(!!stA.lesson.unitGoal, '児童に単元目標が渡る');
ok(stA.lesson.outcome.indexOf('新聞') >= 0, '児童に成果物イメージ（出口）が渡る');

console.log('\n【15】②自己効力感の保存・復元');
call('student_saveGoal', '集中して', '白地図＋説明文', ['S01'], 75);
const stEff = call('student_getState');
ok(stEff.my.goal.efficacy === 75, '自己効力感75が保存・復元される');

console.log('\n【16】④確認タイムの記録');
ok(stEff.lesson.checkInterval === 10, '確認タイム間隔10分が児童に渡る');
call('student_saveCheckpoint', 10, '順調', 'いい調子');
call('student_saveCheckpoint', 20, '調整する', '時間がたりない');
const stChk = call('student_getState');
ok(stChk.my.checkpoints.length === 2, '確認タイムが2件記録される');
ok(stChk.my.checkpoints[1].status === '調整する', '2件目の状態が調整する');
asUser('teacher@school.jp');
const detEff = call('teacher_getStudentDetail', 'U01');
ok(detEff.goal.efficacy === 75, '教師詳細に自己効力感が出る');
ok(detEff.checkpoints.length === 2, '教師詳細に確認タイム2件が出る');

console.log('\n【17】③ I/You/We の集計');
// A=ひとりで（【6】で変更済）, B/C/D=学習形態未選択 → I=1, none=3。Cにグループ選択を足す
asUser('c@school.jp'); call('student_saveSelection', '学習形態', 'グループで');
asUser('teacher@school.jp');
const monR = call('teacher_getMonitor');
ok(monR.regulation.I === 1, 'I（ひとり）が1名');
ok(monR.regulation.We === 1, 'We（グループ）が1名');
ok(monR.regulation.none === 2, '学習形態 未選択が2名');

/* =================== 結果 =================== */
console.log('\n========================================');
console.log('  PASS: '+pass+'   FAIL: '+fail);
if(fail){ console.log('  失敗: '+fails.join(' / ')); process.exit(1); }
else console.log('  すべての結合テストに合格しました 🎉');

/**
 * Constants.gs
 * シート名とスキーマ（列見出し）の唯一の定義元。
 * ここを変えると Setup / Repo / 各API の全体に反映される。
 *
 * 【設計方針：単元内自由進度学習】
 * 公開の単位は「本時（1時間）」ではなく「単元」。
 * 子どもは単元の課題プールから、自分のペース・順序で課題を選んで進む。
 * 学習の記録は
 *   - 課題に紐づくもの（進度・選択・方略利用）→ task_id で保持
 *   - その日の計画と振り返り（目標・確認タイム・振り返り）→ 日付で保持
 * に分けている。
 */
var C = {
  APP_NAME: '自己調整学習アプリ',

  // 役割
  ROLE: { TEACHER: 'teacher', STUDENT: 'student' },

  // 単元の状態
  UNIT_STATE: { DRAFT: '準備中', OPEN: '公開中', CLOSED: '終了' },

  // 課題の種別（学習の手引き：必ずやるミッション＋選べる活動＋発展問題）
  TASK_KIND: { MUST: '必須', CHOICE: '選択', ADVANCED: '発展' },

  // 進度の状態（数値で保持）
  PROGRESS: { TODO: 0, DOING: 1, DONE: 2 },

  // 課題ごとの理解度（自己申告）。
  // 評価ではなく、子どもが自分の弱点をつかむための目盛り。
  // 未選択は '' で保持し、1〜4 のときだけ値が入る。
  UNDERSTANDING: [
    { value: 1, label: 'まだわからない', icon: '🌱' },
    { value: 2, label: 'すこしわかった', icon: '🌿' },
    { value: 3, label: 'だいたいわかった', icon: '🌳' },
    { value: 4, label: '人に説明できる', icon: '🌟' }
  ],

  // 手が止まっていると判定するまでの無操作時間（分）
  IDLE_MINUTES: 10,

  // シート名
  SH: {
    USERS:   '名簿',
    STRAT:   '方略マスタ',
    PRESET:  '選択肢マスタ',
    UNIT:    '単元',
    TASK:    '課題',
    RES:     '資料',
    USTRAT:  '単元_推奨方略',
    UCHOICE: '単元_選択肢設定',
    GOAL:    '目標',
    SEL:     '選択',
    PROG:    '進度',
    SUSE:    '方略利用',
    HELP:    '援助要請',
    CHECK:   '確認タイム',
    REFL:    '振り返り',
    FB:      'フィードバック',
    OBS:     '見取りメモ'
  }
};

// 各シートの列見出し（順序が実際の列順になる）
C.HEADERS = {};
C.HEADERS[C.SH.USERS]   = ['user_id', '氏名', '表示名', '出席番号', '役割', 'email'];
C.HEADERS[C.SH.STRAT]   = ['strategy_id', '分類', 'カード名', '説明', 'アイコン', '推奨フェーズ'];
C.HEADERS[C.SH.PRESET]  = ['preset_id', 'カテゴリ', 'ラベル', 'アイコン', '複数選択可'];

// 単元＝学習の手引き（子どもとの契約書）。公開の単位。
C.HEADERS[C.SH.UNIT]    = ['unit_id', '教科', '学年', '単元名', '単元目標', '成果物イメージ',
                           '総時数', '裁量レベル', '確認タイム間隔', '他者参照', '他者参照モード',
                           '状態', '更新時刻'];

// 課題＝学習カード。1時間1枚ではなく、単元の中に並ぶ。種別で必須/選択/発展を分ける。
// 「公開」は段階的公開用（環境は変えないと風景になる／最初に全部を見せない）。
C.HEADERS[C.SH.TASK]    = ['task_id', 'unit_id', '並び', '種別', 'タイトル', '説明', 'めやす分', '公開'];

// 資料は課題に紐づける。task_id が空なら「いつでも使える資料」。
C.HEADERS[C.SH.RES]     = ['resource_id', 'unit_id', 'task_id', 'アイコン', 'タイトル', '補足', '種別', 'URL', '公開'];

// 推奨方略も課題ごと（task_id 空なら単元共通）
C.HEADERS[C.SH.USTRAT]  = ['unit_id', 'task_id', 'strategy_id', '教師の一言'];
C.HEADERS[C.SH.UCHOICE] = ['unit_id', 'カテゴリ', '開放'];

// --- 記録系 ---
// その日の計画（1人1日1件）
C.HEADERS[C.SH.GOAL]    = ['goal_id', 'unit_id', 'user_id', '日付', 'Be', 'Do', 'Regulate', '自己効力感', '作成時刻', '更新時刻'];
// 課題ごとの取り組み方（変更前の値を残して調整の履歴にする）
C.HEADERS[C.SH.SEL]     = ['selection_id', 'unit_id', 'task_id', 'user_id', 'カテゴリ', '選んだ値', '変更前の値', '選択時刻'];
// 課題ごとの進度（1人1課題1件）
// 理解度とメモは同じ粒度（その子×その課題）なのでここに同居させる。
// メモは振り返りではなく、取り組みながら書く気づき・大切なこと・わからなかったこと。
C.HEADERS[C.SH.PROG]    = ['progress_id', 'unit_id', 'task_id', 'user_id', '状態', '理解度', 'メモ', '更新時刻'];
// 課題ごとの方略利用
C.HEADERS[C.SH.SUSE]    = ['use_id', 'unit_id', 'task_id', 'user_id', 'strategy_id', '状態', '更新時刻'];
C.HEADERS[C.SH.HELP]    = ['help_id', 'unit_id', 'user_id', '状態', '更新時刻'];
C.HEADERS[C.SH.CHECK]   = ['check_id', 'unit_id', 'user_id', '日付', '経過分', '状態', 'メモ', '時刻'];
// その日の振り返り（1人1日1件）
C.HEADERS[C.SH.REFL]    = ['reflection_id', 'unit_id', 'user_id', '日付', '達成度', '計画とのズレ', 'ズレの理由',
                           '自己評価', '原因帰属良', '原因帰属難', '教材リクエスト', '気持ち', '次への適用',
                           '共有', '記録時刻', '更新時刻'];
C.HEADERS[C.SH.FB]      = ['feedback_id', 'unit_id', 'from_user_id', 'to_user_id', 'コメント', '既読', '送信時刻'];
// 見取りメモ：見取りは仮説で行う。事実と解釈を分けて書き、あとで同僚と語り合うための記録。
C.HEADERS[C.SH.OBS]     = ['obs_id', 'unit_id', 'user_id', 'teacher_id', '事実', '解釈（仮説）', '時刻'];

// Setup で作る順
C.SHEET_ORDER = [
  C.SH.USERS, C.SH.STRAT, C.SH.PRESET,
  C.SH.UNIT, C.SH.TASK, C.SH.RES, C.SH.USTRAT, C.SH.UCHOICE,
  C.SH.GOAL, C.SH.SEL, C.SH.PROG, C.SH.SUSE, C.SH.HELP, C.SH.CHECK, C.SH.REFL, C.SH.FB, C.SH.OBS
];

// 記録系（授業のやり直しで消せるもの）
C.RECORD_SHEETS = [C.SH.GOAL, C.SH.SEL, C.SH.PROG, C.SH.SUSE, C.SH.HELP, C.SH.CHECK, C.SH.REFL, C.SH.FB, C.SH.OBS];

/**
 * Constants.gs
 * シート名とスキーマ（列見出し）の唯一の定義元。
 * ここを変えると Setup / Repo / 各API の全体に反映される。
 */
var C = {
  APP_NAME: '自己調整学習アプリ',

  // 役割
  ROLE: { TEACHER: 'teacher', STUDENT: 'student' },

  // 本時の状態
  LESSON_STATE: { DRAFT: '下書き', OPEN: '公開中', CLOSED: '終了' },

  // 進度の状態（数値で保持）
  PROGRESS: { TODO: 0, DOING: 1, DONE: 2 },

  // 手が止まっていると判定するまでの無操作時間（分）
  IDLE_MINUTES: 10,

  // マスタのキャッシュ秒数
  CACHE_SEC: 120,

  // シート名
  SH: {
    USERS:   '名簿',
    STRAT:   '方略マスタ',
    PRESET:  '選択肢マスタ',
    UNIT:    '単元',
    LESSON:  '本時',
    LCHOICE: '本時_選択肢設定',
    LSTRAT:  '本時_推奨方略',
    LRES:    '本時_資料',
    GOAL:    '目標',
    SEL:     '選択',
    PROG:    '進度',
    SUSE:    '方略利用',
    HELP:    '援助要請',
    CHECK:   '確認タイム',
    REFL:    '振り返り',
    FB:      'フィードバック'
  }
};

// 各シートの列見出し（順序が実際の列順になる）
C.HEADERS = {};
C.HEADERS[C.SH.USERS]   = ['user_id', '氏名', '表示名', '出席番号', '役割', 'email'];
C.HEADERS[C.SH.STRAT]   = ['strategy_id', '分類', 'カード名', '説明', 'アイコン', '推奨フェーズ'];
C.HEADERS[C.SH.PRESET]  = ['preset_id', 'カテゴリ', 'ラベル', 'アイコン', '複数選択可'];
C.HEADERS[C.SH.UNIT]    = ['unit_id', '教科', '学年', '単元名', '単元目標', '総時数', '状態', '成果物イメージ'];
C.HEADERS[C.SH.LESSON]  = ['lesson_id', 'unit_id', '時数', '本時の目標', '学習課題', 'ゴール', '裁量レベル', '進度チェック項目', '状態', '更新時刻', '確認タイム間隔', '他者参照', '他者参照モード'];
C.HEADERS[C.SH.LCHOICE] = ['lesson_id', 'カテゴリ', '開放'];
C.HEADERS[C.SH.LSTRAT]  = ['lesson_id', 'strategy_id', '教師の一言'];
C.HEADERS[C.SH.LRES]    = ['resource_id', 'lesson_id', 'アイコン', 'タイトル', '補足', '種別', 'URL'];
C.HEADERS[C.SH.GOAL]    = ['goal_id', 'lesson_id', 'user_id', 'Be', 'Do', 'Regulate', '自己効力感', '作成時刻', '更新時刻'];
C.HEADERS[C.SH.SEL]     = ['selection_id', 'lesson_id', 'user_id', 'カテゴリ', '選んだ値', '変更前の値', '選択時刻'];
C.HEADERS[C.SH.PROG]    = ['progress_id', 'lesson_id', 'user_id', '項目index', '項目名', '状態', '更新時刻'];
C.HEADERS[C.SH.SUSE]    = ['use_id', 'lesson_id', 'user_id', 'strategy_id', '状態', '更新時刻'];
C.HEADERS[C.SH.HELP]    = ['help_id', 'lesson_id', 'user_id', '状態', '更新時刻'];
C.HEADERS[C.SH.CHECK]   = ['check_id', 'lesson_id', 'user_id', '経過分', '状態', 'メモ', '時刻'];
C.HEADERS[C.SH.REFL]    = ['reflection_id', 'lesson_id', 'user_id', '達成度', '自己評価', '原因帰属良', '原因帰属難', '気持ち', '次への適用', '共有', '記録時刻', '更新時刻'];
C.HEADERS[C.SH.FB]      = ['feedback_id', 'lesson_id', 'from_user_id', 'to_user_id', 'コメント', '既読', '送信時刻'];

// マスタ／設計系（教師が編集）と記録系（アプリが書き込む）の区別。Setup の並び順にも使う。
C.SHEET_ORDER = [
  C.SH.USERS, C.SH.STRAT, C.SH.PRESET,
  C.SH.UNIT, C.SH.LESSON, C.SH.LCHOICE, C.SH.LSTRAT, C.SH.LRES,
  C.SH.GOAL, C.SH.SEL, C.SH.PROG, C.SH.SUSE, C.SH.HELP, C.SH.CHECK, C.SH.REFL, C.SH.FB
];

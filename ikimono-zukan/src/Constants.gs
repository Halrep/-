/**
 * Constants.gs
 * シート名・列見出し・列挙値の唯一の定義元。
 * ここを変えると Setup / Repo / Safety / Api の全体に反映される。
 */
var C = {
  APP_NAME: 'いきもの図鑑',

  // ---- シート名 ----
  SH: {
    ZUKAN:  '図鑑',
    ALIAS:  '別名索引',
    SAFETY: '要注意リスト',
    LOG:    '検索ログ'
  },

  // ---- 列見出し（この順序でシートが作られる） ----
  COL: {
    ZUKAN: [
      'creature_id', '番号', '標準和名', 'よみ', 'カテゴリ', '概要',
      '生息地_json', '捕まえ方_json', '餌_json', '飼い方_json',
      '危険度', '危険メモ_json', '法規制', '放出禁止', '飼育難易度',
      // 画像ID は Drive に保存できたときだけ入る。
      // 保存できなくても 画像URL があれば画面には出せる
      '画像ID', '画像URL', '画像種別', '画像クレジット', '出典URL',
      '初回登録日時', '閲覧回数', 'status'
    ],
    ALIAS:  ['別名', 'creature_id'],
    SAFETY: ['名前パターン', '危険度', '法規制', '表示メッセージ', '捕獲を隠す', '飼育を隠す', 'メモ'],
    LOG:    ['日時', '入力', 'ヒット種別', 'creature_id', '所要ミリ秒']
  },

  // ---- 列挙値 ----
  // 危険度。danger は「素手で触ってはいけない」
  DANGER: { SAFE: 'safe', CAUTION: 'caution', DANGER: 'danger' },

  // 法規制
  LEGAL: {
    NONE:        'none',
    CONDITIONAL: 'conditional_invasive', // 条件付特定外来生物（飼育可・放出禁止）
    BANNED:      'invasive_banned',      // 特定外来生物（飼育・生きた運搬すべて禁止）
    PROTECTED:   'protected',            // 天然記念物・保護種
    PERMIT:      'permit_required'
  },

  DIFFICULTY: { EASY: 'easy', NORMAL: 'normal', HARD: 'hard', NO: 'not_recommended' },

  // カテゴリ。「みずのいきもの」は海・川・池をまとめる（UIプレビュー制作時の修正点）
  CATEGORY: ['むし', 'さかな', 'かえる・とかげ・へび', 'とり', 'けもの', 'みずのいきもの', 'そのほか'],

  // 図鑑の公開状態。保護者が hidden にすれば即座に非表示になる
  STATUS: { PUBLISHED: 'published', HIDDEN: 'hidden' },

  IMG: { PHOTO: 'photo', AI: 'ai', NONE: 'none' },

  HIT: { CACHE: 'cache', NEW: 'new', NOTFOUND: 'notfound', BLOCKED: 'blocked' },

  // ---- ScriptProperties のキー ----
  PROP: {
    API_KEY:   'GEMINI_API_KEY',
    MODEL:     'GEMINI_MODEL',
    FOLDER_ID: 'IMAGE_FOLDER_ID',
    ALLOW_AI_IMAGE: 'ALLOW_AI_IMAGE' // 'true' のときだけ画像生成にフォールバックする
  },

  // モデルは ScriptProperties で上書きできる。README のセットアップ手順を参照
  DEFAULT_MODEL: 'gemini-flash-latest',

  // 画像は長辺 800px で Drive に保存する。
  // UrlFetchApp の通信量クォータ（100MB/日）を守るため、外部URLへのホットリンクはしない
  IMAGE_MAX_PX: 800,

  // 1回の検索でシートを読む上限（図鑑が育っても遅くならないようにする）
  CACHE_SEC: 300
};

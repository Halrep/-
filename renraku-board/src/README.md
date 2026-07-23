# 職員連絡ボード — GAS プロジェクト（`src/`）

Google スプレッドシートに紐づくコンテナバインド型の Apps Script プロジェクトです。

## ファイル

| ファイル | 役割 |
|---|---|
| `Code.gs` | バックエンド（シート操作・集計・確認記録・督促メール・セットアップ） |
| `Index.html` | ウェブアプリのUI（1画面SPA。CSS/JSインライン） |
| `appsscript.json` | マニフェスト（タイムゾーン・ウェブアプリ設定・OAuthスコープ） |

## セットアップ手順

### A. 手動で貼り付ける場合（clasp 不要）

1. 運用用の Google スプレッドシートを新規作成。
2. **拡張機能 → Apps Script** を開く。
3. `Code.gs` の中身を `コード.gs` に貼り付け。
4. **＋ → HTML** で `Index` を作成し、`Index.html` の中身を貼り付け（拡張子 `.html` は不要、ファイル名は `Index`）。
5. プロジェクトの設定で「`appsscript.json` マニフェストファイルを表示」をON→ 中身を貼り付け。
6. エディタ上部の関数を `setup` にして **実行**（初回は権限承認）。→ 4シートとサンプルが生成される。
7. `職員マスタ` シートに実際の職員（氏名・メール・分掌・表示順・在職=TRUE）を入力。
8. **デプロイ → 新しいデプロイ → ウェブアプリ**
   - 次のユーザーとして実行: **アクセスしているユーザー**
   - アクセスできるユーザー: **組織内の全員**
9. エディタで `installTriggers` を1回 **実行** → 毎朝7:30の督促メールが有効化。
10. 発行URLを職員に共有（ブックマーク推奨）。

### B. clasp で既存プロジェクトへ push する場合（スクリプトIDを使う）

> **認証はお手元のPCで行う必要があります。** clasp はあなたのGoogleアカウントでの
> `clasp login`（ブラウザ認証）が前提です。スクリプトIDは「送り先」を指すだけで、
> 認証の代わりにはなりません。

**スクリプトIDの調べ方**：対象スプレッドシート → 拡張機能 → Apps Script →
プロジェクトの設定（⚙️）→「スクリプト ID」をコピー。
（URL `https://script.google.com/…/projects/★★★/edit` の `★★★` 部分でも可）

```bash
# 1. clasp を用意（初回のみ）
npm i -g @google/clasp
clasp login                      # ブラウザで自分のアカウントを承認

# 2. このリポジトリの src/ に移動し、送り先を設定
cd renraku-board/src
cp .clasp.json.example .clasp.json
#   .clasp.json を開き "scriptId" に控えたスクリプトIDを貼る

# 3. Apps Script API を有効化（未設定なら）
#   https://script.google.com/home/usersettings で「Google Apps Script API」をON

# 4. 送信（Code.gs / Index.html / appsscript.json のみ push される）
clasp push
```

その後、Apps Scriptエディタで `setup` を実行 →『職員マスタ』入力 → デプロイ →
`installTriggers` 実行、という **A の 6〜10 と同じ流れ**で運用開始できます。

#### 既存のスプレッドシート（旧・日付シートが入ったファイル）へ送るときの注意

- `setup()` は **不足しているシートを追加するだけ**で、既存の25枚の会議シートは
  消しません（`ensureSheet_` は既存シートに触れず、空のときだけヘッダーを入れる）。
- `clasp push` は **同名のスクリプトファイルを上書き**します。その既存プロジェクトに
  別のコードがある場合は、push 前に控えを取ってください（このプロジェクトは
  `Code.gs` / `Index.html` / `appsscript.json` の3つだけを送ります）。
- 旧・日付シートの中身を新しい `連絡事項` シートへ自動で取り込みたい場合は、
  移行スクリプト（会議ごとに1レコード化）を別途用意できます。

## 関数一覧

| 関数 | 実行タイミング | 役割 |
|---|---|---|
| `setup()` | 初回手動 | シート・ヘッダー・サンプル生成 |
| `installTriggers()` | 初回手動 | 毎朝の督促メールトリガー登録 |
| `doGet()` | 自動 | ウェブアプリ配信 |
| `getInitialData()` | UI | ボード初期表示 |
| `recordCheck(id, done)` | UI | 確認・対応の記録／取消 |
| `submitItem(payload)` | UI | 連絡の起票 |
| `getMeetingAgenda(id)` | UI | 会議アジェンダ取得 |
| `getUncheckedNames(id)` | UI | 未対応者名の取得 |
| `sendReminders()` | トリガー | 期限超過の未対応者へメール |

## 補足・カスタマイズ

- **督促の時刻**: `installTriggers()` の `atHour(7).nearMinute(30)` を変更。
- **督促の条件**: `sendReminders()` は「掲載中・要対応・期限が当日以前・未対応」の職員を対象。期限前日から送りたい等は同関数の日付判定を調整。
- **担任の判定**: `職員マスタ` の `分掌` に「担任」を含む職員を対象区分「担任」の対象とみなす。
- **OAuthスコープ**: `spreadsheets.currentonly` はこのスプレッドシートのみアクセス可能な最小権限。他ファイルを参照する拡張時は広げる。
- **既存データの移行**: 旧・日付シート群から `連絡事項` シートへ移す移行スクリプトは別途用意可能（会議ごとに1レコード化）。

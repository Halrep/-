# note.com への投稿について

## 公式APIが存在しない点について

note.com は本ドキュメント作成時点（2026年）で、外部から記事を投稿するための
**公式パブリックAPI** を提供していません。そのため本プロジェクトでは、実際に
ログインしたブラウザを [Playwright](https://playwright.dev/) で自動操作し、
記事作成画面から下書き保存・公開を行う方式（`src/note_client.py` の
`NotePublisher`）を採用しています。

この方式には以下の制約があります。

- note.com のUI（HTML構造・CSSクラス名等）が変更されると動作しなくなる可能性があります。
  `NotePublisher._create_note` 内のセレクタ（`textarea[placeholder="記事タイトル"]` 等）を
  実際の画面に合わせて更新してください。
- 二段階認証やCAPTCHAが有効なアカウントでは自動ログインに失敗します。その場合は
  - 二段階認証を無効化する（セキュリティ上非推奨）
  - あるいはログイン済みのセッションCookieを別途取得し、Playwrightの
    `browser_context.add_cookies()` 等で注入する方式に切り替える
  といった対応が必要です。
- note.com の利用規約を確認し、自動投稿が許容される用途・範囲で利用してください。
  規約に反する自動化（スパム的投稿等）は行わないこと。

## 安全のためのデフォルト設計

事故防止のため、本プロジェクトは以下をデフォルト挙動としています。

1. `PublisherAgent(dry_run=True)` が既定値。この場合 note.com への通信自体を行わず、
   生成した記事をローカルの `output/` ディレクトリにMarkdownとして保存するだけです。
2. `.env` に `NOTE_EMAIL` / `NOTE_PASSWORD` が設定されていない限り、投稿処理は
   スキップされます。
3. note.com へ実際に送信する場合も、`NotePublisher.publish(article, publish=False)`
   （既定値）では**下書き保存まで**しか行いません。一般公開まで自動化する場合は
   `scripts/run_pipeline.py --publish` を明示的に指定する必要があります。

**推奨運用**: `--publish` を使わず下書き保存までを自動化し、実際の公開は
生成された下書きを人間が確認してからnote.com上で行う、という運用を推奨します。
ニュース記事の要約やSNS投稿の引用には誤りや文脈の欠落が起こり得るため、
完全自動公開は内容の正確性・著作権の観点でリスクがあります。

## セットアップ

```bash
pip install -r requirements-dev.txt
playwright install chromium
cp .env.example .env
# .env に NOTE_EMAIL / NOTE_PASSWORD を設定
```

## 将来的な代替手段

note.com が公式APIを提供した場合、または非公式API（reverse engineeringされた
JSON API）を利用する場合は、`NotePublisher` と同じインターフェース
（`publish(article, publish: bool) -> str`）を持つ別クラスを実装し、
`scripts/run_pipeline.py` の生成箇所を差し替えるだけで移行できます。

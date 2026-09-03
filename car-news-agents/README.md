# car-news-agents

自動車関連のニュース・SNS上の反応を自動で収集・分析し、note.com向けのまとめ記事を
生成（および投稿）するマルチエージェントシステムです。

情報収集・分析・執筆・編集・投稿の各「部門」を独立したエージェントとして実装し、
`Orchestrator` が協働させることで、ニュース収集からnote.com投稿までの一連の流れを
自動化します。詳細な設計は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を、
note.com連携の詳細・注意点は [`docs/NOTE_INTEGRATION.md`](docs/NOTE_INTEGRATION.md)
を参照してください。

## 部門構成

| 部門 | 役割 |
|---|---|
| 情報収集（News） | RSSフィードから自動車関連ニュースを収集（価格.com掲示板等の未確認情報源も区別して扱える） |
| 情報収集（SNS） | X(Twitter) / YouTubeコメント / 5ch でのSNS上の反応を収集（複数プロバイダを組み合わせ可） |
| 分析 | ニュースとSNS反応を突き合わせ、記事化するトピックに整理・傾向判定 |
| 執筆 | LLMでnote.com向け記事（Markdown）を執筆 |
| 編集・校正 | 文字数/NGワードチェック、出典整理、LLMによる校正 |
| 投稿 | ローカル保存、および設定に応じてnote.comへ下書き保存/公開 |

## セットアップ

```bash
cd car-news-agents
python3 -m venv .venv && source .venv/bin/activate   # 任意（推奨）
pip install -r requirements-dev.txt
playwright install chromium   # note.comへの自動投稿を使う場合のみ

cp .env.example .env
cp config/config.example.yaml config/config.yaml
# .env と config/config.yaml を編集
```

`.env` に設定する環境変数:

| 変数 | 用途 | 未設定時の挙動 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 分析・執筆・校正でのLLM呼び出し | 分析は簡易要約に、執筆/校正はエラーになるため設定必須 |
| `X_BEARER_TOKEN` | X (Twitter) API v2でのSNS収集（有料プラン必要） | Xからの収集をスキップ |
| `YOUTUBE_API_KEY` | YouTube Data API v3でのコメント収集（無料枠あり） | YouTubeからの収集をスキップ |
| `NOTE_EMAIL` / `NOTE_PASSWORD` | note.comへのログイン | note.comへの投稿をスキップし、ローカル保存のみ行う |

`config/config.yaml` の `sns.five_ch_threads` に5chスレッドのURLを追加すると、
そのスレッドの投稿も収集対象になります（APIキー不要、ただし公式APIが無いため
自己責任での利用となります）。上記のいずれも未設定の場合、SNS収集はスキップされ
ニュースのみで記事が生成されます。

## 実行

```bash
# ローカル保存まで（note.comへは投稿しない・既定の安全な動作）
python scripts/run_pipeline.py

# note.comへ下書き保存まで行う（NOTE_EMAIL/NOTE_PASSWORD が必要）
# config/config.yaml の publish.dry_run を false にした上で実行
python scripts/run_pipeline.py

# note.comで一般公開まで行う（内容を人間が確認したうえでの利用を強く推奨）
python scripts/run_pipeline.py --publish
```

定期実行したい場合は、上記コマンドをcronやGitHub Actionsのscheduleトリガーから
呼び出してください（ワークフローファイルは本リポジトリには含めていません。
必要であれば追加します）。

## テスト

```bash
pip install -r requirements-dev.txt
pytest car-news-agents/tests
```

ネットワーク・LLM呼び出しを伴わない範囲（分析のクラスタリング、編集の出典整理、
投稿のドライラン保存）を対象にしたユニットテストです。

## 注意事項

- note.com は投稿用の公式APIを提供していないため、ブラウザ自動操作
  （Playwright）による非公式な方法を採用しています。UI変更に弱く、利用規約の
  範囲内での利用が前提です。詳細は [`docs/NOTE_INTEGRATION.md`](docs/NOTE_INTEGRATION.md)
  を参照してください。
- 既定では note.com への投稿は行わずローカル保存のみ、実際に送信する場合も
  下書き保存までに留まります。一般公開（`--publish`）は内容を人間が確認してから
  行うことを推奨します。
- ニュース記事やSNS投稿を引用する際は、要約・出典明記を徹底し、著作権・利用規約に
  配慮してください。

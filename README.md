# いきもの図鑑アプリ

子供が生き物の名前を入れて調べると、生息地・捕まえ方・餌・飼い方が図鑑カードになって出てくるアプリです。調べた生き物は「みんなの図鑑」に蓄積されます。

- **技術構成**: Gemini API（構造化出力＋検索グラウンディング）＋ Google スプレッドシート ＋ Google Apps Script
- **構想書**: [ikimono-zukan/CONCEPT.md](ikimono-zukan/CONCEPT.md) — スキーマ設計・安全設計・画面構成・開発ロードマップ
- **セットアップ**: [ikimono-zukan/src/README.md](ikimono-zukan/src/README.md) — APIキー取得からデプロイまで
- **UIプレビュー**: [ikimono-zukan/mockups/ui-prototype.html](ikimono-zukan/mockups/ui-prototype.html) — Chromebook 横画面
- **状況**: フェーズ2（MVP実装）完了

「捕まえ方・飼い方」を子供に見せるため、AIの出力を人手の要注意リストが無条件に上書きする安全設計を三層で実装しています。危険な生き物や特定外来生物では、警告を添えるのではなく**該当のカードそのものを表示しません**。

## このブランチについて

このブランチ（`claude/ikimono-zukan-app`）は、同リポジトリの `claude/creature-encyclopedia-app-vbdv26` から、いきもの図鑑アプリ（`ikimono-zukan/` 以下）だけを取り出したものです。
別アプリ（自己調整学習支援アプリ）のファイルはこのブランチには含まれていません。

GAS への配信手順・clasp の設定は [ikimono-zukan/src/README.md](ikimono-zukan/src/README.md) を参照してください。

"""パイプラインの動作を確認するためのデモスクリプト。

このサンドボックス環境では実際のRSSサイトへのアクセスやLLM APIキーの設定が
できないため、実データの代わりにサンプルのニュース・SNS反応を使い、
AnalystAgent → WriterAgent → EditorAgent → PublisherAgent という実際のコード
パスをそのまま通して記事を生成する。

WriterAgent/AnalystAgent/EditorAgentが本来LLMに投げるプロンプトは
`_FakeLLMClient` が受け取り、あらかじめ用意したサンプル記事文を返す
（実際のLLM呼び出しは行わない）。生成される記事はあくまでサンプルデータに
基づくデモであり、実在のニュースではない。

使用方法:
    python scripts/demo_sample_article.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.agents.analyst import AnalystAgent
from src.agents.editor import EditorAgent
from src.agents.publisher import PublisherAgent
from src.agents.writer import WriterAgent
from src.models import NewsItem, SNSReaction
from src.utils.logging_config import configure_logging

# --- サンプル入力データ（実在のニュースではない） -------------------------

NEWS_ITEMS = [
    NewsItem(
        title="新型EV「ステラEV」をA社が発表 航続距離500kmに",
        url="https://example.com/news/1",
        source="くるまのニュース（サンプル）",
        published_at=datetime.now(timezone.utc),
        summary="A社は新型EV「ステラEV」を発表。1回の充電での航続距離は500kmとした。",
    ),
    NewsItem(
        title="新型EV「ステラEV」の価格は400万円から 予約受付を開始",
        url="https://example.com/news/2",
        source="MOTA（サンプル）",
        published_at=datetime.now(timezone.utc),
        summary="価格は税込400万円からで、上位グレードは500万円台になる見込み。",
    ),
    NewsItem(
        title="新型EV「ステラEV」の上位グレードにディーラー情報",
        url="https://example.com/news/3",
        source="価格.com 口コミ掲示板（サンプル）",
        published_at=datetime.now(timezone.utc),
        summary="ディーラー筋の情報として、上位グレードに追加の運転支援機能が搭載されるとの投稿があった。",
        is_unofficial=True,
    ),
]

SNS_REACTIONS = [
    SNSReaction(
        platform="YouTube",
        author="視聴者A（サンプル）",
        text="ステラEVかっこいい、次の愛車候補です",
        url="https://example.com/sns/1",
        posted_at=datetime.now(timezone.utc),
        likes=42,
    ),
    SNSReaction(
        platform="X",
        author="ユーザーB（サンプル）",
        text="400万円からは思ったより頑張った価格設定だと思う",
        url="https://example.com/sns/2",
        posted_at=datetime.now(timezone.utc),
        likes=18,
    ),
    SNSReaction(
        platform="5ch",
        author="名無しさん（サンプル）",
        text="航続距離500kmは魅力的だけど実際の電費はどうなんだろう",
        url="https://example.com/sns/3",
        posted_at=datetime.now(timezone.utc),
    ),
]

# WriterAgentのプロンプト制約（です・ます調、未確認情報の断定回避、出典明記等）に
# 沿って作成したサンプル記事本文。実際の運用ではここをLLMが生成する。
_SAMPLE_ARTICLE_BODY = """\
## A社の新型EV「ステラEV」がついに発表

A社は新型EV「ステラEV」を発表しました。くるまのニュースの報道によれば、1回の\
充電での航続距離は500kmに達するとのことで、日常使いから長距離ドライブまで\
幅広く対応できるモデルとして注目を集めています。

## 価格は400万円から、予約受付もスタート

MOTAの報道によると、価格は税込400万円からと発表されており、上位グレードは\
500万円台になる見込みです。すでに予約受付も始まっており、EV市場における\
A社の本気度がうかがえます。

## 上位グレードの追加機能は「未確認情報」に注意

なお、上位グレードに追加の運転支援機能が搭載されるという情報が、価格.comの\
口コミ掲示板にディーラー筋の情報として投稿されています。ただしこれはメーカーの\
正式発表ではなく、あくまで未確認情報である点にご注意ください。正式な仕様は\
今後の公式発表を待つ必要があります。

## SNSの反応

SNS上ではおおむね好意的な反応が目立ちます。YouTubeのコメント欄では「ステラEV\
かっこいい、次の愛車候補です」といった声が上がっているほか、Xでは「400万円\
からは思ったより頑張った価格設定だと思う」というコメントも見られました。一方\
5chでは「航続距離500kmは魅力的だけど実際の電費はどうなんだろう」と、\
カタログスペックと実燃費（電費）の差を気にする声も上がっており、期待と\
実用面での関心が入り混じった反応となっています。
"""


class _FakeLLMClient:
    """実際のLLM呼び出しの代わりに、用意したサンプル記事文を返すスタブ。"""

    available = True

    def complete(self, system: str, prompt: str, max_tokens: int = 2000) -> str:
        return _SAMPLE_ARTICLE_BODY


def main() -> None:
    configure_logging()

    analyst = AnalystAgent(llm_client=None, min_news_per_topic=1, max_topics=5)
    topics = analyst.run(NEWS_ITEMS, SNS_REACTIONS)
    assert topics, "サンプルデータからトピックが生成されませんでした"
    topic = topics[0]

    writer = WriterAgent(llm_client=_FakeLLMClient())
    draft = writer.run(topic)

    editor = EditorAgent(llm_client=None)
    article = editor.run(draft)

    output_dir = os.path.join(os.path.dirname(__file__), "..", "output", "demo")
    publisher = PublisherAgent(dry_run=True, output_dir=output_dir)
    publisher.run(article)

    print("\n" + "=" * 60)
    print(f"タイトル: {article.title}")
    print(f"タグ: {', '.join(article.tags)}")
    print("=" * 60)
    print(article.body_markdown)


if __name__ == "__main__":
    main()

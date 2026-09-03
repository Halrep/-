"""ネットワーク・LLM呼び出しを伴わない範囲でのユニットテスト。

実行方法:
    pip install -r requirements-dev.txt
    pytest car-news-agents/tests
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.agents.analyst import AnalystAgent
from src.agents.editor import EditorAgent
from src.agents.news_collector import NewsCollectorAgent
from src.agents.publisher import PublisherAgent
from src.agents.writer import WriterAgent
from src.models import Article, NewsItem, SNSReaction, Topic

_MINIMAL_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>テストメディア</title>
<item>
  <title>テスト記事タイトル</title>
  <link>https://example.com/test-article</link>
  <description>概要</description>
</item>
</channel></rss>
"""


class _FakeLLMClient:
    """LLMClientの代わりにプロンプトを記録するだけのテスト用スタブ。"""

    available = True

    def __init__(self):
        self.last_prompt = None

    def complete(self, system, prompt, max_tokens=2000):
        self.last_prompt = prompt
        return "## 見出し\n本文です。\n\n## SNSの反応\nおおむね好評です。"


def _make_news(title: str, source: str = "テスト媒体") -> NewsItem:
    return NewsItem(
        title=title,
        url=f"https://example.com/{title}",
        source=source,
        published_at=datetime.now(timezone.utc),
    )


def test_analyst_clusters_and_ranks_topics():
    news = [
        _make_news("新型EV発表 詳細レビュー"),
        _make_news("新型EV発表 価格情報"),
        _make_news("軽自動車 新モデル登場"),
    ]
    sns = [
        SNSReaction(
            platform="X",
            author="user1",
            text="新型EV発表 かっこいい",
            url="https://x.com/1",
            posted_at=datetime.now(timezone.utc),
        )
    ]

    analyst = AnalystAgent(llm_client=None, min_news_per_topic=1, max_topics=5)
    topics = analyst.run(news, sns)

    assert len(topics) >= 1
    assert topics[0].news_items
    # ニュース2件+SNS1件が紐づくトピックが最上位に来ること
    assert len(topics[0].news_items) + len(topics[0].sns_reactions) >= 2


def test_analyst_respects_min_news_per_topic():
    news = [_make_news("軽自動車 新モデル登場")]

    analyst = AnalystAgent(llm_client=None, min_news_per_topic=2, max_topics=5)
    topics = analyst.run(news, [])

    assert topics == []


def test_editor_adds_sources_section_when_missing():
    topic = Topic(title="テスト", keywords=["テスト"])
    article = Article(
        title="テスト記事",
        body_markdown="本文のみ。",
        topic=topic,
        sources=["https://example.com/a"],
    )

    editor = EditorAgent(llm_client=None)
    result = editor.run(article)

    assert "## 出典" in result.body_markdown
    assert "https://example.com/a" in result.body_markdown


def test_editor_does_not_duplicate_sources_section():
    topic = Topic(title="テスト", keywords=["テスト"])
    article = Article(
        title="テスト記事",
        body_markdown="本文\n\n## 出典\n- https://example.com/a",
        topic=topic,
        sources=["https://example.com/a"],
    )

    editor = EditorAgent(llm_client=None)
    result = editor.run(article)

    assert result.body_markdown.count("## 出典") == 1


def test_publisher_dry_run_saves_locally(tmp_path):
    topic = Topic(title="テスト", keywords=["テスト"])
    article = Article(title="テスト記事", body_markdown="本文", topic=topic)

    publisher = PublisherAgent(dry_run=True, output_dir=str(tmp_path))
    result = publisher.run(article)

    assert result is None
    saved_files = list(tmp_path.glob("*.md"))
    assert len(saved_files) == 1
    assert "テスト記事" in saved_files[0].read_text(encoding="utf-8")


def test_publisher_skips_note_when_publisher_not_configured(tmp_path):
    topic = Topic(title="テスト", keywords=["テスト"])
    article = Article(title="テスト記事", body_markdown="本文", topic=topic)

    publisher = PublisherAgent(note_publisher=None, dry_run=False, output_dir=str(tmp_path))
    result = publisher.run(article)

    assert result is None


def test_news_collector_flags_unofficial_feed_items():
    # ネットワークを使わず、feedparserにRSS本文を直接渡してパースさせる。
    collector = NewsCollectorAgent(feed_urls=[], unofficial_feed_urls=[_MINIMAL_RSS])

    items = collector.run()

    assert len(items) == 1
    assert items[0].title == "テスト記事タイトル"
    assert items[0].is_unofficial is True


def test_news_collector_official_feed_items_are_not_flagged():
    collector = NewsCollectorAgent(feed_urls=[_MINIMAL_RSS])

    items = collector.run()

    assert len(items) == 1
    assert items[0].is_unofficial is False


def test_writer_hedges_unofficial_news_in_prompt():
    topic = Topic(
        title="新型モデルの噂",
        news_items=[
            NewsItem(
                title="ディーラー情報",
                url="https://example.com/a",
                source="価格.com 口コミ掲示板",
                is_unofficial=True,
            )
        ],
        summary="新型モデルの噂について",
    )
    llm_client = _FakeLLMClient()

    WriterAgent(llm_client=llm_client).run(topic)

    assert "未確認情報" in llm_client.last_prompt
    assert "（未確認情報）" in llm_client.last_prompt


def test_writer_does_not_add_hedge_for_official_news_only():
    topic = Topic(
        title="新型モデル発表",
        news_items=[
            NewsItem(title="公式発表", url="https://example.com/b", source="Response")
        ],
        summary="新型モデルが正式発表されました",
    )
    llm_client = _FakeLLMClient()

    WriterAgent(llm_client=llm_client).run(topic)

    assert "未確認情報の印がついた" not in llm_client.last_prompt

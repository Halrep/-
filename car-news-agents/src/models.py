"""パイプライン全体で共有するデータモデル。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List


@dataclass
class NewsItem:
    """ニュース収集部門が集める1件のニュース記事。"""

    title: str
    url: str
    source: str
    published_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    summary: str = ""
    body: str = ""


@dataclass
class SNSReaction:
    """SNS収集部門が集める1件のSNS投稿。"""

    platform: str
    author: str
    text: str
    url: str
    posted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    likes: int = 0
    reposts: int = 0


@dataclass
class Topic:
    """分析部門が整理した、1記事分になる話題のまとまり。"""

    title: str
    news_items: List[NewsItem] = field(default_factory=list)
    sns_reactions: List[SNSReaction] = field(default_factory=list)
    keywords: List[str] = field(default_factory=list)
    summary: str = ""
    sentiment: str = "unknown"  # positive / negative / mixed / neutral / unknown


@dataclass
class Article:
    """執筆部門・編集部門を経て完成した記事。"""

    title: str
    body_markdown: str
    topic: Topic
    tags: List[str] = field(default_factory=list)
    sources: List[str] = field(default_factory=list)

"""情報収集部門: 自動車関連ニュースをRSSフィードから収集するエージェント。"""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Sequence

from ..models import NewsItem
from .base import BaseAgent


class NewsCollectorAgent(BaseAgent):
    name = "news_collector"

    def __init__(
        self,
        feed_urls: Sequence[str],
        lookback_hours: int = 24,
        logger=None,
    ):
        super().__init__(logger)
        self.feed_urls = list(feed_urls)
        self.lookback_hours = lookback_hours

    def run(self) -> List[NewsItem]:
        import feedparser  # 遅延import: このエージェントを使わない場合の依存を減らす

        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.lookback_hours)
        items: List[NewsItem] = []
        seen_urls = set()

        for feed_url in self.feed_urls:
            try:
                feed = feedparser.parse(feed_url)
            except Exception as exc:  # フィード取得失敗は1件のエラーとして扱い処理継続
                self.logger.warning("フィード取得に失敗しました: %s (%s)", feed_url, exc)
                continue

            source_name = getattr(feed.feed, "title", feed_url) if hasattr(feed, "feed") else feed_url

            for entry in feed.entries:
                link = entry.get("link")
                if not link or link in seen_urls:
                    continue

                published = self._parse_date(entry)
                if published and published < cutoff:
                    continue

                items.append(
                    NewsItem(
                        title=entry.get("title", "(無題)"),
                        url=link,
                        source=source_name,
                        published_at=published or datetime.now(timezone.utc),
                        summary=entry.get("summary", ""),
                    )
                )
                seen_urls.add(link)

        self.logger.info("収集したニュース件数: %d", len(items))
        return items

    @staticmethod
    def _parse_date(entry) -> Optional[datetime]:
        for key in ("published_parsed", "updated_parsed"):
            time_struct = entry.get(key)
            if time_struct:
                return datetime.fromtimestamp(calendar.timegm(time_struct), tz=timezone.utc)
        return None

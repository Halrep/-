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
        unofficial_feed_urls: Sequence[str] = (),
        logger=None,
    ):
        super().__init__(logger)
        self.feed_urls = list(feed_urls)
        # 価格.comの口コミ掲示板等、メーカー公式発表前の未確認情報を含みうる
        # フィード。ここに含めたURL由来の記事は NewsItem.is_unofficial=True
        # となり、WriterAgentが断定表現を避けて記事化する。
        self.unofficial_feed_urls = set(unofficial_feed_urls)
        self.lookback_hours = lookback_hours

    def run(self) -> List[NewsItem]:
        import feedparser  # 遅延import: このエージェントを使わない場合の依存を減らす

        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.lookback_hours)
        items: List[NewsItem] = []
        seen_urls = set()

        for feed_url in [*self.feed_urls, *self.unofficial_feed_urls]:
            try:
                feed = feedparser.parse(feed_url)
            except Exception as exc:  # フィード取得失敗は1件のエラーとして扱い処理継続
                self.logger.warning("フィード取得に失敗しました: %s (%s)", feed_url, exc)
                continue

            if feed.get("bozo"):
                # URLが誤っている/RSS形式でない等の場合、feedparserは例外を投げず
                # bozo=1 と空のentriesを返すことが多いため、ここで明示的に警告する。
                self.logger.warning(
                    "フィードの解析に問題があります（URLが正しくない可能性）: %s (%s)",
                    feed_url,
                    feed.get("bozo_exception"),
                )
                if not feed.entries:
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
                        is_unofficial=feed_url in self.unofficial_feed_urls,
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

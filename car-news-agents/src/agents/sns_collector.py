"""SNS反応収集部門: X(Twitter)等での自動車関連の反応を収集するエージェント。

X (Twitter) の公式検索APIは有料プランが必要なため、`SNSProvider` という
差し替え可能なインターフェースにしている。API契約が無い場合は
`NullSNSProvider` が空のリストを返すため、パイプライン全体は動作を継続できる。
将来的に他プラットフォーム（Instagram, YouTubeコメント等）を追加する場合も
同じインターフェースで実装すればよい。
"""
from __future__ import annotations

from typing import Iterable, List, Protocol, Sequence

from ..models import SNSReaction
from .base import BaseAgent


class SNSProvider(Protocol):
    def search(self, query: str, max_results: int) -> Iterable[SNSReaction]:
        ...


class NullSNSProvider:
    """SNS APIの契約が無い場合のデフォルト実装。常に空の結果を返す。"""

    def search(self, query: str, max_results: int) -> Iterable[SNSReaction]:
        return []


class XApiProvider:
    """X (Twitter) API v2 の recent search エンドポイントを利用するプロバイダ。

    有料のAPIアクセス（Basic以上）とBearer Tokenが必要。
    """

    BASE_URL = "https://api.x.com/2/tweets/search/recent"

    def __init__(self, bearer_token: str):
        self.bearer_token = bearer_token

    def search(self, query: str, max_results: int = 30) -> Iterable[SNSReaction]:
        import requests

        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        params = {
            "query": f"{query} -is:retweet lang:ja",
            "max_results": min(max(max_results, 10), 100),
            "tweet.fields": "created_at,public_metrics,author_id",
        }
        response = requests.get(self.BASE_URL, headers=headers, params=params, timeout=15)
        response.raise_for_status()
        payload = response.json().get("data", [])

        reactions = []
        for tweet in payload:
            metrics = tweet.get("public_metrics", {})
            reactions.append(
                SNSReaction(
                    platform="X",
                    author=tweet.get("author_id", ""),
                    text=tweet.get("text", ""),
                    url=f"https://x.com/i/web/status/{tweet.get('id', '')}",
                    posted_at=tweet.get("created_at"),
                    likes=metrics.get("like_count", 0),
                    reposts=metrics.get("retweet_count", 0),
                )
            )
        return reactions


class SNSCollectorAgent(BaseAgent):
    name = "sns_collector"

    def __init__(
        self,
        provider: SNSProvider,
        queries: Sequence[str],
        max_results_per_query: int = 30,
        logger=None,
    ):
        super().__init__(logger)
        self.provider = provider
        self.queries = list(queries)
        self.max_results_per_query = max_results_per_query

    def run(self) -> List[SNSReaction]:
        reactions: List[SNSReaction] = []
        for query in self.queries:
            try:
                results = list(self.provider.search(query, self.max_results_per_query))
            except Exception as exc:
                self.logger.warning("SNS検索に失敗しました query=%s: %s", query, exc)
                continue
            reactions.extend(results)

        self.logger.info("収集したSNS投稿件数: %d", len(reactions))
        return reactions

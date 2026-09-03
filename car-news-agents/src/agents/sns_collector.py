"""SNS反応収集部門: X(Twitter)・YouTube・5ch等での自動車関連の反応を収集するエージェント。

X (Twitter) の公式検索APIは有料プランが必要なため、`SNSProvider` という
差し替え可能なインターフェースにしている。API契約が無い場合は
`NullSNSProvider` が空のリストを返すため、パイプライン全体は動作を継続できる。
`CompositeSNSProvider` で複数のプロバイダ（例: YouTube + 5ch）を組み合わせて
使うこともできる。
"""
from __future__ import annotations

import html as html_module
import re
from typing import Iterable, List, Optional, Protocol, Sequence

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


class YouTubeCommentsProvider:
    """YouTube Data API v3（公式・無料枠あり）で自動車系動画のコメントを取得するプロバイダ。

    Google Cloud ConsoleでAPIキーを発行するだけで利用でき（OAuth不要）、
    X APIと違い無料枠内で運用しやすい。ただし1日あたりのクォータ上限があるため、
    `max_videos_per_query` で検索対象動画数を絞っている。
    """

    SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
    COMMENTS_URL = "https://www.googleapis.com/youtube/v3/commentThreads"

    def __init__(self, api_key: str, max_videos_per_query: int = 3):
        self.api_key = api_key
        self.max_videos_per_query = max_videos_per_query

    def search(self, query: str, max_results: int = 30) -> Iterable[SNSReaction]:
        video_ids = self._search_videos(query)
        if not video_ids:
            return []

        per_video_limit = max(max_results // len(video_ids), 1)
        reactions: List[SNSReaction] = []
        for video_id in video_ids:
            reactions.extend(self._fetch_comments(video_id, per_video_limit))
            if len(reactions) >= max_results:
                break
        return reactions[:max_results]

    def _search_videos(self, query: str) -> List[str]:
        import requests

        params = {
            "key": self.api_key,
            "part": "id",
            "q": query,
            "type": "video",
            "order": "date",
            "relevanceLanguage": "ja",
            "maxResults": self.max_videos_per_query,
        }
        response = requests.get(self.SEARCH_URL, params=params, timeout=15)
        response.raise_for_status()
        return [item["id"]["videoId"] for item in response.json().get("items", [])]

    def _fetch_comments(self, video_id: str, max_results: int) -> List[SNSReaction]:
        import requests

        params = {
            "key": self.api_key,
            "part": "snippet",
            "videoId": video_id,
            "order": "relevance",
            "maxResults": max(min(max_results, 100), 1),
            "textFormat": "plainText",
        }
        try:
            response = requests.get(self.COMMENTS_URL, params=params, timeout=15)
            response.raise_for_status()
        except Exception:
            # コメントが無効化された動画等では失敗しうるため、その動画はスキップする
            return []

        reactions = []
        for item in response.json().get("items", []):
            top_comment = item["snippet"]["topLevelComment"]
            snippet = top_comment["snippet"]
            reactions.append(
                SNSReaction(
                    platform="YouTube",
                    author=snippet.get("authorDisplayName", ""),
                    text=snippet.get("textDisplay", ""),
                    url=f"https://www.youtube.com/watch?v={video_id}&lc={top_comment.get('id', '')}",
                    posted_at=snippet.get("publishedAt"),
                    likes=snippet.get("likeCount", 0),
                )
            )
        return reactions


class FiveChProvider:
    """5ch（旧2ch）の特定スレッドから投稿を取得するプロバイダ。

    5chには話題を横断検索できる公式APIが無いため、追跡したいスレッドの
    URLをあらかじめ設定（`thread_urls`）しておく方式にしている。
    read.cgiのスレッドURL（例:
    https://xxx.5ch.net/test/read.cgi/car/1234567890/）を渡すと、
    昔から仕様が安定している生のdatファイル
    （https://xxx.5ch.net/car/dat/1234567890.dat）のURLに自動変換して取得する。

    注意:
    - 5chの利用規約・各板のローカルルールを確認し、過度な頻度でのアクセスは
      避けてください（本実装は独自のレート制御を行いません）。
    - 継続的・大量に取得する場合は5chが提供する公式APIの利用を検討してください。
    - datファイルの形式は長年安定していますが、板や時期により差異がありえます。
      取得できない場合はURLやヘッダを見直してください。
    """

    _READ_CGI_PATTERN = re.compile(r"https?://([^/]+)/test/read\.cgi/([^/]+)/(\d+)")

    def __init__(self, thread_urls: Sequence[str], user_agent: str = "Monazilla/1.00"):
        self.thread_urls = [self._to_dat_url(url) for url in thread_urls]
        self.user_agent = user_agent

    def search(self, query: str, max_results: int = 30) -> Iterable[SNSReaction]:
        import requests

        reactions: List[SNSReaction] = []
        for dat_url in self.thread_urls:
            try:
                response = requests.get(dat_url, headers={"User-Agent": self.user_agent}, timeout=15)
                response.raise_for_status()
            except Exception:
                continue

            response.encoding = response.encoding or "shift_jis"
            for index, line in enumerate(response.text.splitlines(), start=1):
                reaction = self._parse_line(dat_url, index, line)
                if reaction and query in reaction.text:
                    reactions.append(reaction)
                if len(reactions) >= max_results:
                    return reactions
        return reactions

    @classmethod
    def _to_dat_url(cls, url: str) -> str:
        if url.endswith(".dat"):
            return url
        match = cls._READ_CGI_PATTERN.match(url)
        if not match:
            return url
        server, board, thread_id = match.groups()
        return f"https://{server}/{board}/dat/{thread_id}.dat"

    @staticmethod
    def _parse_line(dat_url: str, index: int, line: str) -> Optional[SNSReaction]:
        fields = line.split("<>")
        if len(fields) < 4:
            return None

        name, _mail, date_id, body = fields[0], fields[1], fields[2], fields[3]
        text = html_module.unescape(re.sub(r"<[^>]+>", "", body)).strip()
        if not text:
            return None

        return SNSReaction(
            platform="5ch",
            author=html_module.unescape(re.sub(r"<[^>]+>", "", name)).strip(),
            text=text,
            url=f"{dat_url}#{index}",
            posted_at=date_id,
        )


class CompositeSNSProvider:
    """複数のSNSProviderをまとめて呼び出し、結果を連結するプロバイダ。"""

    def __init__(self, providers: Sequence[SNSProvider]):
        self.providers = list(providers)

    def search(self, query: str, max_results: int) -> Iterable[SNSReaction]:
        reactions: List[SNSReaction] = []
        for provider in self.providers:
            reactions.extend(provider.search(query, max_results))
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

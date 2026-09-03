"""分析部門: ニュースとSNS反応を突き合わせ、記事化するトピック単位に整理するエージェント。"""
from __future__ import annotations

from collections import defaultdict
from typing import List, Optional, Sequence, Tuple

from ..llm_client import LLMClient
from ..models import NewsItem, SNSReaction, Topic
from .base import BaseAgent

_KEYWORD_SEPARATORS = ["「", "」", "、", "　", " ", "-", "|", "／", "/"]
_KEYWORD_MARKER = "\x01"


class AnalystAgent(BaseAgent):
    name = "analyst"

    def __init__(
        self,
        llm_client: Optional[LLMClient] = None,
        min_news_per_topic: int = 1,
        max_topics: int = 5,
        logger=None,
    ):
        super().__init__(logger)
        self.llm_client = llm_client
        self.min_news_per_topic = min_news_per_topic
        self.max_topics = max_topics

    def run(self, news_items: Sequence[NewsItem], sns_reactions: Sequence[SNSReaction]) -> List[Topic]:
        clusters = self._cluster_by_keyword(news_items)

        topics: List[Topic] = []
        for keyword, items in clusters.items():
            if len(items) < self.min_news_per_topic:
                continue
            topic = Topic(title=items[0].title, news_items=items, keywords=[keyword])
            topic.sns_reactions = self._match_reactions(topic, sns_reactions)
            topic.summary, topic.sentiment = self._summarize(topic)
            topics.append(topic)

        topics.sort(key=lambda t: len(t.news_items) + len(t.sns_reactions), reverse=True)
        selected = topics[: self.max_topics]
        self.logger.info("抽出したトピック数: %d / %d", len(selected), len(topics))
        return selected

    def _cluster_by_keyword(self, news_items: Sequence[NewsItem]):
        clusters = defaultdict(list)
        for item in news_items:
            keyword = self._extract_keyword(item.title)
            clusters[keyword].append(item)
        return clusters

    @staticmethod
    def _extract_keyword(title: str) -> str:
        """簡易キーワード抽出。記号区切りの先頭トークンをキーワードとする。

        精度を上げたい場合は形態素解析器（例: Janome, MeCab）の導入を検討すること。
        """
        normalized = title
        for sep in _KEYWORD_SEPARATORS:
            normalized = normalized.replace(sep, _KEYWORD_MARKER)
        token = normalized.split(_KEYWORD_MARKER)[0].strip()
        return (token or title)[:20]

    @staticmethod
    def _match_reactions(topic: Topic, sns_reactions: Sequence[SNSReaction]) -> List[SNSReaction]:
        keyword = topic.keywords[0] if topic.keywords else ""
        if not keyword:
            return []
        return [r for r in sns_reactions if keyword in r.text]

    def _summarize(self, topic: Topic) -> Tuple[str, str]:
        if self.llm_client and self.llm_client.available:
            try:
                return self._summarize_with_llm(topic)
            except Exception as exc:
                self.logger.warning("LLMによる要約に失敗、簡易要約にフォールバックします: %s", exc)
        return self._summarize_naive(topic)

    @staticmethod
    def _summarize_naive(topic: Topic) -> Tuple[str, str]:
        summary = " / ".join(n.title for n in topic.news_items[:3])
        return summary, "unknown"

    def _summarize_with_llm(self, topic: Topic) -> Tuple[str, str]:
        news_text = "\n".join(f"- {n.title}: {n.summary}" for n in topic.news_items)
        sns_text = "\n".join(f"- {r.text}" for r in topic.sns_reactions[:20]) or "(該当するSNS投稿なし)"

        prompt = (
            "以下は自動車関連のニュース記事一覧とSNS上の反応です。\n"
            "この話題を1〜2文で要約し、SNSでの反応の傾向を判定してください。\n\n"
            f"【ニュース】\n{news_text}\n\n【SNSの反応】\n{sns_text}\n\n"
            "出力形式（この形式以外は出力しないこと）:\n"
            "要約: <ここに要約>\n"
            "傾向: <positive|negative|mixed|neutral>"
        )
        text = self.llm_client.complete(
            system="あなたは自動車業界に詳しい編集者です。事実に基づき簡潔に整理します。",
            prompt=prompt,
            max_tokens=500,
        )

        summary, sentiment = topic.title, "unknown"
        for line in text.splitlines():
            if line.startswith("要約:"):
                summary = line.split(":", 1)[1].strip()
            elif line.startswith("傾向:"):
                sentiment = line.split(":", 1)[1].strip()
        return summary, sentiment

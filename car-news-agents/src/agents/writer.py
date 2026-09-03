"""執筆部門: トピックから note.com 向け記事の下書き(Markdown)を執筆するエージェント。"""
from __future__ import annotations

from ..llm_client import LLMClient
from ..models import Article, Topic
from .base import BaseAgent


class WriterAgent(BaseAgent):
    name = "writer"

    def __init__(self, llm_client: LLMClient, logger=None):
        super().__init__(logger)
        self.llm_client = llm_client

    def run(self, topic: Topic) -> Article:
        news_lines = "\n".join(
            f"- {n.title}（出典: {n.source} / {n.url}）" for n in topic.news_items
        )
        sns_lines = "\n".join(f"- {r.text}" for r in topic.sns_reactions[:15]) or (
            "（SNS上での目立った反応は見つかりませんでした）"
        )

        prompt = (
            "あなたは自動車ニュースメディアの記者です。以下の情報をもとに、"
            "note.com に掲載するニュースまとめ記事をMarkdown形式で執筆してください。\n\n"
            "# 制約\n"
            "- 見出し(##)を使って構成し、最後に「SNSの反応」セクションを設けること\n"
            "- 事実は入力情報の範囲に留め、憶測で新事実を創作しないこと\n"
            "- SNS投稿は長文の丸写しを避け、要点を要約または短い引用に留めること\n"
            "- 引用したニュースの出典（サイト名）は本文中で言及すること（URLは別途出典一覧に記載する）\n"
            "- 文体は「です・ます調」、読者は自動車好きの一般層\n"
            "- 分量は800〜1200字程度\n\n"
            f"# トピック概要\n{topic.summary}\n\n"
            f"# 関連ニュース\n{news_lines}\n\n"
            f"# SNSでの反応（傾向: {topic.sentiment}）\n{sns_lines}\n"
        )

        body = self.llm_client.complete(
            system=(
                "あなたは正確性を重視する自動車専門メディアの編集記者です。"
                "誇張や未確認情報の記載は行いません。"
            ),
            prompt=prompt,
            max_tokens=3000,
        )

        article = Article(
            title=topic.title,
            body_markdown=body,
            topic=topic,
            tags=self._build_tags(topic),
            sources=[n.url for n in topic.news_items],
        )
        self.logger.info("記事草稿を作成しました: %s", article.title)
        return article

    @staticmethod
    def _build_tags(topic: Topic):
        tags = ["自動車", "クルマ好きと繋がりたい"]
        tags.extend(topic.keywords[:3])
        return tags

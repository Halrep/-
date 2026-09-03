"""編集・校正部門: 執筆された記事を校正し、出典明記や体裁を整えるエージェント。"""
from __future__ import annotations

from typing import Optional

from ..llm_client import LLMClient
from ..models import Article
from .base import BaseAgent


class EditorAgent(BaseAgent):
    name = "editor"

    MIN_LENGTH = 300
    # 誇大・不適切表現の簡易チェック例。運用しながら随時追加すること。
    NG_WORDS = ["絶対に儲かる", "確実に値上がり", "必ず"]

    def __init__(self, llm_client: Optional[LLMClient] = None, logger=None):
        super().__init__(logger)
        self.llm_client = llm_client

    def run(self, article: Article) -> Article:
        self._check_length(article)
        self._check_ng_words(article)
        article.body_markdown = self._ensure_sources_section(article)

        if self.llm_client and self.llm_client.available:
            article.body_markdown = self._proofread(article)

        self.logger.info("記事の校正が完了しました: %s", article.title)
        return article

    def _check_length(self, article: Article) -> None:
        if len(article.body_markdown) < self.MIN_LENGTH:
            self.logger.warning(
                "記事が短すぎる可能性があります (%d文字): %s",
                len(article.body_markdown),
                article.title,
            )

    def _check_ng_words(self, article: Article) -> None:
        for word in self.NG_WORDS:
            if word in article.body_markdown:
                self.logger.warning(
                    "NGワード「%s」が含まれています。内容を確認してください: %s", word, article.title
                )

    @staticmethod
    def _ensure_sources_section(article: Article) -> str:
        body = article.body_markdown
        if "## 出典" in body or not article.sources:
            return body
        sources_block = "\n\n## 出典\n" + "\n".join(f"- {url}" for url in article.sources)
        return body + sources_block

    def _proofread(self, article: Article) -> str:
        prompt = (
            "以下はnote.com向けの自動車ニュース記事です。誤字脱字・事実誤認の疑いがある表現・"
            "過度に断定的な表現の観点で校正してください。"
            "大幅な内容変更は行わず、修正後の記事全文のみをMarkdownで出力してください。\n\n"
            f"{article.body_markdown}"
        )
        try:
            return self.llm_client.complete(
                system="あなたは自動車専門メディアの校閲担当者です。",
                prompt=prompt,
                max_tokens=3000,
            )
        except Exception as exc:
            self.logger.warning("LLMによる校正に失敗、元の草稿を使用します: %s", exc)
            return article.body_markdown

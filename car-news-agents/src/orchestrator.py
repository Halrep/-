"""各部門エージェントを協働させ、ニュース収集からnote.com投稿までを実行する統括モジュール。"""
from __future__ import annotations

import logging
from typing import List, Optional, Tuple

from .agents.analyst import AnalystAgent
from .agents.editor import EditorAgent
from .agents.news_collector import NewsCollectorAgent
from .agents.publisher import PublisherAgent
from .agents.sns_collector import SNSCollectorAgent
from .agents.writer import WriterAgent
from .models import Article


class Orchestrator:
    """情報収集 → SNS反応収集 → 分析 → 執筆 → 校正 → 投稿、の一連の流れを統括する。"""

    def __init__(
        self,
        news_collector: NewsCollectorAgent,
        sns_collector: SNSCollectorAgent,
        analyst: AnalystAgent,
        writer: WriterAgent,
        editor: EditorAgent,
        publisher: PublisherAgent,
        logger: Optional[logging.Logger] = None,
    ):
        self.news_collector = news_collector
        self.sns_collector = sns_collector
        self.analyst = analyst
        self.writer = writer
        self.editor = editor
        self.publisher = publisher
        self.logger = logger or logging.getLogger("orchestrator")

    def run_once(self, publish: bool = False) -> List[Tuple[Article, Optional[str]]]:
        self.logger.info("=== パイプライン開始 ===")

        news_items = self.news_collector.run()
        sns_reactions = self.sns_collector.run()

        topics = self.analyst.run(news_items, sns_reactions)
        if not topics:
            self.logger.info("記事化対象のトピックがありませんでした")
            return []

        results: List[Tuple[Article, Optional[str]]] = []
        for topic in topics:
            draft = self.writer.run(topic)
            article = self.editor.run(draft)
            url = self.publisher.run(article, publish=publish)
            results.append((article, url))

        self.logger.info("=== パイプライン完了: %d件処理 ===", len(results))
        return results

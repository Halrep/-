"""投稿部門: 完成した記事をローカル保存し、必要に応じて note.com へ投稿するエージェント。"""
from __future__ import annotations

import datetime
import os
import re
from typing import Optional

from ..models import Article
from .base import BaseAgent


class PublisherAgent(BaseAgent):
    name = "publisher"

    def __init__(
        self,
        note_publisher=None,
        dry_run: bool = True,
        output_dir: Optional[str] = None,
        logger=None,
    ):
        super().__init__(logger)
        self.note_publisher = note_publisher
        self.dry_run = dry_run
        self.output_dir = output_dir

    def run(self, article: Article, publish: bool = False) -> Optional[str]:
        if self.output_dir:
            self._save_local(article)

        if self.dry_run or self.note_publisher is None:
            self.logger.info("[DRY RUN] note.com への投稿をスキップしました: %s", article.title)
            return None

        url = self.note_publisher.publish(article, publish=publish)
        self.logger.info(
            "note.com へ%sしました: %s (%s)",
            "公開" if publish else "下書き保存",
            article.title,
            url,
        )
        return url

    def _save_local(self, article: Article) -> None:
        os.makedirs(self.output_dir, exist_ok=True)
        safe_title = re.sub(r'[\\/:*?"<>|]', "_", article.title)[:50]
        filename = f"{datetime.datetime.now():%Y%m%d_%H%M%S}_{safe_title}.md"
        path = os.path.join(self.output_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# {article.title}\n\n{article.body_markdown}\n")
        self.logger.info("記事をローカル保存しました: %s", path)

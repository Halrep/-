"""パイプライン実行用CLI。

使用例:
    python scripts/run_pipeline.py                 # 下書き/ローカル保存まで
    python scripts/run_pipeline.py --publish        # note.comへの公開まで実行

事前に config/config.yaml と .env を用意しておくこと（各 .example ファイルを参照）。
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import yaml
from dotenv import load_dotenv

from src.agents.analyst import AnalystAgent
from src.agents.editor import EditorAgent
from src.agents.news_collector import NewsCollectorAgent
from src.agents.publisher import PublisherAgent
from src.agents.sns_collector import (
    CompositeSNSProvider,
    FiveChProvider,
    NullSNSProvider,
    SNSCollectorAgent,
    XApiProvider,
    YouTubeCommentsProvider,
)
from src.agents.writer import WriterAgent
from src.llm_client import LLMClient
from src.note_client import NoteCredentials, NotePublisher
from src.orchestrator import Orchestrator
from src.utils.logging_config import configure_logging


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_orchestrator(config: dict) -> Orchestrator:
    llm_client = LLMClient(model=config.get("llm", {}).get("model", "claude-sonnet-5"))

    news_collector = NewsCollectorAgent(
        feed_urls=config["news"]["feeds"],
        lookback_hours=config["news"].get("lookback_hours", 24),
        unofficial_feed_urls=config["news"].get("unofficial_feeds", []),
    )

    sns_providers = []

    bearer_token = os.environ.get("X_BEARER_TOKEN")
    if bearer_token:
        sns_providers.append(XApiProvider(bearer_token))

    youtube_api_key = os.environ.get("YOUTUBE_API_KEY")
    if youtube_api_key:
        sns_providers.append(YouTubeCommentsProvider(youtube_api_key))

    five_ch_threads = config.get("sns", {}).get("five_ch_threads", [])
    if five_ch_threads:
        sns_providers.append(FiveChProvider(five_ch_threads))

    sns_provider = CompositeSNSProvider(sns_providers) if sns_providers else NullSNSProvider()
    sns_collector = SNSCollectorAgent(
        provider=sns_provider,
        queries=config["sns"]["queries"],
        max_results_per_query=config["sns"].get("max_results_per_query", 30),
    )

    analyst = AnalystAgent(
        llm_client=llm_client,
        min_news_per_topic=config["analyst"].get("min_news_per_topic", 1),
        max_topics=config["analyst"].get("max_topics", 3),
    )
    writer = WriterAgent(llm_client=llm_client)
    editor = EditorAgent(llm_client=llm_client)

    note_publisher = None
    email = os.environ.get("NOTE_EMAIL")
    password = os.environ.get("NOTE_PASSWORD")
    if email and password:
        note_publisher = NotePublisher(NoteCredentials(email=email, password=password))

    publisher = PublisherAgent(
        note_publisher=note_publisher,
        dry_run=config["publish"].get("dry_run", True),
        output_dir=config["publish"].get("local_output_dir"),
    )

    return Orchestrator(news_collector, sns_collector, analyst, writer, editor, publisher)


def main() -> None:
    parser = argparse.ArgumentParser(description="自動車ニュース・SNSまとめ記事の自動生成/投稿パイプライン")
    parser.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "..", "config", "config.yaml"))
    parser.add_argument("--publish", action="store_true", help="下書きではなくnote.comへの公開まで行う")
    args = parser.parse_args()

    configure_logging()
    load_dotenv()

    config = load_config(args.config)
    orchestrator = build_orchestrator(config)
    orchestrator.run_once(publish=args.publish)


if __name__ == "__main__":
    main()

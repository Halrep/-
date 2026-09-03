"""LLM (Anthropic API) 呼び出しの薄いラッパー。

分析部門・執筆部門・編集部門から共通で利用する。
ANTHROPIC_API_KEY が未設定の場合は呼び出し時に例外を送出するため、
呼び出し側は try/except でフォールバック処理を用意すること。
"""
from __future__ import annotations

import os
from typing import Optional


class LLMClient:
    def __init__(self, api_key: Optional[str] = None, model: str = "claude-sonnet-5"):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.model = model
        self._client = None
        if self.api_key:
            import anthropic  # 遅延importでAPIキー未設定時の依存を回避

            self._client = anthropic.Anthropic(api_key=self.api_key)

    @property
    def available(self) -> bool:
        return self._client is not None

    def complete(self, system: str, prompt: str, max_tokens: int = 2000) -> str:
        if not self._client:
            raise RuntimeError(
                "ANTHROPIC_API_KEY が設定されていないため LLM を呼び出せません。"
                ".env に ANTHROPIC_API_KEY を設定してください。"
            )
        response = self._client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        )

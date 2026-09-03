"""LLM呼び出しの薄いラッパー。分析部門・執筆部門・編集部門から共通で利用する。

Anthropic APIとGoogle Gemini API（無料枠あり）の両方に対応しており、
`provider` を明示しない場合は環境変数から自動判定する
（`GEMINI_API_KEY` があればGemini、無ければ `ANTHROPIC_API_KEY` があればAnthropicを使う）。
どちらのキーも無い場合は `available` が False になり、呼び出し側はフォールバック
処理（簡易要約等）を行うこと。
"""
from __future__ import annotations

import os
from typing import Optional, Protocol


class _LLMBackend(Protocol):
    def complete(self, system: str, prompt: str, max_tokens: int) -> str:
        ...


class _AnthropicBackend:
    def __init__(self, api_key: str, model: str):
        import anthropic  # 遅延import: このバックエンドを使わない場合の依存を回避

        self._client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def complete(self, system: str, prompt: str, max_tokens: int) -> str:
        response = self._client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        )


class _GeminiBackend:
    """Google Gemini API（無料枠あり）を利用するバックエンド。

    Google AI Studio (https://aistudio.google.com/apikey) で発行したAPIキーで
    利用できる。SDKは使わずGenerative Language APIを直接REST呼び出しする。
    無料枠にはモデルごとにレート制限があるため、大量実行時は注意すること。
    """

    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def complete(self, system: str, prompt: str, max_tokens: int) -> str:
        import requests

        response = requests.post(
            f"{self.BASE_URL}/{self.model}:generateContent",
            params={"key": self.api_key},
            json=self._build_request_body(system, prompt, max_tokens),
            timeout=60,
        )
        response.raise_for_status()
        return self._parse_response(response.json())

    @staticmethod
    def _build_request_body(system: str, prompt: str, max_tokens: int) -> dict:
        return {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }

    @staticmethod
    def _parse_response(payload: dict) -> str:
        candidates = payload.get("candidates") or []
        if not candidates:
            raise RuntimeError(f"Gemini APIから有効な応答が得られませんでした: {payload}")
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in parts)


_DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "gemini": "gemini-2.0-flash",
}


class LLMClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
    ):
        provider = provider or os.environ.get("LLM_PROVIDER") or self._autodetect_provider()
        self.provider = provider
        self.model = model or _DEFAULT_MODELS.get(provider, "")
        self._backend: Optional[_LLMBackend] = self._build_backend(provider, api_key)

    @staticmethod
    def _autodetect_provider() -> Optional[str]:
        if os.environ.get("GEMINI_API_KEY"):
            return "gemini"
        if os.environ.get("ANTHROPIC_API_KEY"):
            return "anthropic"
        return None

    def _build_backend(self, provider: Optional[str], api_key: Optional[str]) -> Optional[_LLMBackend]:
        if provider == "gemini":
            key = api_key or os.environ.get("GEMINI_API_KEY")
            return _GeminiBackend(key, self.model) if key else None
        if provider == "anthropic":
            key = api_key or os.environ.get("ANTHROPIC_API_KEY")
            return _AnthropicBackend(key, self.model) if key else None
        return None

    @property
    def available(self) -> bool:
        return self._backend is not None

    def complete(self, system: str, prompt: str, max_tokens: int = 2000) -> str:
        if not self._backend:
            raise RuntimeError(
                "利用可能なLLMのAPIキーが設定されていません。"
                ".env に GEMINI_API_KEY または ANTHROPIC_API_KEY を設定してください。"
            )
        return self._backend.complete(system, prompt, max_tokens)

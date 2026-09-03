"""各部門エージェントの共通基底クラス。"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional


class BaseAgent(ABC):
    name: str = "base"

    def __init__(self, logger: Optional[logging.Logger] = None):
        self.logger = logger or logging.getLogger(self.name)

    @abstractmethod
    def run(self, *args, **kwargs):
        raise NotImplementedError

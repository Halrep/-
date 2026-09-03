"""note.com への記事投稿クライアント。

note.com は本コード作成時点で、記事投稿用の公式パブリックAPIを提供していません。
そのため、実際にログインしたブラウザを自動操作して下書き保存/公開を行う方式
（Playwright によるヘッドレスブラウザ操作）を採用しています。

## 注意事項（必ず読むこと）
- note.com のUI変更に弱い実装です。動作しなくなった場合はセレクタの見直しが必要です。
- note.com の利用規約を確認し、自動投稿が許容される用途・範囲で使用してください。
- 事故防止のため、既定では `publish=False`（下書き保存まで）としています。
  実際に一般公開する場合は、内容を人間が確認したうえで明示的に `publish=True` を
  指定するフローを強く推奨します（PublisherAgent の dry_run / publish 引数を参照）。
- ログイン情報（メールアドレス・パスワード）は環境変数から読み込み、ログ出力しないこと。
- 二段階認証やCAPTCHAが有効なアカウントでは、この自動ログインは失敗します。
  その場合は note.com のログインセッション用Cookieを別途取得して利用する方式への
  切り替えを検討してください。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from .models import Article

NOTE_LOGIN_URL = "https://note.com/login"
NOTE_NEW_NOTE_URL = "https://note.com/notes/new"


@dataclass
class NoteCredentials:
    email: str
    password: str


class NotePublisher:
    def __init__(self, credentials: NoteCredentials, headless: bool = True, logger: Optional[logging.Logger] = None):
        self.credentials = credentials
        self.headless = headless
        self.logger = logger or logging.getLogger("note_publisher")

    def publish(self, article: Article, publish: bool = False) -> str:
        """記事を note.com に下書き保存(既定)、または publish=True 時は公開する。

        戻り値: 作成された note のURL。
        """
        from playwright.sync_api import sync_playwright  # 遅延import

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=self.headless)
            try:
                page = browser.new_page()
                self._login(page)
                return self._create_note(page, article, publish=publish)
            finally:
                browser.close()

    def _login(self, page) -> None:
        page.goto(NOTE_LOGIN_URL, wait_until="networkidle")
        page.fill('input[name="email"]', self.credentials.email)
        page.fill('input[name="password"]', self.credentials.password)
        page.click('button[type="submit"]')
        page.wait_for_load_state("networkidle")
        if "login" in page.url:
            raise RuntimeError(
                "note.com へのログインに失敗しました。認証情報、または二段階認証の"
                "設定を確認してください。"
            )

    def _create_note(self, page, article: Article, publish: bool) -> str:
        page.goto(NOTE_NEW_NOTE_URL, wait_until="networkidle")

        page.fill('textarea[placeholder="記事タイトル"]', article.title)

        body_selector = "div.ProseMirror"
        page.click(body_selector)
        for line in article.body_markdown.splitlines():
            if line.strip():
                page.type(body_selector, line)
            page.keyboard.press("Enter")

        self._try_set_tags(page, article)

        page.click("text=下書き保存")
        page.wait_for_timeout(1500)
        note_url = page.url

        if publish:
            note_url = self._publish_note(page)

        self.logger.info(
            "note.com へ%sしました: %s", "公開" if publish else "下書き保存", note_url
        )
        return note_url

    def _try_set_tags(self, page, article: Article) -> None:
        """タグ入力欄はUI変更の影響を受けやすいため、失敗しても処理を継続する。"""
        if not article.tags:
            return
        try:
            for tag in article.tags:
                page.fill('input[placeholder="ハッシュタグを追加"]', tag)
                page.keyboard.press("Enter")
        except Exception as exc:
            self.logger.warning("タグ設定に失敗しました（本文の投稿は継続します）: %s", exc)

    @staticmethod
    def _publish_note(page) -> str:
        page.click("text=公開に進む")
        page.wait_for_selector("text=投稿する")
        page.click("text=投稿する")
        page.wait_for_load_state("networkidle")
        return page.url

/**
 * Code.gs
 * ウェブアプリの入口。
 *
 * デプロイ設定（構想書 §1.1）
 *   実行するユーザー   : 自分（APIキーとシートへの権限をアプリ側で持つ）
 *   アクセスできるユーザー: 全員（家庭利用のためログイン不要）
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(C.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** index.html から css / js を差し込む */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

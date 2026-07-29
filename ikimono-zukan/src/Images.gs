/**
 * Images.gs
 * 写真の取得。構想書 §7 のパイプライン。
 *
 * Gemini API は写真を返さない（テキスト生成のみ）ので、ここだけ別系統になる。
 *   1. 日本語版 Wikipedia から実写を取る（APIキー不要・無料）
 *   2. 見つからなければ Wikimedia Commons を検索する
 *   3. それでも無ければ、設定が有効なときだけ AI 生成にフォールバックする
 *
 * 取得した画像は Drive に1回だけ保存し、以後は Drive から配信する。
 * UrlFetchApp の通信量クォータは 100MB/日しかなく、
 * 200KBの画像を毎回外部から取ると 500回で枯渇するため、ホットリンクはしない。
 *
 * 【失敗は必ず声を出すこと】
 * 以前は HTTP 200 以外を無言で null にして返していた。
 * その結果「ログにエラーが無いのに画像だけ出ない」という、最も追いにくい壊れ方をした。
 * 通信の失敗はすべて console.warn にステータスコードと本文の頭を残す。
 */
var Images = (function () {

  // MediaWiki Action API を主経路にする。
  // REST(rest_v1) は User-Agent ポリシーの締め付けで 403 を返すことがあり、
  // Action API のほうが Apps Script の共有IPからでも安定して通る。
  var WIKI_API  = 'https://ja.wikipedia.org/w/api.php';
  var WIKI_REST = 'https://ja.wikipedia.org/api/rest_v1/page/summary/';
  var COMMONS   = 'https://commons.wikimedia.org/w/api.php';
  // Wikimedia は User-Agent の明示を求めている
  var UA = 'IkimonoZukan/1.0 (educational app for children; Google Apps Script)';

  // 画像本体を取りにいくときのヘッダ。
  // upload.wikimedia.org は User-Agent と Referer を見て弾くことがある。
  var IMG_HEADERS = {
    'User-Agent': UA,
    'Api-User-Agent': UA,
    'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
    'Referer': 'https://ja.wikipedia.org/'
  };

  /**
   * 生き物の写真を1枚用意する。
   *
   * Drive への保存はあくまで最適化であって、必須ではない。
   * Wikimedia は Google のサーバーIPからの直接ダウンロードを弾くことがあるが、
   * そのときでも画像URL自体は有効で、子供のブラウザからは普通に読める。
   * 保存に失敗しても URL は捨てず、画面がそれを直接読めるようにして返す。
   * ブラウザが読みにいく分には UrlFetchApp のクォータを一切消費しない。
   *
   * @return {{fileId:string, url:string, kind:string, credit:string}|null}
   */
  function fetchFor(wikipediaTitle, canonicalName) {
    var found = fromWikipedia_(wikipediaTitle) ||
                fromWikipedia_(canonicalName) ||
                fromRest_(wikipediaTitle) ||
                fromRest_(canonicalName) ||
                fromCommons_(canonicalName);

    if (!found) {
      console.warn('[画像] 実写が見つからなかった: title=' + wikipediaTitle +
                   ' / name=' + canonicalName);
      if (aiEnabled_()) {
        var gen = fromAi_(canonicalName);
        if (gen) return gen;
      }
      return null;
    }

    var fileId = '';
    try {
      var blob = download_(found.url);
      if (blob) {
        fileId = saveToDrive_(blob, canonicalName);
        console.log('[画像] Drive に保存した: ' + canonicalName + ' → ' + fileId);
      } else {
        console.log('[画像] Drive には保存できないので、URLをそのまま使う: ' + canonicalName);
      }
    } catch (e) {
      console.warn('[画像] Drive への保存に失敗（URLはそのまま使う）: ' + e);
    }

    return {
      fileId: fileId,
      url: found.url,
      kind: C.IMG.PHOTO,
      credit: found.credit
    };
  }

  /* ---------- 共通の取得 ---------- */

  /**
   * JSON を取ってくる。200 以外は必ずログに残してから null を返す。
   * @param {string} label ログに出す呼び出し元の名前
   */
  function getJson_(url, label) {
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Api-User-Agent': UA, 'Accept': 'application/json' },
        muteHttpExceptions: true,
        followRedirects: true
      });
      var code = res.getResponseCode();
      var text = res.getContentText();
      if (code !== 200) {
        console.warn('[画像] ' + label + ' が HTTP ' + code + ' を返した: ' +
                     text.slice(0, 200));
        return null;
      }
      return JSON.parse(text);
    } catch (e) {
      console.warn('[画像] ' + label + ' で例外: ' + e);
      return null;
    }
  }

  /* ---------- 1. Wikipedia（Action API） ---------- */

  /**
   * 記事名から代表画像（pageimages）のサムネイルURLを取る。
   * redirects=1 を付けているので「オオスズメバチ」のような別名でも本記事に飛ぶ。
   */
  function fromWikipedia_(title) {
    if (!title) return null;
    // 区切りの | は必ず %7C にする。素のままだと UrlFetchApp が弾くことがある
    var url = WIKI_API +
      '?action=query&format=json&formatversion=2&redirects=1' +
      '&prop=pageimages%7Cpageprops&piprop=thumbnail' +
      '&pithumbsize=' + C.IMAGE_MAX_PX +
      '&titles=' + encodeURIComponent(String(title).trim());

    var body = getJson_(url, 'Wikipedia「' + title + '」');
    if (!body) return null;

    var pages = (body.query || {}).pages || [];
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.missing) continue;
      // 曖昧さ回避ページには代表的な写真がないので弾く
      if (p.pageprops && p.pageprops.disambiguation !== undefined) continue;
      var src = p.thumbnail && p.thumbnail.source;
      if (!src) continue;
      return {
        url: src,
        credit: 'ja.wikipedia.org「' + (p.title || title) + '」より'
      };
    }
    console.warn('[画像] Wikipedia「' + title + '」に代表画像が無い');
    return null;
  }

  /* ---------- 1b. Wikipedia（REST・予備） ---------- */

  function fromRest_(title) {
    if (!title) return null;
    var j = getJson_(WIKI_REST + encodeURIComponent(String(title).trim()),
                     'Wikipedia REST「' + title + '」');
    if (!j) return null;
    if (j.type && j.type.indexOf('disambiguation') >= 0) return null;

    // 原寸（originalimage）は数MBあることがある。
    // サムネイルURLの幅指定を書き換えて、必要な大きさだけを取りにいく。
    var thumb = j.thumbnail && j.thumbnail.source;
    var src = thumb ? widen_(thumb, C.IMAGE_MAX_PX)
                    : (j.originalimage && j.originalimage.source);
    if (!src) return null;
    return { url: src, credit: 'ja.wikipedia.org「' + (j.title || title) + '」より' };
  }

  /* ---------- 2. Wikimedia Commons ---------- */

  /**
   * Commons を検索して1枚目の画像を取る。
   * extmetadata から作者名とライセンスも拾う。表示は省略できない。
   */
  function fromCommons_(name) {
    if (!name) return null;
    var url = COMMONS + '?action=query&format=json&formatversion=2&generator=search' +
      '&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + name) +
      '&gsrnamespace=6&gsrlimit=1' +
      '&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=' + C.IMAGE_MAX_PX;

    var body = getJson_(url, 'Commons「' + name + '」');
    if (!body) return null;

    var pages = (body.query || {}).pages || [];
    for (var i = 0; i < pages.length; i++) {
      var info = (pages[i].imageinfo || [])[0];
      if (!info) continue;
      var meta = info.extmetadata || {};
      var artist = stripTags_((meta.Artist || {}).value || '');
      var license = (meta.LicenseShortName || {}).value || '';
      return {
        url: info.thumburl || info.url,
        credit: [artist, license].filter(String).join(' / ') || 'Wikimedia Commons'
      };
    }
    console.warn('[画像] Commons に「' + name + '」の画像が無い');
    return null;
  }

  function stripTags_(s) {
    return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  /* ---------- 3. AI生成（フォールバック・既定では無効） ---------- */

  function aiEnabled_() {
    return PropertiesService.getScriptProperties()
      .getProperty(C.PROP.ALLOW_AI_IMAGE) === 'true';
  }

  /**
   * 実写が見つからなかったときだけ使う。
   * 生成画像は実物と特徴が食い違いうるので、
   * 呼び出し元で「AIがかいたイラスト」のバッジを必ず出すこと。
   */
  function fromAi_(name) {
    try {
      var key = PropertiesService.getScriptProperties().getProperty(C.PROP.API_KEY);
      if (!key) return null;
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                'gemini-3-pro-image:generateContent';
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: '日本の子供向け図鑑にのせる、' + name + ' の図。' +
                    '白い背景、真横または真上から見た全身、写実的で正確な色と形。文字は入れない。'
            }]
          }]
        }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) {
        console.warn('[画像] AI画像生成が HTTP ' + res.getResponseCode() + ': ' +
                     res.getContentText().slice(0, 200));
        return null;
      }
      var parts = (((JSON.parse(res.getContentText()).candidates || [])[0] || {})
                    .content || {}).parts || [];
      for (var i = 0; i < parts.length; i++) {
        var d = parts[i].inlineData;
        if (!d || !d.data) continue;
        var blob = Utilities.newBlob(Utilities.base64Decode(d.data),
                                     d.mimeType || 'image/png', name + '.png');
        return {
          fileId: saveToDrive_(blob, name),
          url: '',                      // 生成画像は Drive にしか存在しない
          kind: C.IMG.AI,
          credit: 'AIがかいたイラスト'
        };
      }
      return null;
    } catch (e) {
      console.warn('[画像] AI画像生成に失敗: ' + e);
      return null;
    }
  }

  /* ---------- 保存 ---------- */

  /**
   * Wikimedia のサムネイルURLに埋まっている幅指定（/320px-）を書き換える。
   * GAS には画像を縮小する手段がないので、縮小は「小さいものを要求する」ことで実現する。
   * これが UrlFetchApp の通信量クォータ（100MB/日）を守るための実質的な唯一の手段になる。
   */
  function widen_(url, px) {
    return String(url).replace(/\/\d+px-/, '/' + px + 'px-');
  }

  function download_(url) {
    var p = probe_(url);
    if (p.code !== 200) {
      console.warn('[画像] ダウンロードが HTTP ' + p.code + ': ' + url +
                   (p.snippet ? ' / ' + p.snippet : ''));
      return null;
    }
    return p.blob;
  }

  /**
   * 1回取ってきて、結果を数字で返す。診断がステータスコードを名指しできるようにする。
   * @return {{code:number, bytes:number, contentType:string, snippet:string, blob:Blob}}
   */
  function probe_(url) {
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: IMG_HEADERS,
        muteHttpExceptions: true,
        followRedirects: true
      });
      var code = res.getResponseCode();
      if (code !== 200) {
        return { code: code, bytes: 0, contentType: '',
                 snippet: res.getContentText().slice(0, 200), blob: null };
      }
      var blob = res.getBlob();
      return { code: 200, bytes: blob.getBytes().length,
               contentType: blob.getContentType(), snippet: '', blob: blob };
    } catch (e) {
      return { code: -1, bytes: 0, contentType: '', snippet: String(e), blob: null };
    }
  }

  /** 画像フォルダを用意して保存し、ファイルIDを返す */
  function saveToDrive_(blob, name) {
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty(C.PROP.FOLDER_ID);
    var folder;
    try {
      folder = folderId ? DriveApp.getFolderById(folderId) : null;
    } catch (e) {
      folder = null;
    }
    if (!folder) {
      folder = DriveApp.createFolder(C.APP_NAME + '_画像');
      props.setProperty(C.PROP.FOLDER_ID, folder.getId());
    }
    var file = folder.createFile(blob.setName(name + '_' + Date.now()));
    // ウェブアプリから <img> で読めるようにする。
    // 組織のポリシーで外部共有が禁じられていると例外になるので、
    // 握りつぶさずに理由を残す（画像だけ見えない状態の主な原因になる）
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.warn('[画像] 公開設定に失敗（組織のポリシーの可能性）: ' + e);
    }
    return file.getId();
  }

  /** Drive のファイルIDから、画面に貼れる data URI を作る */
  function dataUri(fileId) {
    if (!fileId) return '';
    try {
      var blob = DriveApp.getFileById(fileId).getBlob();
      return 'data:' + blob.getContentType() + ';base64,' +
             Utilities.base64Encode(blob.getBytes());
    } catch (e) {
      console.warn('[画像] 画像の読み出しに失敗: ' + e);
      return '';
    }
  }

  return {
    fetchFor: fetchFor,
    dataUri: dataUri,
    _widen: widen_,
    _getJson: getJson_,
    _download: download_,
    _probe: probe_,
    _saveToDrive: saveToDrive_,
    _fromWikipedia: fromWikipedia_,
    _fromRest: fromRest_,
    _fromCommons: fromCommons_
  };
})();

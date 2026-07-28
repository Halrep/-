/**
 * Images.gs
 * 写真の取得。構想書 §7 のパイプライン。
 *
 * Gemini API は写真を返さない（テキスト生成のみ）ので、ここだけ別系統になる。
 *   1. 日本語版 Wikipedia の REST API から実写を取る（APIキー不要・無料）
 *   2. 見つからなければ Wikimedia Commons を検索する
 *   3. それでも無ければ、設定が有効なときだけ AI 生成にフォールバックする
 *
 * 取得した画像は Drive に1回だけ保存し、以後は Drive から配信する。
 * UrlFetchApp の通信量クォータは 100MB/日しかなく、
 * 200KBの画像を毎回外部から取ると 500回で枯渇するため、ホットリンクはしない。
 */
var Images = (function () {

  var WIKI = 'https://ja.wikipedia.org/api/rest_v1/page/summary/';
  var COMMONS = 'https://commons.wikimedia.org/w/api.php';
  // Wikimedia は User-Agent の明示を求めている
  var UA = 'IkimonoZukan/1.0 (educational app for children; GAS)';

  /**
   * 生き物の写真を1枚用意する。
   * @return {{fileId:string, kind:string, credit:string}|null}
   */
  function fetchFor(wikipediaTitle, canonicalName) {
    var found = fromWikipedia_(wikipediaTitle) ||
                fromWikipedia_(canonicalName) ||
                fromCommons_(canonicalName);

    if (!found) {
      if (aiEnabled_()) {
        var gen = fromAi_(canonicalName);
        if (gen) return gen;
      }
      return null;
    }

    try {
      var blob = download_(found.url);
      if (!blob) return null;
      var fileId = saveToDrive_(blob, canonicalName);
      return { fileId: fileId, kind: C.IMG.PHOTO, credit: found.credit };
    } catch (e) {
      console.warn('画像の保存に失敗: ' + e);
      return null;
    }
  }

  /* ---------- 1. Wikipedia ---------- */

  function fromWikipedia_(title) {
    if (!title) return null;
    try {
      var res = UrlFetchApp.fetch(WIKI + encodeURIComponent(String(title).trim()), {
        method: 'get',
        headers: { 'Api-User-Agent': UA },
        muteHttpExceptions: true,
        followRedirects: true
      });
      if (res.getResponseCode() !== 200) return null;
      var j = JSON.parse(res.getContentText());
      // 曖昧さ回避ページには代表的な写真がないので弾く
      if (j.type && j.type.indexOf('disambiguation') >= 0) return null;

      // 原寸（originalimage）は数MBあることがある。
      // サムネイルURLの幅指定を書き換えて、必要な大きさだけを取りにいく。
      var thumb = j.thumbnail && j.thumbnail.source;
      var src = thumb ? widen_(thumb, C.IMAGE_MAX_PX)
                      : (j.originalimage && j.originalimage.source);
      if (!src) return null;

      return {
        url: src,
        credit: 'ja.wikipedia.org「' + (j.title || title) + '」より'
      };
    } catch (e) {
      console.warn('Wikipedia 取得に失敗: ' + e);
      return null;
    }
  }

  /* ---------- 2. Wikimedia Commons ---------- */

  /**
   * Commons を検索して1枚目の画像を取る。
   * extmetadata から作者名とライセンスも拾う。表示は省略できない。
   */
  function fromCommons_(name) {
    if (!name) return null;
    try {
      var search = COMMONS + '?action=query&format=json&generator=search' +
        '&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + name) +
        '&gsrnamespace=6&gsrlimit=1' +
        '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=' + C.IMAGE_MAX_PX;
      var res = UrlFetchApp.fetch(search, {
        method: 'get',
        headers: { 'Api-User-Agent': UA },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) return null;

      var pages = ((JSON.parse(res.getContentText()).query || {}).pages) || {};
      for (var k in pages) {
        var info = (pages[k].imageinfo || [])[0];
        if (!info) continue;
        var meta = info.extmetadata || {};
        var artist = stripTags_((meta.Artist || {}).value || '');
        var license = (meta.LicenseShortName || {}).value || '';
        return {
          url: info.thumburl || info.url,
          credit: [artist, license].filter(String).join(' / ') || 'Wikimedia Commons'
        };
      }
      return null;
    } catch (e) {
      console.warn('Commons 検索に失敗: ' + e);
      return null;
    }
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
        console.warn('AI画像生成に失敗: HTTP ' + res.getResponseCode());
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
          kind: C.IMG.AI,
          credit: 'AIがかいたイラスト'
        };
      }
      return null;
    } catch (e) {
      console.warn('AI画像生成に失敗: ' + e);
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
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Api-User-Agent': UA },
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return null;
    return res.getBlob();
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
    // ウェブアプリから <img> で読めるようにする
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
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
      console.warn('画像の読み出しに失敗: ' + e);
      return '';
    }
  }

  return {
    fetchFor: fetchFor,
    dataUri: dataUri,
    _widen: widen_,
    _fromWikipedia: fromWikipedia_,
    _fromCommons: fromCommons_
  };
})();

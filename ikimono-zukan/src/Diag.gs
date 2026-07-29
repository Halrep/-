/**
 * Diag.gs
 * 画像まわりの自己診断と、あとからの取り直し。
 *
 * 「写真だけ出ない」は、通信・権限・共有設定のどこで落ちても
 * 画面上は同じ（🔍 のまま）に見えるため、原因が切り分けられない。
 * ここで段ごとに結果を出して、どこで止まったかを名指しできるようにする。
 *
 * 使い方：Apps Script エディタで関数を選んで実行し、実行ログを見る。
 */

/**
 * 画像パイプラインを1段ずつ試して、結果をログに出す。
 * @param {string=} name 試す生き物の名前（省略時は オオスズメバチ）
 */
function diagImages(name) {
  // メニューから呼ばれたときは引数が来ない（または実行イベントが渡る）ので、
  // 文字列のときだけ採用する
  var target = (typeof name === 'string' && name) ? name : 'オオスズメバチ';
  var out = ['===== 画像診断：' + target + ' ====='];

  function say(s) { out.push(s); console.log(s); }

  // --- 1. 外部通信ができるか ---
  var wiki = null;
  try {
    wiki = Images._fromWikipedia(target);
    say('1. Wikipedia(Action API) … ' + (wiki ? 'OK ' + wiki.url : '取得できず'));
  } catch (e) {
    say('1. Wikipedia(Action API) … 例外 ' + e);
  }

  // --- 2. 予備経路 ---
  if (!wiki) {
    try {
      wiki = Images._fromRest(target);
      say('2. Wikipedia(REST) … ' + (wiki ? 'OK ' + wiki.url : '取得できず'));
    } catch (e) {
      say('2. Wikipedia(REST) … 例外 ' + e);
    }
    try {
      if (!wiki) {
        wiki = Images._fromCommons(target);
        say('3. Wikimedia Commons … ' + (wiki ? 'OK ' + wiki.url : '取得できず'));
      }
    } catch (e) {
      say('3. Wikimedia Commons … 例外 ' + e);
    }
  }

  if (!wiki) {
    say('→ 画像のURLが1つも取れていません。通信が弾かれている可能性が高いです。');
    return finishDiag_(out);
  }

  // --- 4. 画像本体を落とせるか ---
  var blob = null;
  try {
    blob = Images._download(wiki.url);
    say('4. 画像のダウンロード … ' + (blob ? 'OK ' + blob.getBytes().length + ' バイト' : '失敗'));
  } catch (e) {
    say('4. 画像のダウンロード … 例外 ' + e);
  }
  if (!blob) return finishDiag_(out);

  // --- 5. Drive に保存できるか（スコープと共有ポリシーの確認を兼ねる） ---
  var fileId = null;
  try {
    fileId = Images._saveToDrive(blob, '診断_' + target);
    say('5. Drive への保存 … OK fileId=' + fileId);
  } catch (e) {
    say('5. Drive への保存 … 例外 ' + e);
    say('→ appsscript.json の oauthScopes に drive が入っているか確認してください。');
    return finishDiag_(out);
  }

  // --- 6. 公開されているか ---
  try {
    var f = DriveApp.getFileById(fileId);
    var access = f.getSharingAccess();
    say('6. 共有設定 … ' + access);
    if (String(access) !== 'ANYONE_WITH_LINK') {
      say('→ 共有が「リンクを知っている全員」になっていません。' +
          '組織のポリシーで外部共有が禁止されていると、画面に画像が出ません。');
    }
    say('7. 画面に渡すURL … ' + thumbUrl_(fileId, 800));
  } catch (e) {
    say('6. 共有設定 … 例外 ' + e);
  }

  say('（診断で作ったファイルは Drive の「' + C.APP_NAME + '_画像」に残ります。消して構いません）');
  return finishDiag_(out);
}

function finishDiag_(lines) {
  var text = lines.join('\n');
  try {
    SpreadsheetApp.getUi().alert(C.APP_NAME + ' 画像診断', text,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // エディタから直接実行したときは UI が無い。ログに出ていれば十分
  }
  return text;
}

/**
 * 画像IDが空のまま登録されている行に、あとから写真を入れる。
 * Gemini は呼ばないので、APIの消費なしで直せる。
 *
 * 1回で全部やると6分の実行上限に当たるため、上限をつけて少しずつ進める。
 * 残りがあるときは、もう一度実行すれば続きから処理する。
 */
function refillImages() {
  var LIMIT = 15;
  var rows = Repo.readAll(C.SH.ZUKAN).filter(function (r) {
    return !String(r['画像ID'] || '').trim();
  });

  var done = 0, failed = [];
  rows.slice(0, LIMIT).forEach(function (r) {
    var nm = String(r['標準和名'] || '').trim();
    if (!nm) return;
    var img = null;
    try {
      img = Images.fetchFor(nm, nm);
    } catch (e) {
      console.warn('[取り直し] ' + nm + ' で例外: ' + e);
    }
    if (img) {
      Repo.updateById(C.SH.ZUKAN, r.creature_id, {
        '画像ID': img.fileId,
        '画像種別': img.kind,
        '画像クレジット': img.credit
      });
      done++;
    } else {
      failed.push(nm);
    }
  });

  try { CacheService.getScriptCache().remove('list'); } catch (e) { /* 無ければよい */ }

  var rest = Math.max(0, rows.length - LIMIT);
  var msg = '写真を入れ直しました：' + done + 'けん\n' +
            (failed.length ? '見つからなかった：' + failed.join('、') + '\n' : '') +
            (rest ? '\n残り ' + rest + 'けん あります。もう一度実行してください。'
                  : '\n画像が空の行はもうありません。');
  console.log(msg);
  try {
    SpreadsheetApp.getUi().alert(C.APP_NAME, msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* エディタから実行したときは UI が無い */ }
  return msg;
}

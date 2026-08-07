/**
 * Auth.gs
 * アクセスしたGoogleアカウントのメールをEnrollment（名簿）と突合し、
 * 教師/児童のロールを解決する。
 *
 * ウェブアプリは「自分（教師）として実行 / 組織内ユーザーがアクセス」でデプロイする前提。
 * 児童はスプレッドシートへの直接権限を持たず、アプリ経由でのみ読み書きする。
 *
 * 開発時のなりすまし:
 *   スクリプトプロパティ DEV_IMPERSONATE_EMAIL にメールを入れると、
 *   そのユーザーとしてログインした扱いになる（エディタからのテスト用）。本番では未設定にする。
 */

function getActiveEmail_() {
  var dev = PropertiesService.getScriptProperties().getProperty('DEV_IMPERSONATE_EMAIL');
  if (dev) return dev;
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  if (!email) { try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) {} }
  return email;
}

/**
 * 現在のアクセス者のコンテキストを返す。
 * { email, user:{userId,name,displayName,number}|null, role:'teacher'|'student'|null }
 */
function getContext() {
  var email = getActiveEmail_();
  var me = findUserByEmail_(email);
  var realRole = me ? me['役割'] : null;

  var ctx = {
    email: email,
    realUser: toUser_(me),
    realRole: realRole,
    user: toUser_(me),
    role: realRole,
    viewingUser: null,   // 「この子の画面を見る」で見ている児童
    readOnly: false
  };

  // 教師が児童の画面を見に行っているとき、以降のサーバー関数はその子として動く。
  // ただし読み取り専用。先生の操作がその子の足跡に混ざってはいけない。
  var seenId = getViewAs_(email);
  if (seenId && (realRole === C.ROLE.TEACHER || isDemoMode_())) {
    var target = firstWhere_(C.SH.USERS, { user_id: seenId });
    if (target && target['役割'] === C.ROLE.STUDENT) {
      ctx.user = toUser_(target);
      ctx.role = C.ROLE.STUDENT;
      ctx.viewingUser = toUser_(target);
      // ふだんは読み取り専用。デモモードのあいだだけ、その子として記録できる
      ctx.readOnly = !isDemoMode_();
    } else {
      clearViewAs_(email);   // 名簿から消えた等。見に行くのをやめる
    }
  }
  return ctx;
}

function findUserByEmail_(email) {
  if (!email) return null;
  var users = Repo.readAll(C.SH.USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]['email']).trim().toLowerCase() === email.trim().toLowerCase()) return users[i];
  }
  return null;
}

function toUser_(row) {
  return row ? {
    userId: row['user_id'],
    name: row['氏名'],
    displayName: row['表示名'] || row['氏名'],
    number: row['出席番号']
  } : null;
}

/* ------- 「この子の画面を見る」の状態 -------
 * ウェブアプリは「自分（＝デプロイした教師）として実行」なので、
 * UserProperties は全員で共有されてしまう（1人の設定が全児童に影響する）。
 * 実際にアクセスしている人のメールを鍵にして、スクリプトプロパティに持つ。
 */
function viewAsKey_(email) { return 'VIEW_AS::' + String(email || '').trim().toLowerCase(); }

function getViewAs_(email) {
  if (!email) return '';
  return PropertiesService.getScriptProperties().getProperty(viewAsKey_(email)) || '';
}

function setViewAs_(email, userId) {
  PropertiesService.getScriptProperties().setProperty(viewAsKey_(email), String(userId));
}

function clearViewAs_(email) {
  PropertiesService.getScriptProperties().deleteProperty(viewAsKey_(email));
}

/**
 * 教師でなければ例外。サーバー関数の入口で使う。
 *
 * デモモードのあいだは、名簿に載っている人なら誰でも通す。
 * 研修や説明会で1アカウントから両方の画面を見せるための緩和で、
 * 授業で使うときは必ずオフに戻すこと（メニューから切り替えられる）。
 */
function requireTeacher_() {
  var ctx = getContext();
  if (!ctx.realUser) {
    throw new Error('名簿に登録されていないアカウントです。担任の先生に連絡してください。');
  }
  // 児童の画面を見に行っている最中でも、先生の操作は本人の権限で判断する
  if (ctx.realRole !== C.ROLE.TEACHER && !isDemoMode_()) {
    throw new Error('この操作は教師のみが実行できます。');
  }
  return ctx;
}

/**
 * 書き込みを伴う児童の操作の入口。
 * 「この子の画面を見る」で見ているあいだは断る。
 * 先生がうっかり触った跡が、その子の学びの足跡に混ざらないようにする。
 */
function requireWritable_() {
  var ctx = requireUser_();
  // 見ているだけのときは断る（readOnly はデモモードでは立たない）
  if (ctx.readOnly) {
    throw new Error('いまは' + ctx.viewingUser.displayName + 'さんの画面を見ているだけです（読み取り専用）。記録はできません。');
  }
  return ctx;
}

/** 名簿に載っていなければ例外 */
function requireUser_() {
  var ctx = getContext();
  if (!ctx.user) {
    throw new Error('名簿に登録されていないアカウントです。担任の先生に連絡してください。');
  }
  return ctx;
}

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
  var me = null;
  if (email) {
    var users = Repo.readAll(C.SH.USERS);
    for (var i = 0; i < users.length; i++) {
      if (String(users[i]['email']).trim().toLowerCase() === email.trim().toLowerCase()) {
        me = users[i];
        break;
      }
    }
  }
  return {
    email: email,
    user: me ? {
      userId: me['user_id'],
      name: me['氏名'],
      displayName: me['表示名'] || me['氏名'],
      number: me['出席番号']
    } : null,
    role: me ? me['役割'] : null
  };
}

/** 教師でなければ例外。サーバー関数の入口で使う */
function requireTeacher_() {
  var ctx = getContext();
  if (!ctx.user || ctx.role !== C.ROLE.TEACHER) {
    throw new Error('この操作は教師のみが実行できます。');
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

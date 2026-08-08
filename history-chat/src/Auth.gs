/**
 * Auth.gs
 * だれが使っているかを名簿で判定する。
 *
 * 第1段階（教師デモ）では、名簿に載っているのは実行者本人だけでよい。
 * 第3段階で児童を名簿に入れると、そのまま児童として通る。
 */
var Auth = (function () {

  /** いま使っている人。名簿に無ければ null */
  function current() {
    var email = Session.getActiveUser().getEmail();
    if (!email) return null;
    var r = Repo.firstWhere(C.SHEET.USERS, { '端末アカウント': email });
    if (!r) return null;
    return {
      id: String(r.user_id),
      name: String(r['表示名'] || r['氏名'] || ''),
      role: String(r['役割'] || C.ROLE.STUDENT),
      email: email
    };
  }

  function requireUser() {
    var u = current();
    if (!u) throw new Error('この画面を使えるのは、名簿に登録された人だけです。');
    return u;
  }

  function requireTeacher() {
    var u = requireUser();
    if (u.role !== C.ROLE.TEACHER) throw new Error('先生だけが使える画面です。');
    return u;
  }

  function isTeacher(u) { return !!u && u.role === C.ROLE.TEACHER; }

  return { current: current, requireUser: requireUser, requireTeacher: requireTeacher, isTeacher: isTeacher };
})();

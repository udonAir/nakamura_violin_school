/* リトミック予約フォーム（限定公開ページ /rythmique/r7k2m9x4/ 専用） */
(function () {
  'use strict';

  var API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
  var COGNITO = 'https://cognito-idp.ap-northeast-1.amazonaws.com/';
  /* 保護者用 User Pool のクライアントID。
     cdk deploy の出力 GuardianUserPoolClientId をここに入れる。 */
  var CLIENT_ID = '2p03doec46lnt3leoha31nqf5v';

  var TRIAL_FORM_URL =
    'https://docs.google.com/forms/d/1D1GHXF9IeXEmMy0lBG19rGpgoC9d2AB9rEwnRlm72jE/viewform';

  var TICKET_PRICES = {
    age0_3: { 6: 12500, 7: 13000, 8: 13500 },
    age4_5: { 6: 17000, 7: 17500, 8: 18000 }
  };
  var SINGLE_PRICES = { age0_3: 2500, age4_5: 3000 };

  /* コースと時間枠の対応。0〜3歳は前半、4〜5歳は後半。
     ※変更時のコースまたぎは認めているので、日程変更の候補は絞らない。 */
  var PART_BY_AGE = { age0_3: 'first', age4_5: 'second' };

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var ID_KEY = 'nv_guardian_id';
  var REFRESH_KEY = 'nv_guardian_refresh';

  var auth = { idToken: null, email: '', signupEmail: '', signupPass: '' };

  var state = {
    allSlots: [],
    slots: [],
    selected: [],
    ageClass: 'age0_3',
    purchaseType: 'ticket',
    ticketType: 6,
    startMonth: '',
    validFrom: '',
    validTo: '',
    useMakeup: false,
    options: [],
    children: [],
    makeup: null,
    editingChildId: '',
    addingChild: false,
    pendingQr: ''
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var formatYen = function (n) { return Number(n).toLocaleString('ja-JP') + '円'; };

  function todayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function formatDateJa(date) {
    var d = new Date(date + 'T00:00:00+09:00');
    return (
      Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日（' +
      WEEKDAYS[d.getDay()] + '）'
    );
  }

  function needCount() {
    return state.ticketType + (state.useMakeup ? 1 : 0);
  }

  /* 振替でつく1回は無料。金額は券種だけで決まる。 */
  function priceOf(purchaseType, ageClass, ticketType) {
    return purchaseType === 'single'
      ? SINGLE_PRICES[ageClass] * ticketType
      : TICKET_PRICES[ageClass][ticketType];
  }

  /* ===== Cognito ===== */

  function cognito(target, payload) {
    return fetch(COGNITO, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.' + target
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(translateAuthError(data.message || ''));
        return data;
      });
    });
  }

  function translateAuthError(msg) {
    if (/Incorrect username or password|User does not exist/.test(msg)) {
      return 'メールアドレスまたはパスワードが違います。';
    }
    if (/already exists/.test(msg)) return 'このメールアドレスはすでに登録されています。ログインしてください。';
    if (/Invalid verification code/.test(msg)) return '確認コードが違います。';
    // 確認済みのアドレスで登録し直そうとした場合。Cognitoは
    // 「User cannot be confirmed. Current status is CONFIRMED」を返す。
    if (/already confirmed|Current status is CONFIRMED/.test(msg)) {
      return 'すでにご登録が完了しています。「ログイン」からお進みください。';
    }
    if (/Invalid code provided|ExpiredCode/.test(msg)) return '確認コードが違うか、有効期限が切れています。';
    if (/Password did not conform/.test(msg)) return 'パスワードは8文字以上で、英字と数字を含めてください。';
    if (/Attempt limit exceeded/.test(msg)) return '回数の上限に達しました。しばらく時間をおいてお試しください。';
    return msg || 'エラーが発生しました。';
  }

  /** IDトークンの中身を読む。署名の検証はサーバー側が行うので、ここは表示用。 */
  function claims(token) {
    try {
      var body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(body))));
    } catch (e) {
      return {};
    }
  }

  function saveTokens(r) {
    auth.idToken = r.IdToken;
    auth.email = claims(r.IdToken).email || '';
    try {
      sessionStorage.setItem(ID_KEY, r.IdToken);
      if (r.RefreshToken) localStorage.setItem(REFRESH_KEY, r.RefreshToken);
    } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  function logout() {
    auth.idToken = null;
    try {
      sessionStorage.removeItem(ID_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch (e) { /* 無視 */ }
    location.href = location.pathname;
  }

  function expired(token) {
    var exp = claims(token).exp;
    return !exp || exp * 1000 < Date.now() + 60000;
  }

  /** 保存してあるトークンでログイン状態を復帰する */
  function restoreSession() {
    var saved = null;
    var refresh = null;
    try {
      saved = sessionStorage.getItem(ID_KEY);
      refresh = localStorage.getItem(REFRESH_KEY);
    } catch (e) { /* 無視 */ }

    if (saved && !expired(saved)) {
      auth.idToken = saved;
      auth.email = claims(saved).email || '';
      return Promise.resolve(true);
    }
    if (!refresh) return Promise.resolve(false);

    return cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refresh }
    })
      .then(function (r) { saveTokens(r.AuthenticationResult); return true; })
      .catch(function () {
        try { localStorage.removeItem(REFRESH_KEY); } catch (e) { /* 無視 */ }
        return false;
      });
  }

  /* ===== API ===== */

  function api(path, options) {
    var opt = options || {};
    opt.headers = opt.headers || {};
    if (auth.idToken) opt.headers.authorization = auth.idToken;
    if (opt.body) opt.headers['content-type'] = 'application/json';

    return fetch(API_BASE + path, opt).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        // 期限切れの可能性があるので、一度だけ復帰を試してから諦める
        return restoreSession().then(function (ok) {
          if (!ok) {
            showAuth();
            throw new Error('ログインの有効期限が切れました。もう一度ログインしてください。');
          }
          opt.headers.authorization = auth.idToken;
          return fetch(API_BASE + path, opt).then(readJson);
        });
      }
      return readJson(res);
    });
  }

  function readJson(res) {
    return res.json().then(function (data) {
      if (!res.ok) {
        var err = new Error(data.message || '処理に失敗しました。');
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  /* ===== 画面の切り替え ===== */

  function show(id) {
    ['bk-auth', 'bk-app', 'bk-attend'].forEach(function (x) {
      $('#' + x).hidden = x !== id;
    });
  }

  function showAuth() { show('bk-auth'); }

  function showPane(id) {
    ['bk-mypage', 'bk-detail', 'bk-form-section', 'bk-receipt'].forEach(function (x) {
      $('#' + x).hidden = x !== id;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ===== マイページ ===== */

  function loadMyPage() {
    show('bk-app');
    showPane('bk-mypage');
    $('#bk-user-email').textContent = auth.email;

    var box = $('#bk-tickets');
    box.textContent = '読み込んでいます…';

    api('/me')
      .then(function (d) {
        state.children = d.children || [];
        state.makeup = d.makeup;
        renderChildren();
        renderMakeup(d.makeup);
        renderTickets(d.tickets || []);
      })
      .catch(function (e) { box.textContent = e.message; });
  }

  /* ===== お子様の登録（顧客マスタ） ===== */

  /** 登録できるお子様の人数。サーバー側（children.ts）と揃えること。 */
  var MAX_CHILDREN = 5;

  /* ふりがなはひらがなと長音符のみ。サーバー側の KANA_RE と揃えること。
     カタカナや漢字が混ざると五十音順の並べ替えが崩れる。 */
  var KANA_RE = /^[ぁ-んー]{1,25}$/;

  /**
   * お子様の登録フォームを出すかどうか。
   *
   * 1人目がまだのときと、修正中のときだけ開く。登録が済んだら畳んで
   * 「兄弟姉妹を登録する」ボタンに変える。出しっぱなしにすると
   * 「まだ入力しなければいけない」と読めて手が止まる。
   */
  function syncChildForm() {
    var editing = !!state.editingChildId;
    var empty = state.children.length === 0;
    var open = editing || empty || state.addingChild;

    $('#bk-child-form').hidden = !open;
    $('#bk-child-add').hidden = open || state.children.length >= MAX_CHILDREN;
  }

  function renderChildren() {
    var box = $('#bk-children');
    box.innerHTML = '';

    if (state.children.length === 0) {
      box.innerHTML = '<p class="bk-hint">まだ登録がありません。下のフォームからご登録ください。</p>';
      syncChildForm();
      return;
    }

    state.children.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'bk-child-row';

      var name = document.createElement('span');
      name.className = 'bk-child-name';
      name.textContent = c.childName;
      row.appendChild(name);

      var birth = document.createElement('span');
      birth.className = 'bk-child-birth';
      birth.textContent = c.birthDate;
      row.appendChild(birth);

      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-outline btn-sm';
      edit.textContent = '修正';
      edit.addEventListener('click', function () { startEditChild(c); });
      row.appendChild(edit);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'bk-linkbtn bk-linkbtn--danger';
      del.textContent = '削除';
      del.addEventListener('click', function () { removeChild(c); });
      row.appendChild(del);

      box.appendChild(row);
    });

    syncChildForm();
  }

  function startEditChild(c) {
    state.editingChildId = c.childId;
    state.addingChild = false;
    // 古い登録には姓・名が別れて入っていないので、氏名を空白で割って充てる
    var parts = splitName(c);
    $('#bk-child-family').value = parts[0];
    $('#bk-child-given').value = parts[1];
    $('#bk-child-family-kana').value = c.familyKana || '';
    $('#bk-child-given-kana').value = c.givenKana || '';
    $('#bk-child-birth').value = c.birthDate;
    $('#bk-child-save').textContent = 'この内容に修正する';
    $('#bk-child-cancel').hidden = false;
    syncChildForm();
    $('#bk-child-family').focus();
  }

  /**
   * お子様の登録を削除する。
   * 有効なお申込みが残っている場合はサーバーが409で拒む（枠の予約が宙に浮くため）。
   */
  function removeChild(c) {
    if (!window.confirm(c.childName + ' さんの登録を削除します。よろしいですか。')) return;

    api('/me/children/' + encodeURIComponent(c.childId), { method: 'DELETE' })
      .then(function () {
        if (state.editingChildId === c.childId) resetChildForm();
        loadMyPage();
      })
      .catch(function (e) { window.alert(e.message); });
  }

  function splitName(c) {
    if (c.familyName || c.givenName) return [c.familyName || '', c.givenName || ''];
    var m = String(c.childName || '').split(/[\s　]+/);
    return [m[0] || '', m.slice(1).join(' ')];
  }

  /** 「兄弟姉妹を登録する」を押したとき */
  function startAddChild() {
    state.editingChildId = '';
    state.addingChild = true;
    clearChildFields();
    syncChildForm();
    $('#bk-child-family').focus();
  }

  function clearChildFields() {
    $('#bk-child-family').value = '';
    $('#bk-child-given').value = '';
    $('#bk-child-family-kana').value = '';
    $('#bk-child-given-kana').value = '';
    $('#bk-child-birth').value = '';
    $('#bk-child-error').textContent = '';
    $('#bk-child-save').textContent = 'この内容で登録する';
    $('#bk-child-cancel').hidden = true;
  }

  function resetChildForm() {
    state.editingChildId = '';
    state.addingChild = false;
    clearChildFields();
    syncChildForm();
  }

  function onChildSubmit(e) {
    e.preventDefault();
    var err = $('#bk-child-error');
    var btn = $('#bk-child-save');
    err.textContent = '';

    var family = $('#bk-child-family').value.trim();
    var given = $('#bk-child-given').value.trim();
    var familyKana = $('#bk-child-family-kana').value.trim();
    var givenKana = $('#bk-child-given-kana').value.trim();
    var birth = $('#bk-child-birth').value;
    if (!family) { err.textContent = 'お子様の姓を入力してください。'; return; }
    if (!given) { err.textContent = 'お子様の名を入力してください。'; return; }
    if (!KANA_RE.test(familyKana)) {
      err.textContent = 'せいは、ひらがなで入力してください。';
      return;
    }
    if (!KANA_RE.test(givenKana)) {
      err.textContent = 'めいは、ひらがなで入力してください。';
      return;
    }
    if (!birth) { err.textContent = 'お子様の生年月日を入力してください。'; return; }

    btn.disabled = true;
    var editing = state.editingChildId;
    var payload = JSON.stringify({
      familyName: family,
      givenName: given,
      familyKana: familyKana,
      givenKana: givenKana,
      birthDate: birth
    });
    var req = editing
      ? api('/me/children/' + encodeURIComponent(editing), { method: 'PATCH', body: payload })
      : api('/me/children', { method: 'POST', body: payload });

    req
      .then(function () {
        resetChildForm();
        loadMyPage();
      })
      .catch(function (e2) { err.textContent = e2.message; })
      .then(function () { btn.disabled = false; });
  }

  /* ===== 振替・申込一覧 ===== */

  function renderMakeup(m) {
    var box = $('#bk-makeup');
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = '振替が1回分あります';
    var p = document.createElement('p');
    p.textContent =
      formatDateJa(m.expiresAt) + 'まで有効です。次の回数券をお申込みの際に、' +
      '1回分を追加でお選びいただけます（追加料金はかかりません）。';
    box.appendChild(strong);
    box.appendChild(p);
  }

  function renderTickets(tickets) {
    var box = $('#bk-tickets');
    box.innerHTML = '';

    var live = tickets.filter(function (t) { return t.status !== 'cancelled'; });
    if (live.length === 0) {
      box.innerHTML = '<p class="bk-hint">まだお申込みはありません。</p>';
      return;
    }

    live.forEach(function (t) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'bk-ticket-card';

      var head = document.createElement('div');
      head.className = 'bk-ticket-head';
      var name = document.createElement('strong');
      name.textContent = t.childName;
      var plan = document.createElement('span');
      plan.textContent =
        (t.purchaseType === 'single' ? '単発 ' + t.ticketType + '回' : t.ticketType + '回券') +
        (t.usedMakeup ? '＋振替1回' : '');
      head.appendChild(name);
      head.appendChild(plan);
      card.appendChild(head);

      var period = document.createElement('div');
      period.className = 'bk-ticket-sub';
      period.textContent = t.validFrom + ' 〜 ' + t.validTo;
      card.appendChild(period);

      var dates = document.createElement('div');
      dates.className = 'ad-dates';
      (t.dates || []).forEach(function (d) {
        var s = document.createElement('span');
        s.className = 'ad-date';
        s.textContent = formatDateJa(d);
        dates.appendChild(s);
      });
      card.appendChild(dates);

      card.addEventListener('click', function () { openDetail(t.ticketId); });
      box.appendChild(card);
    });
  }

  /* ===== 申込の詳細・変更 ===== */

  var detail = { ticket: null };
  var planState = null;

  function openDetail(ticketId) {
    showPane('bk-detail');
    var box = $('#bk-detail-body');
    box.textContent = '読み込んでいます…';

    api('/tickets/' + encodeURIComponent(ticketId))
      .then(function (t) {
        detail.ticket = t;
        state.validFrom = t.validFrom;
        state.validTo = t.validTo;
        return loadSlotRange(t.validFrom, t.validTo);
      })
      .then(renderDetail)
      .catch(function (e) { box.textContent = e.message; });
  }

  function loadSlotRange(from, to) {
    return fetch(API_BASE + '/slots?from=' + from.slice(0, 7) + '&to=' + to.slice(0, 7))
      .then(function (res) { return res.ok ? res.json() : { slots: [] }; })
      .then(function (data) {
        state.allSlots = (data.slots || []).filter(function (s) {
          return s.date >= from && s.date <= to;
        });
      });
  }

  var RES_LABEL = {
    attended: '出席',
    absent: '欠席',
    cancelled: '取消',
    scheduled: '予定'
  };

  function renderDetail() {
    var t = detail.ticket;
    var box = $('#bk-detail-body');
    var today = todayJst();
    box.innerHTML = '';

    var dl = document.createElement('dl');
    dl.className = 'bk-receipt-list';
    [
      ['お名前', t.childName],
      ['コース', t.ageClass === 'age4_5' ? '4〜5歳コース' : '0〜3歳コース'],
      ['内容', (t.purchaseType === 'single' ? '単発 ' + t.ticketType + '回' : t.ticketType + '回券') +
        (t.usedMakeup ? '（振替1回を含む）' : '')],
      ['お支払い金額', formatYen(t.amount)],
      ['有効期間', t.validFrom + ' 〜 ' + t.validTo]
    ].forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.textContent = r[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    box.appendChild(dl);

    var h = document.createElement('h3');
    h.className = 'bk-subhead';
    h.textContent = '参加予定日';
    box.appendChild(h);

    var list = document.createElement('div');
    list.className = 'bk-res-list';
    t.reservations.forEach(function (r) { list.appendChild(renderReservation(r, today)); });
    box.appendChild(list);

    var note = document.createElement('p');
    note.className = 'bk-hint';
    note.textContent =
      '※当日および過去の回は、こちらからは変更できません。お急ぎの場合は教室までご連絡ください。';
    box.appendChild(note);

    // 回数・コースの変更は初回レッスンの前日まで
    if (t.firstLessonDate && today < t.firstLessonDate) {
      var planBtn = document.createElement('button');
      planBtn.type = 'button';
      planBtn.className = 'btn btn-outline';
      planBtn.textContent = '回数を変更する';
      planBtn.addEventListener('click', openPlanEditor);
      box.appendChild(planBtn);
    } else {
      var closed = document.createElement('p');
      closed.className = 'bk-hint';
      closed.textContent = '※初回レッスンの前日を過ぎているため、回数・コースの変更はできません。';
      box.appendChild(closed);
    }

    var editor = document.createElement('div');
    editor.id = 'bk-editor';
    box.appendChild(editor);
  }

  function renderReservation(r, today) {
    var row = document.createElement('div');
    row.className = 'bk-res';

    var label = document.createElement('span');
    label.className = 'bk-res-date';
    label.textContent = r.date.slice(0, 4) + '年' + formatDateJa(r.date);
    row.appendChild(label);

    var st = document.createElement('span');
    st.className = 'bk-res-status bk-res-status--' + r.status;
    st.textContent = RES_LABEL[r.status] || r.status;
    row.appendChild(st);

    // 変更できるのは、まだ来ていない「予定」の回だけ
    if (r.status !== 'scheduled' || r.date <= today) return row;

    var acts = document.createElement('span');
    acts.className = 'bk-res-acts';

    var chg = document.createElement('button');
    chg.type = 'button';
    chg.className = 'btn btn-outline btn-sm';
    chg.textContent = '日を変更';
    chg.addEventListener('click', function () { openDayChange(r); });
    acts.appendChild(chg);

    // 振替は1人1回まで。すでに持っているときは出さない。
    if (!state.makeup) {
      var mk = document.createElement('button');
      mk.type = 'button';
      mk.className = 'btn btn-outline btn-sm';
      mk.textContent = '振替にまわす';
      mk.addEventListener('click', function () { toMakeup(r); });
      acts.appendChild(mk);
    }

    row.appendChild(acts);
    return row;
  }

  /** 1日だけ差し替える */
  function openDayChange(r) {
    var today = todayJst();
    var taken = detail.ticket.reservations.map(function (x) { return x.slotId; });

    // コースをまたぐ変更も認めているので、時間枠では絞らない
    var candidates = state.allSlots.filter(function (s) {
      return s.status === 'open' && !s.full && s.date > today && taken.indexOf(s.slotId) < 0;
    });

    var editor = $('#bk-editor');
    editor.innerHTML = '';

    var h = document.createElement('h3');
    h.className = 'bk-subhead';
    h.textContent = formatDateJa(r.date) + ' の変更先をお選びください';
    editor.appendChild(h);

    if (candidates.length === 0) {
      var none = document.createElement('p');
      none.className = 'bk-hint';
      none.textContent =
        'この期間に空いている開講日がありません。「振替にまわす」を押すと、' +
        '次の回数券をお申込みの際に1回分を追加できます。';
      editor.appendChild(none);
      return;
    }

    var sel = document.createElement('select');
    sel.className = 'bk-select';
    candidates.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.slotId;
      o.textContent =
        formatDateJa(s.date) + ' ' + s.startTime + '〜' + s.endTime +
        '（' + (s.part === 'first' ? '0〜3歳' : '4〜5歳') + '・残' + s.remaining + '）';
      sel.appendChild(o);
    });
    editor.appendChild(sel);

    var err = document.createElement('p');
    err.className = 'bk-error';
    editor.appendChild(err);

    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn-primary';
    go.textContent = 'この日に変更する';
    go.addEventListener('click', function () {
      go.disabled = true;
      go.textContent = '変更しています…';
      api('/tickets/' + encodeURIComponent(detail.ticket.ticketId) + '/change', {
        method: 'POST',
        body: JSON.stringify({ fromSlotId: r.slotId, toSlotId: sel.value })
      })
        .then(function () { openDetail(detail.ticket.ticketId); })
        .catch(function (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.textContent = 'この日に変更する';
        });
    });
    editor.appendChild(go);
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** 振替にまわす */
  function toMakeup(r) {
    var ok = window.confirm(
      formatDateJa(r.date) + ' の回を振替にまわします。\n' +
      'この回のご予約は取り消され、次の回数券をお申込みの際に1回分を追加できます。\n' +
      '振替はお一人1回までです。よろしいですか？'
    );
    if (!ok) return;

    api('/tickets/' + encodeURIComponent(detail.ticket.ticketId) + '/makeup', {
      method: 'POST',
      body: JSON.stringify({ slotId: r.slotId })
    })
      .then(function (d) {
        state.makeup = { expiresAt: d.expiresAt };
        window.alert('振替にまわしました。' + formatDateJa(d.expiresAt) + 'まで有効です。');
        openDetail(detail.ticket.ticketId);
      })
      .catch(function (e) { window.alert(e.message); });
  }

  /* ===== 回数の変更 ===== */

  function openPlanEditor() {
    var t = detail.ticket;
    var today = todayJst();
    var editor = $('#bk-editor');

    planState = {
      selected: t.reservations.map(function (r) { return r.slotId; }),
      // 済んだ回・出欠が確定した回は外せない
      locked: t.reservations
        .filter(function (r) { return r.date <= today || r.status !== 'scheduled'; })
        .map(function (r) { return r.slotId; }),
      ticketType: t.ticketType,
      extra: t.usedMakeup ? 1 : 0,
      purchaseType: t.purchaseType,
      ageClass: t.ageClass
    };

    editor.innerHTML =
      '<h3 class="bk-subhead">回数と参加予定日</h3>' +
      '<div class="bk-field"><label for="bk-edit-type">回数</label>' +
      '<select id="bk-edit-type" class="bk-select"></select></div>' +
      '<div class="bk-summary"><span>選択中 <strong id="bk-edit-count"></strong></span>' +
      '<span>お支払い予定 <strong id="bk-edit-amount"></strong></span></div>' +
      '<p class="bk-pay-note">お支払いは初回レッスン時に現金でお支払いをお願いします</p>' +
      '<p id="bk-edit-select-msg" class="bk-select-msg"></p>' +
      '<div id="bk-edit-calendar"></div>' +
      '<p class="bk-cal-legend">★ … 育児のお悩み相談会はお休みの日<br>' +
      '※コース（時間帯）をまたいでお選びいただけます。</p>' +
      '<p id="bk-edit-error" class="bk-error" role="alert"></p>' +
      '<button type="button" id="bk-edit-submit" class="btn btn-primary">この内容に変更する</button>';

    var sel = $('#bk-edit-type');
    var options = t.purchaseType === 'single' ? [1, 2, 3] : [6, 7, 8];
    options.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = t.purchaseType === 'single' ? n + '回' : n + '回券';
      if (n === t.ticketType) o.selected = true;
      sel.appendChild(o);
    });

    sel.addEventListener('change', function () {
      planState.ticketType = Number(this.value);
      var need = planState.ticketType + planState.extra;
      if (planState.selected.length > need) {
        var keep = planState.locked.slice();
        planState.selected.forEach(function (id) {
          if (keep.length < need && keep.indexOf(id) < 0) keep.push(id);
        });
        planState.selected = keep;
      }
      renderPlanCalendar();
    });

    $('#bk-edit-submit').addEventListener('click', submitPlan);
    renderPlanCalendar();
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderPlanCalendar() {
    var today = todayJst();
    var wrap = $('#bk-edit-calendar');
    wrap.innerHTML = '';

    var usable = state.allSlots.filter(function (s) {
      if (planState.selected.indexOf(s.slotId) >= 0) return true;
      return s.status === 'open' && !s.full && s.date > today;
    });

    monthsBetween(state.validFrom, state.validTo).forEach(function (month) {
      wrap.appendChild(
        renderMonth(month, usable, planState.selected, planState.locked, onPlanToggle)
      );
    });

    var need = planState.ticketType + planState.extra;
    var got = planState.selected.length;
    $('#bk-edit-count').textContent = got + ' / ' + need + ' 日';
    $('#bk-edit-amount').textContent =
      formatYen(priceOf(planState.purchaseType, planState.ageClass, planState.ticketType));

    var msg = $('#bk-edit-select-msg');
    if (got < need) {
      msg.textContent = 'あと' + (need - got) + '日、参加予定日をお選びください。';
      msg.className = 'bk-select-msg';
    } else if (got > need) {
      msg.textContent = (got - need) + '日、多く選ばれています。';
      msg.className = 'bk-select-msg';
    } else {
      msg.textContent = '参加予定日の選択が完了しました。';
      msg.className = 'bk-select-msg bk-select-msg--done';
    }
    $('#bk-edit-submit').disabled = got !== need;
  }

  function onPlanToggle(slot) {
    if (planState.locked.indexOf(slot.slotId) >= 0) return;
    var need = planState.ticketType + planState.extra;
    var i = planState.selected.indexOf(slot.slotId);
    if (i >= 0) {
      planState.selected.splice(i, 1);
    } else {
      if (planState.selected.length >= need) return;
      planState.selected.push(slot.slotId);
    }
    renderPlanCalendar();
  }

  function submitPlan() {
    var btn = $('#bk-edit-submit');
    var err = $('#bk-edit-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = '変更しています…';

    api('/tickets/' + encodeURIComponent(detail.ticket.ticketId) + '/plan', {
      method: 'POST',
      body: JSON.stringify({ ticketType: planState.ticketType, slotIds: planState.selected })
    })
      .then(function () { openDetail(detail.ticket.ticketId); })
      .catch(function (e) {
        err.textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'この内容に変更する';
      });
  }

  /* ===== カレンダーの共通描画 ===== */

  function monthsBetween(from, to) {
    var months = [];
    if (!from || !to) return months;
    var y = Number(from.slice(0, 4));
    var m = Number(from.slice(5, 7));
    var end = to.slice(0, 7);
    // 条件が壊れても止まらないよう上限を設ける
    for (var i = 0; i < 24; i++) {
      var cur = y + '-' + pad(m);
      months.push(cur);
      if (cur === end) break;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return months;
  }

  function renderMonth(month, slots, selected, locked, onToggle) {
    var year = Number(month.slice(0, 4));
    var mon = Number(month.slice(5, 7));

    var box = document.createElement('div');
    box.className = 'bk-cal';

    var title = document.createElement('div');
    title.className = 'bk-cal-title';
    title.textContent = year + '年 ' + mon + '月';
    box.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'bk-cal-grid';

    WEEKDAYS.forEach(function (w, i) {
      var head = document.createElement('div');
      head.className = 'bk-cal-wd';
      if (i === 0) head.classList.add('bk-cal-wd--sun');
      if (i === 6) head.classList.add('bk-cal-wd--sat');
      head.textContent = w;
      grid.appendChild(head);
    });

    var first = new Date(year, mon - 1, 1);
    var lastDay = new Date(year, mon, 0).getDate();

    for (var b = 0; b < first.getDay(); b++) {
      var blank = document.createElement('div');
      blank.className = 'bk-cal-cell bk-cal-cell--blank';
      grid.appendChild(blank);
    }

    for (var d = 1; d <= lastDay; d++) {
      var date = year + '-' + pad(mon) + '-' + pad(d);
      grid.appendChild(renderDay(date, d, slots, selected, locked, onToggle));
    }

    box.appendChild(grid);
    return box;
  }

  function renderDay(date, dayNum, slots, selected, locked, onToggle) {
    var daySlots = slots.filter(function (s) { return s.date === date; });

    if (daySlots.length === 0) {
      var cell = document.createElement('div');
      cell.className = 'bk-cal-cell bk-cal-cell--off';
      cell.textContent = dayNum;
      return cell;
    }

    // 1日に複数の枠があるときは、選んでいるものを優先して表示する
    var slot = daySlots.filter(function (s) { return selected.indexOf(s.slotId) >= 0; })[0]
      || daySlots[0];

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bk-cal-cell bk-cal-day';
    btn.dataset.slotId = slot.slotId;

    var on = selected.indexOf(slot.slotId) >= 0;
    var isLocked = !!(locked && locked.indexOf(slot.slotId) >= 0);
    btn.classList.toggle('bk-cal-day--on', on);
    btn.classList.toggle('bk-cal-day--locked', isLocked);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');

    var num = document.createElement('span');
    num.className = 'bk-cal-num';
    num.textContent = dayNum;
    btn.appendChild(num);

    var meta = document.createElement('span');
    meta.className = 'bk-cal-meta';
    if (slot.full && !on) {
      meta.textContent = '満席';
      btn.disabled = true;
      btn.classList.add('bk-cal-day--full');
    } else {
      meta.textContent = '残' + slot.remaining;
    }
    btn.appendChild(meta);

    var label = date + ' ' + slot.startTime + '〜' + slot.endTime;
    if (slot.counselorAbsent) {
      var mark = document.createElement('span');
      mark.className = 'bk-cal-mark';
      mark.textContent = '★';
      btn.appendChild(mark);
      label += '（育児相談会はお休み）';
    }
    btn.setAttribute('aria-label', label);

    if (isLocked) btn.disabled = true;
    btn.addEventListener('click', function () { onToggle(slot); });
    return btn;
  }

  /* ===== 新規申込 ===== */

  function openForm() {
    if (state.children.length === 0) {
      window.alert('先にお子様をご登録ください。');
      $('#bk-child-family').focus();
      return;
    }

    showPane('bk-form-section');
    state.selected = [];
    state.useMakeup = false;

    var sel = $('#bk-child-select');
    sel.innerHTML = '';
    state.children.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.childId;
      o.textContent = c.childName + '（' + c.birthDate + '）';
      sel.appendChild(o);
    });

    var row = $('#bk-makeup-row');
    if (state.makeup) {
      row.hidden = false;
      $('#bk-use-makeup').checked = false;
      $('#bk-makeup-label').textContent =
        '振替の1回分を使う（' + formatDateJa(state.makeup.expiresAt) + 'まで有効・追加料金なし）';
    } else {
      row.hidden = true;
    }

    loadPurchaseOptions();
  }

  function loadPurchaseOptions() {
    var status = $('#bk-calendar-status');
    status.textContent = '開講日を読み込んでいます…';

    fetch(API_BASE + '/purchase-options')
      .then(function (res) { return res.json(); })
      .then(function (d) {
        state.options = d.months || [];
        var sel = $('#bk-start-month');
        sel.innerHTML = '';
        state.options.forEach(function (m) {
          var o = document.createElement('option');
          o.value = m.month;
          o.textContent = Number(m.month.slice(0, 4)) + '年' + Number(m.month.slice(5, 7)) + '月から';
          sel.appendChild(o);
        });
        if (state.options.length === 0) {
          status.textContent = 'ご予約可能な開講日がありません。教室までお問い合わせください。';
          return;
        }
        sel.value = state.options[0].month;
        onStartMonthChange();
      })
      .catch(function () {
        status.textContent =
          '開講日を読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。';
      });
  }

  function currentOption() {
    for (var i = 0; i < state.options.length; i++) {
      if (state.options[i].month === state.startMonth) return state.options[i];
    }
    return null;
  }

  function onStartMonthChange() {
    state.startMonth = $('#bk-start-month').value;
    var opt = currentOption();
    if (!opt) return;

    state.validFrom = opt.validFrom;
    state.validTo = opt.validTo;
    state.selected = [];

    $('#bk-period').textContent =
      Number(opt.validFrom.slice(5, 7)) + '月 〜 ' + Number(opt.validTo.slice(5, 7)) + '月';

    // 月の途中から買うと、有効期間内でも過ぎた開講日は選べない。
    // 回数分そろわない場合は単発をご案内する。
    var part = PART_BY_AGE[state.ageClass];
    var avail = part === 'first' ? opt.available.first : opt.available.second;
    var hint = $('#bk-start-hint');
    if (avail < needCount()) {
      hint.textContent =
        'この開始月で、これからお選びいただける開講日は残り' + avail + '日です。' +
        '回数に足りない場合は、開始月を先にするか単発レッスンをご利用ください。';
      hint.className = 'bk-hint bk-hint--warn';
    } else {
      hint.textContent = 'この開始月でお選びいただける開講日は残り' + avail + '日です。';
      hint.className = 'bk-hint';
    }

    loadFormSlots();
  }

  function loadFormSlots() {
    var status = $('#bk-calendar-status');
    status.textContent = '開講日を読み込んでいます…';

    loadSlotRange(state.validFrom, state.validTo)
      .then(function () {
        status.textContent = '';
        applyAgeClass();
      })
      .catch(function () {
        status.textContent = '開講日を読み込めませんでした。ページを再読み込みしてください。';
      });
  }

  /** 選択中のコースに対応する時間枠だけを表示対象にする（新規申込のみ） */
  function applyAgeClass() {
    var today = todayJst();
    var part = PART_BY_AGE[state.ageClass];
    state.slots = state.allSlots.filter(function (s) {
      return s.part === part && s.status === 'open' && s.date > today;
    });

    var sample = state.slots[0];
    $('#bk-time').textContent = sample
      ? sample.startTime + '〜' + sample.endTime + '（60分）'
      : '—';

    state.selected = [];
    renderFormCalendar();
  }

  function renderFormCalendar() {
    var wrap = $('#bk-calendar');
    wrap.innerHTML = '';

    if (state.slots.length === 0) {
      $('#bk-calendar-status').textContent =
        'この期間にご予約可能な開講日がありません。開始月を変えてお試しください。';
      updateFormUI();
      return;
    }

    monthsBetween(state.validFrom, state.validTo).forEach(function (month) {
      wrap.appendChild(renderMonth(month, state.slots, state.selected, [], onFormToggle));
    });
    updateFormUI();
  }

  function onFormToggle(slot) {
    var i = state.selected.indexOf(slot.slotId);
    if (i >= 0) {
      state.selected.splice(i, 1);
    } else {
      if (state.selected.length >= needCount()) return;
      state.selected.push(slot.slotId);
    }
    renderFormCalendar();
  }

  function updateFormUI() {
    var need = needCount();
    var got = state.selected.length;

    $('#bk-count').textContent = got + ' / ' + need + ' 日';
    $('#bk-amount').textContent =
      formatYen(priceOf(state.purchaseType, state.ageClass, state.ticketType));

    var msg = $('#bk-select-msg');
    if (got < need) {
      msg.textContent = 'あと' + (need - got) + '日、参加予定日をお選びください。';
      msg.className = 'bk-select-msg';
    } else {
      msg.textContent = '参加予定日の選択が完了しました。';
      msg.className = 'bk-select-msg bk-select-msg--done';
    }

    $('#bk-submit').disabled = got !== need;
  }

  function resetSelection() {
    state.selected = [];
    renderFormCalendar();
  }

  function onPurchaseTypeChange() {
    state.purchaseType = $('input[name=purchaseType]:checked').value;
    var isSingle = state.purchaseType === 'single';
    $('#bk-ticket-type-row').hidden = isSingle;
    $('#bk-single-count-row').hidden = !isSingle;
    // 振替は回数券のときだけ使える
    $('#bk-makeup-row').hidden = isSingle || !state.makeup;
    if (isSingle) {
      $('#bk-use-makeup').checked = false;
      state.useMakeup = false;
    }
    state.ticketType = isSingle
      ? Number($('#bk-single-count').value)
      : Number($('input[name=ticketType]:checked').value);
    resetSelection();
  }

  function onSubmit(e) {
    e.preventDefault();

    var errorBox = $('#bk-error');
    var childId = $('#bk-child-select').value;
    if (!childId) {
      errorBox.textContent = 'お通いになるお子様をお選びください。';
      return;
    }

    var btn = $('#bk-submit');
    errorBox.textContent = '';
    btn.disabled = true;
    btn.textContent = '送信中…';

    api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        childId: childId,
        ageClass: state.ageClass,
        purchaseType: state.purchaseType,
        ticketType: state.ticketType,
        startMonth: state.startMonth,
        useMakeup: state.useMakeup,
        slotIds: state.selected,
        note: $('#bk-note').value
      })
    })
      .then(showReceipt)
      .catch(function (err) {
        errorBox.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'この内容で申し込む';
        if (err.status === 409) { resetSelection(); loadFormSlots(); }
      });
  }

  function showReceipt(data) {
    showPane('bk-receipt');

    $('#bk-receipt-amount').textContent = formatYen(data.amount);
    $('#bk-receipt-period').textContent = data.validFrom + ' 〜 ' + data.validTo;

    var ul = $('#bk-receipt-dates');
    ul.innerHTML = '';
    (data.dates || []).forEach(function (d) {
      var li = document.createElement('li');
      li.textContent = d.slice(0, 4) + '年' + formatDateJa(d);
      ul.appendChild(li);
    });

    // 振替を使っていれば消費済み
    if (data.usedMakeup) state.makeup = null;

    var btn = $('#bk-submit');
    btn.disabled = false;
    btn.textContent = 'この内容で申し込む';
  }

  /* ===== 出席（QRから来たとき） ===== */

  function showAttendance(token) {
    show('bk-attend');
    var box = $('#bk-attend-body');
    box.innerHTML = '';

    var msg = document.createElement('p');
    msg.className = 'bk-select-msg';
    msg.textContent = 'ボタンを押すと、本日の出席が記録されます。';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-primary--lg';
    btn.textContent = '出席';

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = '送信中…';
      api('/attendance', { method: 'POST', body: JSON.stringify({ qrToken: token }) })
        .then(function (d) {
          box.innerHTML = '';
          var done = document.createElement('p');
          done.className = 'bk-select-msg bk-select-msg--done';
          done.textContent = d.alreadyDone
            ? '本日の出席はすでに記録されています。'
            : '出席を記録しました。ありがとうございます。';
          box.appendChild(done);
          box.appendChild(backToMyPageButton());
        })
        .catch(function (e) {
          msg.textContent = e.message;
          msg.className = 'bk-error';
          btn.disabled = false;
          btn.textContent = '出席';
        });
    });

    box.appendChild(msg);
    box.appendChild(btn);
    box.appendChild(backToMyPageButton());
  }

  function backToMyPageButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'bk-linkbtn';
    b.textContent = 'お申込み状況を見る';
    b.addEventListener('click', function () {
      state.pendingQr = '';
      history.replaceState(null, '', location.pathname);
      loadMyPage();
    });
    return b;
  }

  /* ===== 認証まわりの画面操作 ===== */

  function switchAuthTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.bk-tab'), function (t) {
      t.classList.toggle('bk-tab--on', t.dataset.auth === name);
    });
    $('#bk-login-form').hidden = name !== 'login';
    $('#bk-signup-form').hidden = name !== 'signup';
    $('#bk-confirm-form').hidden = true;
    $('#bk-forgot-form').hidden = true;
  }

  function afterLogin() {
    if (state.pendingQr) {
      showAttendance(state.pendingQr);
      return;
    }
    loadMyPage();
  }

  function onLogin(e) {
    e.preventDefault();
    var err = $('#bk-login-error');
    var btn = $('#bk-login-btn');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'ログイン中…';

    cognito('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: $('#bk-login-email').value.trim(),
        PASSWORD: $('#bk-login-pass').value
      }
    })
      .then(function (r) {
        saveTokens(r.AuthenticationResult);
        afterLogin();
      })
      .catch(function (e2) { err.textContent = e2.message; })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'ログイン';
      });
  }

  function onSignup(e) {
    e.preventDefault();
    var err = $('#bk-signup-error');
    var btn = $('#bk-signup-btn');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = '送信中…';

    auth.signupEmail = $('#bk-signup-email').value.trim();
    auth.signupPass = $('#bk-signup-pass').value;

    cognito('SignUp', {
      ClientId: CLIENT_ID,
      Username: auth.signupEmail,
      Password: auth.signupPass,
      UserAttributes: [{ Name: 'email', Value: auth.signupEmail }]
    })
      .then(function () {
        showConfirmForm();
      })
      .catch(function (e2) {
        // 登録済みだが未確認のまま画面を閉じた場合、ここに来る。
        // 登録し直せないので、コードを送り直して確認画面へ進ませる。
        if (/すでに登録されています/.test(e2.message)) {
          return resendCode()
            .then(function () {
              showConfirmForm('確認コードを送り直しました。迷惑メールフォルダもご確認ください。');
            })
            .catch(function () {
              err.textContent =
                'このメールアドレスはすでにご登録済みです。ログインしてください。';
            });
        }
        err.textContent = e2.message;
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '確認コードを送る';
      });
  }

  function showConfirmForm(info) {
    $('#bk-signup-form').hidden = true;
    $('#bk-confirm-form').hidden = false;
    var box = $('#bk-confirm-info');
    box.hidden = !info;
    box.textContent = info || '';
  }

  function resendCode() {
    return cognito('ResendConfirmationCode', {
      ClientId: CLIENT_ID,
      Username: auth.signupEmail
    });
  }

  function onResend() {
    var btn = $('#bk-resend-btn');
    var err = $('#bk-confirm-error');
    var info = $('#bk-confirm-info');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = '送信中…';

    resendCode()
      .then(function () {
        info.hidden = false;
        info.textContent = '確認コードを送り直しました。迷惑メールフォルダもご確認ください。';
      })
      .catch(function (e) { err.textContent = e.message; })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '確認コードを再送する';
      });
  }

  function onConfirm(e) {
    e.preventDefault();
    var err = $('#bk-confirm-error');
    var btn = $('#bk-confirm-btn');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = '確認中…';

    cognito('ConfirmSignUp', {
      ClientId: CLIENT_ID,
      Username: auth.signupEmail,
      ConfirmationCode: $('#bk-confirm-code').value.trim()
    })
      .then(function () {
        // 登録が済んだらそのままログインする
        return cognito('InitiateAuth', {
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: { USERNAME: auth.signupEmail, PASSWORD: auth.signupPass }
        });
      })
      .then(function (r) {
        auth.signupPass = '';
        saveTokens(r.AuthenticationResult);
        afterLogin();
      })
      .catch(function (e2) {
        // 確認済みのアドレスだった場合、この画面に留まっても先へ進めない。
        // メールアドレスを引き継いでログイン画面へ送る。
        if (/すでにご登録が完了しています/.test(e2.message)) {
          switchAuthTab('login');
          $('#bk-login-email').value = auth.signupEmail;
          $('#bk-login-error').textContent = e2.message;
          $('#bk-login-pass').focus();
          return;
        }
        err.textContent = e2.message;
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '登録を完了する';
      });
  }

  function onForgot(e) {
    e.preventDefault();
    var err = $('#bk-forgot-error');
    var btn = $('#bk-forgot-btn');
    var step2 = $('#bk-forgot-step2');
    var email = $('#bk-forgot-email').value.trim();
    err.textContent = '';

    if (step2.hidden) {
      btn.disabled = true;
      cognito('ForgotPassword', { ClientId: CLIENT_ID, Username: email })
        .then(function () {
          step2.hidden = false;
          btn.textContent = 'パスワードを変更する';
        })
        .catch(function (e2) { err.textContent = e2.message; })
        .then(function () { btn.disabled = false; });
      return;
    }

    btn.disabled = true;
    cognito('ConfirmForgotPassword', {
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: $('#bk-forgot-code').value.trim(),
      Password: $('#bk-forgot-pass').value
    })
      .then(function () {
        window.alert('パスワードを変更しました。新しいパスワードでログインしてください。');
        switchAuthTab('login');
        step2.hidden = true;
        btn.textContent = 'コードを送る';
      })
      .catch(function (e2) { err.textContent = e2.message; })
      .then(function () { btn.disabled = false; });
  }

  /* ===== 初期化 ===== */

  document.addEventListener('DOMContentLoaded', function () {
    $('#bk-trial-link').href = TRIAL_FORM_URL;

    var params = new URLSearchParams(location.search);
    state.pendingQr = params.get('qr') || '';

    // 認証
    Array.prototype.forEach.call(document.querySelectorAll('.bk-tab'), function (t) {
      t.addEventListener('click', function () { switchAuthTab(t.dataset.auth); });
    });
    $('#bk-login-form').addEventListener('submit', onLogin);
    $('#bk-signup-form').addEventListener('submit', onSignup);
    $('#bk-confirm-form').addEventListener('submit', onConfirm);
    $('#bk-resend-btn').addEventListener('click', onResend);
    $('#bk-forgot-form').addEventListener('submit', onForgot);
    $('#bk-forgot-link').addEventListener('click', function () {
      $('#bk-login-form').hidden = true;
      $('#bk-forgot-form').hidden = false;
    });
    $('#bk-logout').addEventListener('click', logout);

    // 画面遷移
    Array.prototype.forEach.call(document.querySelectorAll('[data-back=mypage]'), function (b) {
      b.addEventListener('click', loadMyPage);
    });
    $('#bk-new').addEventListener('click', openForm);

    // お子様の登録
    $('#bk-child-form').addEventListener('submit', onChildSubmit);
    $('#bk-child-cancel').addEventListener('click', resetChildForm);
    $('#bk-child-add').addEventListener('click', startAddChild);

    // 申込フォーム
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name=ageClass]'),
      function (el) {
        el.addEventListener('change', function () {
          state.ageClass = el.value;
          onStartMonthChange();
        });
      }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name=purchaseType]'),
      function (el) { el.addEventListener('change', onPurchaseTypeChange); }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name=ticketType]'),
      function (el) {
        el.addEventListener('change', function () {
          state.ticketType = Number(el.value);
          resetSelection();
        });
      }
    );
    $('#bk-single-count').addEventListener('change', function () {
      state.ticketType = Number(this.value);
      resetSelection();
    });
    $('#bk-start-month').addEventListener('change', onStartMonthChange);
    $('#bk-use-makeup').addEventListener('change', function () {
      state.useMakeup = this.checked;
      resetSelection();
    });
    $('#bk-form').addEventListener('submit', onSubmit);

    restoreSession().then(function (ok) {
      if (ok) { afterLogin(); return; }
      showAuth();
      switchAuthTab('login');
    });
  });
})();

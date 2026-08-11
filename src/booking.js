/* リトミック予約フォーム（限定公開ページ /rythmique/r7k2m9x4/ 専用） */
(function () {
  'use strict';

  var API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
  var COGNITO = 'https://cognito-idp.ap-northeast-1.amazonaws.com/';
  /* 保護者用 User Pool のクライアントID。
     cdk deploy の出力 GuardianUserPoolClientId をここに入れる。 */
  var CLIENT_ID = '2p03doec46lnt3leoha31nqf5v';

  /* 5回券は振替をお使いになるときだけの特例。
     5回分＋振替1回で6回になり、6回券と同じ通い方になる。
     サーバー側の TICKET_PRICES と揃えること。 */
  var TICKET_PRICES = {
    age0_3: { 5: 12000, 6: 12500, 7: 13000, 8: 13500 },
    age4_5: { 5: 16500, 6: 17000, 7: 17500, 8: 18000 }
  };
  var SINGLE_PRICES = { age0_3: 2500, age4_5: 3000 };

  /* 開講しているのは前半枠（15:30-16:30）のみ。
     後半枠は運用をやめ、既存分は status: closed にしてある。
     コースによる時間の出し分けは無くなったので、枠は part で絞らない。 */

  /* 申込の上限年齢。サーバー側の MAX_AGE と揃えること。 */
  var MAX_AGE = 6;

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var ID_KEY = 'nv_guardian_id';
  var REFRESH_KEY = 'nv_guardian_refresh';

  var auth = { idToken: null, email: '', signupEmail: '', signupPass: '' };

  var state = {
    allSlots: [],
    slots: [],
    selected: [],
    ageClass: null,
    purchaseType: 'ticket',
    ticketType: 6,
    startMonth: '',
    validFrom: '',
    validTo: '',
    useMakeup: false,
    // 既定でチェックを入れたお子様。切り替えたときだけ入れ直すための目印。
    makeupDefaultedFor: null,
    avail: 0,
    options: [],
    children: [],
    makeups: [],
    // お手持ちの申込。開始月の重なり判定に使う。
    tickets: [],
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

  /* 満年齢。サーバー側の ageOn と同じ規則で数える。
     月日を "MM-DD" のまま比べる（ゼロ埋めなので辞書順＝日付順）。 */
  function ageOn(birthDate, asOf) {
    var years = Number(asOf.slice(0, 4)) - Number(birthDate.slice(0, 4));
    return asOf.slice(5) >= birthDate.slice(5) ? years : years - 1;
  }

  /* 料金区分。判定はサーバーが行うので、ここは表示のための先読み。
     基準日はご利用開始月の1日。7歳以上は null（申込不可）。
     下限では拒まない。開始月の1日より後に生まれた乳児は年齢が負になるが、
     0〜3歳の料金で案内すればよい。 */
  function ageClassOf(birthDate, asOf) {
    if (!birthDate || !asOf) return null;
    var age = ageOn(birthDate, asOf);
    if (age > MAX_AGE) return null;
    return age <= 3 ? 'age0_3' : 'age4_5';
  }

  function selectedChild() {
    var id = $('#bk-child-select').value;
    for (var i = 0; i < state.children.length; i++) {
      if (state.children[i].childId === id) return state.children[i];
    }
    return null;
  }

  /* 前日の日付（YYYY-MM-DD）。月初を渡すと前月末が返る。 */
  function prevDay(date) {
    var d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
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
        state.makeups = d.makeups || [];
        state.tickets = d.tickets || [];
        renderChildren();
        renderMakeup();
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
    // 1人目の登録中は出さない。まだ1人もいないのに「2人目」を勧めても混乱する。
    $('#bk-child-add').hidden =
      open || state.children.length === 0 || state.children.length >= MAX_CHILDREN;
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

  /* 振替はお子様ごとに1回まで。誰の分かを必ず添えて表示する。 */
  function makeupOf(childId) {
    for (var i = 0; i < state.makeups.length; i++) {
      if (state.makeups[i].childId === childId) return state.makeups[i];
    }
    return null;
  }

  /* ご利用開始前かどうか。この時期は回数の変更で選び直せるので、
     振替（お一人1回きりの救済）は使わせない。 */
  function beforeStart(t) {
    return !!t.validFrom && todayJst() < t.validFrom;
  }

  /* 使い終わった振替を手元の一覧から落とす（表示のずれを防ぐ） */
  function dropMakeup(childId) {
    state.makeups = state.makeups.filter(function (m) { return m.childId !== childId; });
    renderMakeup();
  }

  function childNameOf(childId) {
    for (var i = 0; i < state.children.length; i++) {
      if (state.children[i].childId === childId) return state.children[i].childName;
    }
    return 'お子様';
  }

  function renderMakeup() {
    var box = $('#bk-makeup');
    if (state.makeups.length === 0) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';

    var strong = document.createElement('strong');
    strong.textContent = '振替があります';
    box.appendChild(strong);

    state.makeups.forEach(function (m) {
      var p = document.createElement('p');
      p.textContent =
        childNameOf(m.childId) + ' さん：' + formatDateJa(m.expiresAt) + 'まで有効。' +
        'このお子様の次の回数券をお申込みの際に、1回分を追加でお選びいただけます' +
        '（追加料金はかかりません）。';
      box.appendChild(p);
    });
  }

  function renderTickets(tickets) {
    var box = $('#bk-tickets');
    box.innerHTML = '';

    var live = tickets.filter(function (t) { return t.status !== 'cancelled'; });

    // すでに申込がある状態で「レッスンの予約をする」とだけ出ていると、
    // 済ませたはずの申込がまだ終わっていないように読める。
    $('#bk-new').textContent =
      live.length === 0 ? 'レッスンの予約をする' : '追加でレッスンの予約をする';

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

      // カード全体が押せることが見た目から分からなかったので、
      // 何ができるのかを言葉で出す。
      var go = document.createElement('div');
      go.className = 'bk-ticket-go';
      go.textContent = 'お申込み内容の確認・変更 →';
      card.appendChild(go);

      card.addEventListener('click', function () { openDetail(t.ticketId); });
      box.appendChild(card);
    });
  }

  /* ===== 申込の詳細・変更 ===== */

  var detail = { ticket: null };
  var planState = null;

  function openDetail(ticketId) {
    showPane('bk-detail');
    // 別の申込を開いたときに、前回の変更枠が残らないようにする
    closeEditor();
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

    // 回数の変更はご利用開始月の前月末（validFrom の前日）まで
    var canChangePlan = !!t.validFrom && today < t.validFrom;

    var dl = document.createElement('dl');
    dl.className = 'bk-receipt-list';
    [
      ['お名前', t.childName],
      ['料金区分', t.ageClass === 'age4_5' ? '4〜5歳' : '0〜3歳'],
      // 振替の1回は回数券に含まれる回ではなく、別に足される1回。
      // 「(振替1回を含む)」だと5回券が5回のうち1回が振替のように読めるので足し算で書く。
      ['内容', (t.purchaseType === 'single' ? '単発 ' + t.ticketType + '回' : t.ticketType + '回券') +
        (t.usedMakeup ? '＋振替1回' : '')],
      ['お支払い金額', formatYen(t.amount)],
      ['有効期間', t.validFrom + ' 〜 ' + t.validTo]
    ].forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.textContent = r[1];

      // 変更ボタンは「内容」の横に置く。何を変えるのかが一目で分かる。
      if (r[0] === '内容' && canChangePlan) {
        var inlineBtn = document.createElement('button');
        inlineBtn.type = 'button';
        inlineBtn.className = 'btn btn-outline btn-sm bk-inline-edit';
        inlineBtn.textContent = '回数を変更';
        inlineBtn.addEventListener('click', openPlanEditor);
        dd.appendChild(inlineBtn);
      }

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

    // 「振替にまわす」を出していない理由を書いておく。
    // ボタンが無い理由が分からないと、教室へのお問い合わせになってしまう。
    if (beforeStart(t)) {
      var mkNote = document.createElement('p');
      mkNote.className = 'bk-hint';
      mkNote.textContent =
        '※ご利用開始前は「振替にまわす」をお使いいただけません。' +
        '下の「回数の変更」で、回数と参加予定日を選び直していただけます。';
      box.appendChild(mkNote);
    }

    var planNote = document.createElement('p');
    planNote.className = 'bk-hint';
    planNote.textContent = canChangePlan
      ? '※回数の変更は、ご利用開始月の前月末（' + formatDateJa(prevDay(t.validFrom)) +
        '）まで承ります。'
      : '※回数の変更はご利用開始月の前月末までです。期限を過ぎているため、' +
        'こちらからは変更できません。教室までご連絡ください。';
    box.appendChild(planNote);

    // 申込そのものの取消。期間が始まる前だけ、保護者が自分で全部消せる。
    if (t.status !== 'cancelled' && canChangePlan) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'bk-linkbtn bk-linkbtn--danger';
      del.textContent = 'このお申込みを取り消す';
      del.addEventListener('click', function () { cancelTicket(t); });
      box.appendChild(del);
    }

    closeEditor();
  }

  /** 申込をまるごと取り消す（ご利用開始月の前月末まで） */
  function cancelTicket(t) {
    var msg =
      'このお申込みを取り消します。\n' +
      '参加予定日のご予約はすべて取り消され、元に戻せません。\n';
    if (t.usedMakeup) {
      msg += '\nお使いになった振替の1回分は、期限内であればお戻しします。\n';
    }
    msg += '\nよろしいですか？';
    if (!window.confirm(msg)) return;

    api('/tickets/' + encodeURIComponent(t.ticketId) + '/cancel', { method: 'POST' })
      .then(function () {
        window.alert('お申込みを取り消しました。');
        loadMyPage();
      })
      .catch(function (e) { window.alert(e.message); });
  }

  /** 変更の枠を開く。見出しを差し替えて中身を空にする。 */
  function openEditor(title) {
    $('#bk-editor-head').textContent = title;
    $('#bk-editor').innerHTML = '';
    $('#bk-editor-panel').hidden = false;
    return $('#bk-editor');
  }

  function closeEditor() {
    $('#bk-editor').innerHTML = '';
    $('#bk-editor-panel').hidden = true;
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

    /* 押しても振替にまわせない場面ではボタンを出さない。
       - そのお子様がすでに振替を持っている（お子様ごとに1回まで）
       - まだご利用開始前（回数の変更で選び直せるので、そちらへ案内する）
       押せるのに断られるより、最初から無いほうが迷わない。 */
    if (!makeupOf(detail.ticket.childId) && !beforeStart(detail.ticket)) {
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

    var editor = openEditor(formatDateJa(r.date) + ' の参加日を変更');

    if (candidates.length === 0) {
      var none = document.createElement('p');
      none.className = 'bk-hint';
      none.textContent =
        'この期間に空いている開講日がありません。「振替にまわす」を押すと、' +
        '次の回数券をお申込みの際に1回分を追加できます。';
      editor.appendChild(none);
      return;
    }

    // ラベルごと bk-field に入れて、下のボタンとの間に余白を取る
    var field = document.createElement('div');
    field.className = 'bk-field';
    var label = document.createElement('label');
    label.setAttribute('for', 'bk-change-to');
    label.textContent = '変更先の開講日';
    field.appendChild(label);

    var sel = document.createElement('select');
    sel.id = 'bk-change-to';
    sel.className = 'bk-select';
    candidates.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.slotId;
      // 時間帯は全枠共通になったので、コース名は出さない
      o.textContent =
        formatDateJa(s.date) + ' ' + s.startTime + '〜' + s.endTime +
        '（残' + s.remaining + '）';
      sel.appendChild(o);
    });
    field.appendChild(sel);
    editor.appendChild(field);

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
    $('#bk-editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** 振替にまわす */
  function toMakeup(r) {
    var t = detail.ticket;

    /* ご利用開始前なら、まだ回数を減らせる。
       振替は「通えるはずだった回に行けなかった」ときの救済で、お一人1回しか
       使えない。開始前に使ってしまうと、本当に必要になったときに残らない。
       回数変更で足りる場面では、そちらへ案内する。 */
    if (beforeStart(t)) {
      var toPlan = window.confirm(
        'この回数券はまだご利用開始前です（' + formatDateJa(t.validFrom) + '開始）。\n\n' +
        'この時期であれば「回数の変更」で回数と日程を選び直せます。\n' +
        '振替はお一人1回までのため、実際にお休みされたときのために' +
        'とっておくことをおすすめします。\n\n' +
        '回数の変更に進みますか？'
      );
      if (toPlan) openPlanEditor();
      return;
    }

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
        window.alert('振替にまわしました。' + formatDateJa(d.expiresAt) + 'まで有効です。');
        openDetail(detail.ticket.ticketId);
      })
      .catch(function (e) { window.alert(e.message); });
  }

  /* ===== 回数の変更 ===== */

  function openPlanEditor() {
    var t = detail.ticket;
    var today = todayJst();
    var editor = openEditor('回数と参加予定日を変更');

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
      '<div class="bk-field"><label for="bk-edit-type">回数</label>' +
      '<select id="bk-edit-type" class="bk-select"></select>' +
      (t.usedMakeup
        ? '<p class="bk-hint">このお申込みは振替の1回分を含みます。' +
          '参加予定日は回数券の回数に1日を足した日数をお選びください。</p>'
        : '') +
      '</div>' +
      '<div class="bk-summary"><span>選択中 <strong id="bk-edit-count"></strong></span>' +
      '<span>お支払い予定 <strong id="bk-edit-amount"></strong></span></div>' +
      '<p class="bk-pay-note">お支払いは初回レッスン時に現金でお支払いをお願いします</p>' +
      '<p id="bk-edit-select-msg" class="bk-select-msg"></p>' +
      '<div id="bk-edit-calendar"></div>' +
      '<p class="bk-cal-legend">★ … 育児のお悩み相談会はお休みの日<br>' +
      '※開講日はすべて同じ時間帯（15:30〜16:30）です。</p>' +
      '<p id="bk-edit-error" class="bk-error" role="alert"></p>' +
      '<button type="button" id="bk-edit-submit" class="btn btn-primary">この内容に変更する</button>';

    var sel = $('#bk-edit-type');
    // 5回券は振替を使って買った券だけの特例。区分は購入時に確定していて変えられない。
    var options = t.purchaseType === 'single'
      ? [1, 2, 3]
      : (t.usedMakeup ? [5, 6, 7, 8] : [6, 7, 8]);
    options.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      // 振替を使って買った券は、どの回数でも「回数券＋振替1回」通えるので
      // 5回券だけでなく全ての選択肢に足し算で添える。
      o.textContent = t.purchaseType === 'single'
        ? n + '回'
        : n + '回券' + (t.usedMakeup ? '＋振替1回（計' + (n + 1) + '日）' : '');
      if (n === t.ticketType) o.selected = true;
      sel.appendChild(o);
    });
    syncPlanTypeLimit();

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
    $('#bk-editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** 変更後に選べる開講日（すでに選んである日は満席でも保持する） */
  function usablePlanSlots() {
    var today = todayJst();
    return state.allSlots.filter(function (s) {
      if (planState.selected.indexOf(s.slotId) >= 0) return true;
      return s.status === 'open' && !s.full && s.date > today;
    });
  }

  /**
   * 変更先として選べる開講日が足りない回数は選ばせない。
   * 申込時（syncTicketTypeLimit）と同じ考え方で、振替の1回分も必要日数に含める。
   * ここを絞らないと、8回券へ変更したものの日程を選び切れず、
   * 「この内容に変更する」が押せないまま行き止まりになる。
   */
  function syncPlanTypeLimit() {
    var avail = usablePlanSlots().length;
    var sel = $('#bk-edit-type');
    if (!sel) return;

    Array.prototype.forEach.call(sel.options, function (o) {
      o.disabled = Number(o.value) + planState.extra > avail;
    });

    if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) {
      for (var i = sel.options.length - 1; i >= 0; i--) {
        if (!sel.options[i].disabled) {
          sel.selectedIndex = i;
          planState.ticketType = Number(sel.value);
          break;
        }
      }
    }
  }

  function renderPlanCalendar() {
    var wrap = $('#bk-edit-calendar');
    wrap.innerHTML = '';

    var usable = usablePlanSlots();

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
    // 前回の申込で入力した内容が残らないようにする
    $('#bk-note').value = '';
    $('#bk-error').textContent = '';

    var sel = $('#bk-child-select');
    sel.innerHTML = '';
    state.children.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.childId;
      o.textContent = c.childName + '（' + c.birthDate + '）';
      sel.appendChild(o);
    });
    syncCourse();

    syncMakeupRow();

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
        syncStartMonthOptions();
        onStartMonthChange();
      })
      .catch(function () {
        status.textContent =
          '開講日を読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。';
      });
  }

  /**
   * その開始月が、お手持ちの回数券と有効期間で重なるか。
   *
   * 有効期間が重なる回数券は、お子様1人につき1枚まで（サーバー側で
   * USER#<sub>/MONTH#<childId>#<YYYY-MM> により原子的に排除している）。
   * ここはその先読みで、選ばせる前に落とすためのもの。
   * 単発はこの対象外——開講日が足りない月を単発で埋める運用のため。
   */
  function overlappingTicket(childId, opt) {
    if (!childId || state.purchaseType === 'single') return null;
    for (var i = 0; i < state.tickets.length; i++) {
      var t = state.tickets[i];
      if (t.childId !== childId) continue;
      if (t.status === 'cancelled') continue;
      if (t.purchaseType !== 'ticket') continue;
      // 期間が1日でも重なれば不可
      if (opt.validFrom <= t.validTo && opt.validTo >= t.validFrom) return t;
    }
    return null;
  }

  /**
   * 重なる開始月を選べないようにする。
   *
   * 以前は選べてしまい、申し込む段になって初めて弾かれていた。
   * 日程まで選び終えてから断られるのは徒労なので、入口で落とす。
   * 選択肢に「（選択不可）」と出るので、別途の説明文は置かない。
   */
  function syncStartMonthOptions() {
    var child = selectedChild();
    var sel = $('#bk-start-month');

    Array.prototype.forEach.call(sel.options, function (o) {
      var opt = null;
      for (var i = 0; i < state.options.length; i++) {
        if (state.options[i].month === o.value) opt = state.options[i];
      }
      if (!opt) return;

      var hit = child ? overlappingTicket(child.childId, opt) : null;
      var label =
        Number(o.value.slice(0, 4)) + '年' + Number(o.value.slice(5, 7)) + '月から';
      // select の選択肢は折り返せないので、印だけを短く付ける
      o.disabled = !!hit;
      o.textContent = hit ? label + '（選択不可）' : label;
    });

    // 選択中の月が選べなくなったら、選べる月へ寄せる
    var cur = sel.selectedOptions[0];
    if (cur && cur.disabled) {
      var next = Array.prototype.filter.call(sel.options, function (o) {
        return !o.disabled;
      })[0];
      if (next) {
        sel.value = next.value;
        onStartMonthChange();
      }
    }
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
    var avail = opt.available.first;
    state.avail = avail;
    syncTicketTypeLimit();

    var hint = $('#bk-start-hint');
    var base = 'この開始月でお選びいただける開講日は残り' + avail + '日です。';
    if (state.useMakeup) {
      base += '振替の1回分を含めて日程をお選びいただきます。';
    }
    if (avail < needCount()) {
      hint.textContent =
        base + '回数に足りないため、開始月を先にするか単発レッスンをご利用ください。';
      hint.className = 'bk-hint bk-hint--warn';
    } else {
      hint.textContent = base;
      hint.className = 'bk-hint';
    }

    syncCourse();
    loadFormSlots();
  }

  /**
   * 開講日が足りない回数券を選べないようにする。
   *
   * 振替の1回分も「参加予定日を選ぶ対象」なので、必要日数は回数＋振替。
   * 振替を持っている状態で8回券を買うと9日必要になり、開講日が
   * 足りずに申込を完了できなくなる。選ばせる前に落としておく。
   */
  /**
   * 「振替の1回分を使う」の出し分け。
   * 振替はお子様ごとなので、選択中のお子様が持っているときだけ出す。
   * 単発では使えない。
   */
  function syncMakeupRow() {
    var child = selectedChild();
    var m = child ? makeupOf(child.childId) : null;
    var row = $('#bk-makeup-row');
    var hint = $('#bk-makeup-hint');
    var before = state.useMakeup;

    if (!m || state.purchaseType === 'single') {
      row.hidden = true;
      hint.hidden = true;
      $('#bk-use-makeup').checked = false;
      state.useMakeup = false;
      state.makeupDefaultedFor = null;
      if (before) afterMakeupChange();
      return;
    }

    row.hidden = false;
    $('#bk-makeup-label').textContent =
      '振替の1回分を使う（' + formatDateJa(m.expiresAt) + 'まで有効・追加料金なし）';

    /* 既定は「使う」。無料の1回を取り逃すほうが損が大きいため。
       強制はしない——振替の1回分も参加予定日を選ぶ対象なので、開講日が
       少ない期間では回数の選択肢が全滅し、申込そのものができなくなる。
       お子様が変わったときだけ入れ直す。保護者が外したのを毎回戻さないため。 */
    if (state.makeupDefaultedFor !== child.childId) {
      state.makeupDefaultedFor = child.childId;
      $('#bk-use-makeup').checked = true;
      state.useMakeup = true;
    }

    // 外したときに「捨てた」と誤解されないよう、次回以降に使えることを添える
    hint.hidden = state.useMakeup;
    hint.textContent =
      '※外された場合、この振替は' + formatDateJa(m.expiresAt) +
      'まで次回以降のお申込みにお使いいただけます。';

    if (state.useMakeup !== before) afterMakeupChange();
  }

  /** 振替の使用が変わると必要な参加予定日の数が変わるので、選択肢と日程を引き直す */
  function afterMakeupChange() {
    syncTicketTypeLimit();
    resetSelection();
  }

  function syncTicketTypeLimit() {
    var extra = state.useMakeup ? 1 : 0;
    var avail = state.avail;

    // 5回券は振替をお使いになるときだけ。外したら選択も6回券へ戻す。
    var row5 = $('#bk-ticket5-row');
    row5.hidden = !state.useMakeup;
    var input5 = row5.querySelector('input');
    if (!state.useMakeup && input5.checked) {
      document.querySelector('input[name=ticketType][value="6"]').checked = true;
      state.ticketType = 6;
      resetSelection();
    }

    // 振替をお使いになるときは、どの回数券でも1回足される。
    // マイページの表記（○回券＋振替1回）と揃える。
    Array.prototype.forEach.call(
      document.querySelectorAll('.bk-mk-note'),
      function (el) { el.hidden = !state.useMakeup; }
    );

    var current = null;
    var best = null;

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name=ticketType]'),
      function (el) {
        var n = Number(el.value);
        var ok = n + extra <= avail;
        el.disabled = !ok;
        el.closest('.bk-radio').classList.toggle('bk-radio--off', !ok);
        if (ok && (best === null || n > best.value)) best = { el: el, value: n };
        if (el.checked) current = { el: el, value: n, ok: ok };
      }
    );

    // 選択中のものが選べなくなったら、選べる中でいちばん多い回数へ寄せる
    if (current && !current.ok && best) {
      best.el.checked = true;
      state.ticketType = best.value;
      resetSelection();
    }

    // 単発も同様に、残り開講日を超える回数は選ばせない
    var single = $('#bk-single-count');
    Array.prototype.forEach.call(single.options, function (o) {
      o.disabled = Number(o.value) > avail;
    });
    if (single.selectedOptions[0] && single.selectedOptions[0].disabled) {
      for (var i = single.options.length - 1; i >= 0; i--) {
        if (!single.options[i].disabled) { single.selectedIndex = i; break; }
      }
      if (state.purchaseType === 'single') {
        state.ticketType = Number(single.value);
        resetSelection();
      }
    }
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

  /** 申込で選べる開講日に絞る（開講中・未来の日のみ） */
  function applyAgeClass() {
    var today = todayJst();
    state.slots = state.allSlots.filter(function (s) {
      return s.status === 'open' && s.date > today;
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

  /**
   * 選択中のお子様と開始月から料金区分を決め、その根拠を画面に出す。
   *
   * 判定するのはサーバー側（post-ticket.ts）で、ここは表示の先読み。
   * 保護者に選ばせる項目ではないので、結果と理由だけを示す。
   */
  function syncCourse() {
    syncMakeupRow();
    var child = selectedChild();
    var info = $('#bk-course-info');
    state.ageClass = null;

    if (!child || !state.validFrom) {
      info.hidden = true;
      return;
    }

    var age = ageOn(child.birthDate, state.validFrom);
    var cls = ageClassOf(child.birthDate, state.validFrom);
    state.ageClass = cls;
    info.hidden = false;

    // 判定日は有効期間の初日＝ご利用開始月の1日。
    // 「開始の時点」だと初回レッスン日と読めてしまうので、日付を明示する。
    var basis = Number(state.validFrom.slice(5, 7)) + '月1日';

    if (!cls) {
      info.innerHTML =
        '<strong>お申込みいただけません。</strong><br>' +
        'ご利用開始月の<strong>' + basis + '</strong>時点で' + age + '歳のため、' +
        '対象年齢（' + MAX_AGE + '歳まで）を超えています。';
      return;
    }

    // 開始月の1日より後に生まれた場合は年齢が負になる。「-1歳」とは出さない。
    var basisText = age < 0
      ? 'ご利用開始月の<strong>' + basis + '</strong>時点ではお生まれになる前のため、'
      : 'ご利用開始月の<strong>' + basis + '</strong>時点で<strong>' + age + '歳</strong>のため、';

    info.innerHTML =
      basisText +
      '<strong>' + (cls === 'age4_5' ? '4〜5歳' : '0〜3歳') + 'の料金</strong>でご案内します。<br>' +
      'ご利用期間の途中でお誕生日を迎えても、この回数券の金額は変わりません。';
    updateFormUI();
  }

  function updateFormUI() {
    var need = needCount();
    var got = state.selected.length;

    $('#bk-count').textContent = got + ' / ' + need + ' 日';
    $('#bk-amount').textContent = state.ageClass
      ? formatYen(priceOf(state.purchaseType, state.ageClass, state.ticketType))
      : '—';

    var msg = $('#bk-select-msg');
    if (got < need) {
      msg.textContent = 'あと' + (need - got) + '日、参加予定日をお選びください。';
      msg.className = 'bk-select-msg';
    } else {
      msg.textContent = '参加予定日の選択が完了しました。';
      msg.className = 'bk-select-msg bk-select-msg--done';
    }

    // 対象年齢外のときは金額が決まらないので送信させない。
    // 全ての月が重なって選べる月が無い場合もここで止める（選択肢を潰しただけでは
    // 重なる月が選ばれたまま残るため）。
    var child = selectedChild();
    var opt = currentOption();
    var overlap = child && opt ? overlappingTicket(child.childId, opt) : null;
    $('#bk-submit').disabled = got !== need || !state.ageClass || !!overlap;
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
    // 単発は期間の重なりの対象外なので、開始月の可否も切り替わる
    syncStartMonthOptions();
    // 振替は回数券のときだけ使える
    syncMakeupRow();
    syncTicketTypeLimit();
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
        purchaseType: state.purchaseType,
        ticketType: state.ticketType,
        startMonth: state.startMonth,
        useMakeup: state.useMakeup,
        slotIds: state.selected,
        note: $('#bk-note').value
      })
    })
      .then(function (d) {
        // 振替を使って申し込んだ時点で、そのお子様の権利は消費されている。
        // マイページへ戻ったときに残って見えないよう、手元からも落とす。
        if (state.useMakeup) {
          dropMakeup(childId);
          state.useMakeup = false;
        }
        showReceipt(d);
      })
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
    $('#bk-editor-close').addEventListener('click', closeEditor);

    // お子様の登録
    $('#bk-child-form').addEventListener('submit', onChildSubmit);
    $('#bk-child-add').addEventListener('click', startAddChild);

    // 申込フォーム
    // コースの選択欄は廃止。料金区分はご登録の生年月日から決まる。
    // お子様が変わると、重なる開始月も変わる（回数券はお子様ごとに1枚まで）
    $('#bk-child-select').addEventListener('change', function () {
      syncStartMonthOptions();
      syncCourse();
    });
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
      $('#bk-makeup-hint').hidden = this.checked;
      afterMakeupChange();
    });
    $('#bk-form').addEventListener('submit', onSubmit);

    restoreSession().then(function (ok) {
      if (ok) { afterLogin(); return; }
      showAuth();
      switchAuthTab('login');
    });
  });
})();

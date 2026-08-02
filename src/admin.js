/* リトミック予約 管理画面（限定公開 /rythmique/kanri-8w3qz5/ 専用） */
(function () {
  'use strict';

  var API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
  var COGNITO = 'https://cognito-idp.ap-northeast-1.amazonaws.com/';
  var CLIENT_ID = '21h4i55bmopdebg7fjd1m3k519';

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var STORAGE_KEY = 'nv_admin_token';

  var idToken = null;
  var session = null; // パスワード変更が必要なときのセッション
  var pendingUser = '';
  var currentMonth = '';

  var $ = function (s) { return document.querySelector(s); };
  var pad = function (n) { return String(n).padStart(2, '0'); };

  function formatDateJa(date) {
    var d = new Date(date + 'T00:00:00+09:00');
    return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)) +
      '（' + WEEKDAYS[d.getDay()] + '）';
  }

  function formatYen(n) { return Number(n).toLocaleString('ja-JP') + '円'; }

  /* ===== Cognito 認証 ===== */

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
        if (!res.ok) throw new Error(data.message || 'ログインに失敗しました');
        return data;
      });
    });
  }

  function login(user, pass) {
    return cognito('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: user, PASSWORD: pass }
    });
  }

  function onLogin(e) {
    e.preventDefault();
    var err = $('#ad-login-error');
    err.textContent = '';
    var btn = $('#ad-login-btn');
    btn.disabled = true;
    btn.textContent = 'ログイン中…';

    var user = $('#ad-user').value.trim();
    var pass = $('#ad-pass').value;

    login(user, pass)
      .then(function (r) {
        if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
          session = r.Session;
          pendingUser = user;
          $('#ad-login-form').hidden = true;
          $('#ad-newpass-form').hidden = false;
          return;
        }
        finishLogin(r.AuthenticationResult.IdToken);
      })
      .catch(function (e2) {
        err.textContent = e2.message === 'Incorrect username or password.'
          ? 'メールアドレスまたはパスワードが違います。'
          : e2.message;
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'ログイン';
      });
  }

  function onNewPassword(e) {
    e.preventDefault();
    var err = $('#ad-newpass-error');
    err.textContent = '';
    var p1 = $('#ad-newpass1').value;
    var p2 = $('#ad-newpass2').value;
    if (p1 !== p2) { err.textContent = 'パスワードが一致しません。'; return; }
    if (p1.length < 8) { err.textContent = 'パスワードは8文字以上にしてください。'; return; }

    cognito('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: CLIENT_ID,
      Session: session,
      ChallengeResponses: { USERNAME: pendingUser, NEW_PASSWORD: p1 }
    })
      .then(function (r) { finishLogin(r.AuthenticationResult.IdToken); })
      .catch(function (e2) { err.textContent = e2.message; });
  }

  function finishLogin(token) {
    idToken = token;
    try { sessionStorage.setItem(STORAGE_KEY, token); } catch (e) { /* 無視 */ }
    $('#ad-auth').hidden = true;
    $('#ad-main').hidden = false;
    var now = new Date();
    currentMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    loadSlots();
    loadTickets();
  }

  function logout() {
    idToken = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* 無視 */ }
    location.reload();
  }

  /* ===== API 呼び出し ===== */

  function api(path, options) {
    var opt = options || {};
    opt.headers = opt.headers || {};
    opt.headers.authorization = idToken;
    if (opt.body) opt.headers['content-type'] = 'application/json';

    return fetch(API_BASE + path, opt).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        alert('セッションの有効期限が切れました。もう一度ログインしてください。');
        logout();
        throw new Error('unauthorized');
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || '処理に失敗しました');
        return data;
      });
    });
  }

  /* ===== 開講枠 ===== */

  function loadSlots() {
    $('#ad-month-label').textContent =
      currentMonth.slice(0, 4) + '年' + Number(currentMonth.slice(5, 7)) + '月';
    var box = $('#ad-slots');
    box.textContent = '読み込んでいます…';

    api('/admin/slots?month=' + currentMonth)
      .then(function (d) { renderSlots(d.slots || []); })
      .catch(function (e) { box.textContent = e.message; });
  }

  function renderSlots(slots) {
    var box = $('#ad-slots');
    box.innerHTML = '';

    if (slots.length === 0) {
      box.innerHTML = '<p class="bk-hint">この月の開講日はまだ登録されていません。</p>';
      return;
    }

    slots.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'ad-slot';
      if (s.status !== 'open') card.classList.add('ad-slot--closed');

      var head = document.createElement('div');
      head.className = 'ad-slot-head';

      var title = document.createElement('strong');
      title.textContent =
        formatDateJa(s.date) + ' ' + s.startTime + '〜' + s.endTime +
        '（' + (s.part === 'first' ? '0〜3歳' : '4〜5歳') + '）';
      head.appendChild(title);

      var count = document.createElement('span');
      count.className = 'ad-slot-count';
      count.textContent = s.reservedCount + ' / ' + s.capacity + '名';
      head.appendChild(count);
      card.appendChild(head);

      var tags = document.createElement('div');
      tags.className = 'ad-tags';
      if (s.status === 'cancelled') tags.appendChild(tag('休講', 'ad-tag--warn'));
      if (s.status === 'closed') tags.appendChild(tag('受付停止', 'ad-tag--warn'));
      if (s.counselorAbsent) tags.appendChild(tag('相談会なし'));
      if (tags.children.length) card.appendChild(tags);

      var names = document.createElement('div');
      names.className = 'ad-attendees';
      if ((s.attendees || []).length === 0) {
        names.innerHTML = '<span class="ad-empty">予約なし</span>';
      } else {
        s.attendees.forEach(function (a) {
          var n = document.createElement('span');
          n.className = 'ad-name';
          if (a.status !== 'paid') n.classList.add('ad-name--unpaid');
          n.textContent = a.childName;
          n.title = a.status === 'paid' ? '入金済' : '未入金';
          names.appendChild(n);
        });
      }
      card.appendChild(names);

      var acts = document.createElement('div');
      acts.className = 'ad-actions';
      acts.appendChild(
        btn(s.status === 'open' ? '休講にする' : '受付を再開', function () {
          var next = s.status === 'open' ? 'cancelled' : 'open';
          patchSlot(s.slotId, { status: next });
        })
      );
      acts.appendChild(
        btn(s.counselorAbsent ? '相談会ありに' : '相談会なしに', function () {
          patchSlot(s.slotId, { counselorAbsent: !s.counselorAbsent });
        })
      );
      acts.appendChild(
        btn('定員変更', function () {
          var v = window.prompt('定員を入力してください', s.capacity);
          if (v === null) return;
          patchSlot(s.slotId, { capacity: Number(v) });
        })
      );
      if (s.reservedCount === 0) {
        acts.appendChild(
          btn('削除', function () {
            if (!window.confirm(formatDateJa(s.date) + ' の枠を削除します。よろしいですか？')) return;
            api('/admin/slots/' + encodeURIComponent(s.slotId), { method: 'DELETE' })
              .then(loadSlots)
              .catch(function (e) { alert(e.message); });
          })
        );
      }
      card.appendChild(acts);

      box.appendChild(card);
    });
  }

  function tag(text, cls) {
    var el = document.createElement('span');
    el.className = 'ad-tag' + (cls ? ' ' + cls : '');
    el.textContent = text;
    return el;
  }

  function btn(text, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-outline btn-sm';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  function patchSlot(slotId, body) {
    api('/admin/slots/' + encodeURIComponent(slotId), {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
      .then(loadSlots)
      .catch(function (e) { alert(e.message); });
  }

  function shiftMonth(n) {
    var y = Number(currentMonth.slice(0, 4));
    var m = Number(currentMonth.slice(5, 7)) + n;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    currentMonth = y + '-' + pad(m);
    loadSlots();
  }

  function onAddSlot(e) {
    e.preventDefault();
    var date = $('#ad-new-date').value;
    var part = $('#ad-new-part').value;
    if (!date) { alert('日付を入力してください'); return; }

    var times = part === 'first'
      ? { startTime: '15:30', endTime: '16:30' }
      : { startTime: '16:45', endTime: '17:45' };

    api('/admin/slots', {
      method: 'POST',
      body: JSON.stringify({
        date: date,
        part: part,
        startTime: times.startTime,
        endTime: times.endTime,
        capacity: Number($('#ad-new-cap').value || 15),
        counselorAbsent: $('#ad-new-absent').checked
      })
    })
      .then(function () {
        $('#ad-new-date').value = '';
        $('#ad-new-absent').checked = false;
        currentMonth = date.slice(0, 7);
        loadSlots();
      })
      .catch(function (e2) { alert(e2.message); });
  }

  /* ===== 申込一覧 ===== */

  function loadTickets() {
    var box = $('#ad-tickets');
    box.textContent = '読み込んでいます…';
    api('/admin/tickets')
      .then(function (d) { renderTickets(d.tickets || []); })
      .catch(function (e) { box.textContent = e.message; });
  }

  function renderTickets(tickets) {
    var box = $('#ad-tickets');
    box.innerHTML = '';

    $('#ad-ticket-count').textContent = tickets.length + '件';

    if (tickets.length === 0) {
      box.innerHTML = '<p class="bk-hint">まだお申込みはありません。</p>';
      return;
    }

    tickets.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'ad-ticket';
      if (t.status === 'cancelled') card.classList.add('ad-slot--closed');

      var head = document.createElement('div');
      head.className = 'ad-slot-head';
      var name = document.createElement('strong');
      name.textContent = t.childName;
      head.appendChild(name);

      var st = document.createElement('span');
      st.className = 'ad-tag';
      if (t.status === 'paid') {
        st.textContent = '入金済';
        st.classList.add('ad-tag--ok');
      } else if (t.status === 'cancelled') {
        st.textContent = 'キャンセル';
        st.classList.add('ad-tag--warn');
      } else {
        st.textContent = '未入金';
        st.classList.add('ad-tag--warn');
      }
      head.appendChild(st);
      card.appendChild(head);

      var dl = document.createElement('dl');
      dl.className = 'ad-dl';
      [
        ['コース', t.ageLabel],
        ['内容', (t.purchaseType === 'single' ? '単発 ' : '') + t.ticketType + (t.purchaseType === 'single' ? '回' : '回券')],
        ['金額', formatYen(t.amount)],
        ['有効期間', t.validFrom + ' 〜 ' + t.validTo],
        ['生年月日', t.birthDate || '—'],
        ['メール', t.email],
        ['申込日', (t.createdAt || '').slice(0, 10)]
      ].forEach(function (r) {
        var dt = document.createElement('dt');
        dt.textContent = r[0];
        var dd = document.createElement('dd');
        dd.textContent = r[1];
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      card.appendChild(dl);

      var dates = document.createElement('div');
      dates.className = 'ad-dates';
      (t.dates || []).forEach(function (d) {
        var s = document.createElement('span');
        s.className = 'ad-date';
        s.textContent = formatDateJa(d);
        dates.appendChild(s);
      });
      card.appendChild(dates);

      if (t.note) {
        var note = document.createElement('p');
        note.className = 'ad-note';
        note.textContent = 'ご連絡事項: ' + t.note;
        card.appendChild(note);
      }

      var acts = document.createElement('div');
      acts.className = 'ad-actions';
      if (t.status !== 'paid') {
        acts.appendChild(btn('入金済にする', function () {
          patchTicket(t.ticketId, 'paid');
        }));
      } else {
        acts.appendChild(btn('未入金に戻す', function () {
          patchTicket(t.ticketId, 'pending');
        }));
      }
      card.appendChild(acts);

      box.appendChild(card);
    });
  }

  function patchTicket(ticketId, status) {
    api('/admin/tickets/' + encodeURIComponent(ticketId), {
      method: 'PATCH',
      body: JSON.stringify({ status: status })
    })
      .then(function () { loadTickets(); loadSlots(); })
      .catch(function (e) { alert(e.message); });
  }

  function exportCsv() {
    fetch(API_BASE + '/admin/export', { headers: { authorization: idToken } })
      .then(function (res) {
        if (!res.ok) throw new Error('出力に失敗しました');
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'bookings.csv';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(function (e) { alert(e.message); });
  }

  /* ===== 初期化 ===== */

  document.addEventListener('DOMContentLoaded', function () {
    $('#ad-login-form').addEventListener('submit', onLogin);
    $('#ad-newpass-form').addEventListener('submit', onNewPassword);
    $('#ad-logout').addEventListener('click', logout);
    $('#ad-prev').addEventListener('click', function () { shiftMonth(-1); });
    $('#ad-next').addEventListener('click', function () { shiftMonth(1); });
    $('#ad-reload').addEventListener('click', function () { loadSlots(); loadTickets(); });
    $('#ad-add-form').addEventListener('submit', onAddSlot);
    $('#ad-export').addEventListener('click', exportCsv);

    // タブ切り替え
    Array.prototype.forEach.call(document.querySelectorAll('.ad-tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.ad-tab'), function (x) {
          x.classList.remove('ad-tab--on');
        });
        t.classList.add('ad-tab--on');
        $('#ad-panel-slots').hidden = t.dataset.tab !== 'slots';
        $('#ad-panel-tickets').hidden = t.dataset.tab !== 'tickets';
      });
    });

    var saved = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (e) { /* 無視 */ }
    if (saved) {
      finishLogin(saved);
    }
  });
})();

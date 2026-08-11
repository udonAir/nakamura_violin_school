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

  function todayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /* 満年齢。サーバー側の ageOn と同じ規則で数える。 */
  function ageOn(birthDate, asOf) {
    var years = Number(asOf.slice(0, 4)) - Number(birthDate.slice(0, 4));
    return asOf.slice(5) >= birthDate.slice(5) ? years : years - 1;
  }

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
          names.appendChild(attendeeRow(s, a));
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

  var RES_LABEL = { attended: '出席', absent: '欠席', scheduled: '予定', cancelled: '取消' };

  /**
   * 出席予定者の1行。
   * 「出席」は保護者がQRから押す。押されないまま終了時刻を過ぎたものは
   * サーバー側が欠席として返す（レコードには書かれない）。
   * ここでは押し忘れの救済として、手で直せるようにしている。
   */
  function attendeeRow(slot, a) {
    var row = document.createElement('div');
    row.className = 'ad-attendee ad-attendee--' + a.status;

    var n = document.createElement('span');
    n.className = 'ad-name';
    n.textContent = a.childName;
    row.appendChild(n);

    var st = document.createElement('span');
    st.className = 'ad-tag ad-tag--' + (a.status === 'attended' ? 'ok' : a.status === 'absent' ? 'warn' : '');
    st.textContent = RES_LABEL[a.status] || a.status;
    row.appendChild(st);

    if (a.status !== 'cancelled') {
      row.appendChild(
        btn(a.status === 'attended' ? '出席を取消' : '出席にする', function () {
          patchReservation(a.ticketId, a.slotId, a.status === 'attended' ? 'scheduled' : 'attended');
        })
      );
    }
    // 当日の急病などで来られなかった方に、教室から振替を付与する
    if (a.status === 'absent') {
      row.appendChild(
        btn('振替を付与', function () {
          if (!window.confirm(a.childName + ' さんに振替を1回付与します。よろしいですか？')) return;
          api('/admin/makeups', {
            method: 'POST',
            body: JSON.stringify({ ticketId: a.ticketId, date: slot.date })
          })
            .then(function (d) { alert('振替を付与しました。' + d.expiresAt + ' まで有効です。'); })
            .catch(function (e) { alert(e.message); });
        })
      );
    }

    return row;
  }

  function patchReservation(ticketId, slotId, status) {
    api(
      '/admin/reservations/' + encodeURIComponent(ticketId) + '/' + encodeURIComponent(slotId),
      { method: 'PATCH', body: JSON.stringify({ status: status }) }
    )
      .then(loadSlots)
      .catch(function (e) { alert(e.message); });
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

  /* 取得した申込を持っておき、表示は絞り込みで切り替える */
  var allTickets = [];

  function loadTickets() {
    var box = $('#ad-tickets');
    box.textContent = '読み込んでいます…';
    api('/admin/tickets')
      .then(function (d) { allTickets = d.tickets || []; renderTickets(); })
      .catch(function (e) { box.textContent = e.message; });
  }

  function renderTickets() {
    var box = $('#ad-tickets');
    box.innerHTML = '';

    // 取消済みは既定で伏せる。普段見たいのは有効な申込だけなので。
    var showCancelled = $('#ad-show-cancelled').checked;
    var tickets = showCancelled
      ? allTickets
      : allTickets.filter(function (t) { return t.status !== 'cancelled'; });

    var hidden = allTickets.length - tickets.length;
    $('#ad-ticket-count').textContent =
      tickets.length + '件' + (hidden > 0 ? '（取消 ' + hidden + '件を非表示）' : '');

    if (tickets.length === 0) {
      box.innerHTML = '<p class="bk-hint">表示できるお申込みはありません。</p>';
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
      // 入金の管理はしない（現金をレッスン当日に受け取るため）
      if (t.status === 'cancelled') {
        st.textContent = '取消';
        st.classList.add('ad-tag--warn');
      } else {
        st.textContent = '有効';
        st.classList.add('ad-tag--ok');
      }
      head.appendChild(st);
      card.appendChild(head);

      var dl = document.createElement('dl');
      dl.className = 'ad-dl';
      [
        // 料金区分は生年月日から自動で決まる。根拠の年齢を並べて出すことで、
        // 「なぜこの金額か」を画面だけで追えるようにする。
        ['料金区分', t.ageLabel + (t.ageAtStart === null || t.ageAtStart === undefined
          ? '' : '（開始月初日に ' + t.ageAtStart + '歳）')],
        ['内容', (t.purchaseType === 'single' ? '単発 ' : '') + t.ticketType + (t.purchaseType === 'single' ? '回' : '回券')],
        ['金額', formatYen(t.amount)],
        ['有効期間', t.validFrom + ' 〜 ' + t.validTo],
        ['振替利用', t.usedMakeup ? 'あり（1回分を追加）' : 'なし'],
        ['生年月日', t.birthDate || '—'],
        ['現在の年齢', t.birthDate ? ageOn(t.birthDate, todayJst()) + '歳' : '—'],
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
      if (t.status !== 'cancelled') {
        acts.appendChild(btn('申込を取り消す', function () {
          if (!window.confirm(
            t.childName + ' さんのお申込みを取り消します。\n' +
            'これからの回の席は空きに戻ります。よろしいですか？'
          )) return;
          setTicketStatus(t.ticketId, 'cancelled');
        }));
      } else {
        acts.appendChild(btn('取消を取り消す', function () {
          if (!window.confirm(
            t.childName + ' さんのお申込みを元に戻します。\n' +
            'これからの回の席を取り直します。満席になっていると戻せません。\n' +
            'よろしいですか？'
          )) return;
          setTicketStatus(t.ticketId, 'active');
        }));
        acts.appendChild(btn('完全に削除', function () {
          if (!window.confirm(
            t.childName + ' さんの取消済みのお申込みを完全に削除します。\n' +
            '出席の記録も含めて消え、元に戻せません。よろしいですか？'
          )) return;
          removeTicket(t.ticketId);
        }));
      }
      card.appendChild(acts);

      box.appendChild(card);
    });
  }

  /** 取消（cancelled）と、その取り消し（active） */
  function setTicketStatus(ticketId, status) {
    api('/admin/tickets/' + encodeURIComponent(ticketId), {
      method: 'PATCH',
      body: JSON.stringify({ status: status })
    })
      .then(function () { loadTickets(); loadSlots(); })
      .catch(function (e) { alert(e.message); });
  }

  /** 取消済みの申込を完全に削除する */
  function removeTicket(ticketId) {
    api('/admin/tickets/' + encodeURIComponent(ticketId), { method: 'DELETE' })
      .then(function () { loadTickets(); loadSlots(); })
      .catch(function (e) { alert(e.message); });
  }

  /* ===== 出席用QR ===== */

  var qrTimer = null;
  var QR_PAGE = location.origin + '/rythmique/r7k2m9x4/';

  function startQr() {
    stopQr();
    refreshQr();
  }

  function stopQr() {
    if (qrTimer) { clearTimeout(qrTimer); qrTimer = null; }
  }

  function refreshQr() {
    api('/admin/qr')
      .then(function (d) {
        drawQr(QR_PAGE + '?qr=' + encodeURIComponent(d.token));
        $('#ad-qr-status').textContent =
          '最終更新 ' + new Date().toLocaleTimeString('ja-JP') +
          '（約' + Math.round(d.refreshSec / 60) + '分ごとに自動更新）';
        // 切り替わる少し前に取り直す
        qrTimer = setTimeout(refreshQr, Math.max(30, d.refreshSec - 20) * 1000);
      })
      .catch(function (e) {
        $('#ad-qr-status').textContent = e.message;
        qrTimer = setTimeout(refreshQr, 30000);
      });
  }

  function drawQr(url) {
    var box = $('#ad-qr');
    box.innerHTML = '';
    // typeNumber 0 = 必要な大きさを自動で決める。誤り訂正レベルは M。
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    // scalable を付けると width/height 属性が省かれ、iOS Safari で
    // 高さが 0 に潰れてQRが見えなくなる。固有サイズを持たせておく。
    box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 8 });
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
    // 取得済みの一覧を出し分けるだけなので、読み込み直さない
    $('#ad-show-cancelled').addEventListener('change', renderTickets);

    // タブ切り替え
    Array.prototype.forEach.call(document.querySelectorAll('.ad-tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.ad-tab'), function (x) {
          x.classList.remove('ad-tab--on');
        });
        t.classList.add('ad-tab--on');
        $('#ad-panel-slots').hidden = t.dataset.tab !== 'slots';
        $('#ad-panel-tickets').hidden = t.dataset.tab !== 'tickets';
        $('#ad-panel-qr').hidden = t.dataset.tab !== 'qr';
        // 表示しているときだけ更新を回す
        if (t.dataset.tab === 'qr') { startQr(); } else { stopQr(); }
      });
    });

    var saved = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (e) { /* 無視 */ }
    if (saved) {
      finishLogin(saved);
    }
  });
})();

/* リトミック予約フォーム（限定公開ページ /rythmique/r7k2m9x4/ 専用） */
(function () {
  'use strict';

  var API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
  var TRIAL_FORM_URL =
    'https://docs.google.com/forms/d/1D1GHXF9IeXEmMy0lBG19rGpgoC9d2AB9rEwnRlm72jE/viewform';

  var TICKET_PRICES = {
    age0_3: { 6: 12500, 7: 13000, 8: 13500 },
    age4_5: { 6: 17000, 7: 17500, 8: 18000 }
  };
  var SINGLE_PRICES = { age0_3: 2500, age4_5: 3000 };

  /* コースと時間枠の対応。0〜3歳は前半、4〜5歳は後半。 */
  var PART_BY_AGE = { age0_3: 'first', age4_5: 'second' };

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var state = {
    mode: 'form', // 'form'（新規申込） | 'edit'（控えページからの変更）
    allSlots: [],
    slots: [],
    selected: [],
    lockedIds: [],
    ageClass: 'age0_3',
    purchaseType: 'ticket',
    ticketType: 6,
    validFrom: '',
    validTo: ''
  };

  var $ = function (sel) { return document.querySelector(sel); };

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatYen(n) { return n.toLocaleString('ja-JP') + '円'; }

  function estimateAmount() {
    return state.purchaseType === 'single'
      ? SINGLE_PRICES[state.ageClass] * state.ticketType
      : TICKET_PRICES[state.ageClass][state.ticketType];
  }

  /**
   * 選択できる期間＝申込日の翌月1日から3ヶ月間。
   * サーバ側でも同じ判定を行う（ここでの計算は表示用）。
   */
  function calcPeriod() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth(); // 0始まり
    var from = new Date(y, m + 1, 1);
    var to = new Date(y, m + 4, 0);
    return {
      validFrom: from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-01',
      validTo: to.getFullYear() + '-' + pad(to.getMonth() + 1) + '-' + pad(to.getDate())
    };
  }

  /* ===== 開講枠の読み込み ===== */

  function loadSlots() {
    var p = calcPeriod();
    state.validFrom = p.validFrom;
    state.validTo = p.validTo;

    $('#bk-period').textContent =
      Number(p.validFrom.slice(5, 7)) + '月 〜 ' + Number(p.validTo.slice(5, 7)) + '月';

    var status = $('#bk-calendar-status');
    status.textContent = '開講日を読み込んでいます…';

    var from = p.validFrom.slice(0, 7);
    var to = p.validTo.slice(0, 7);

    fetch(API_BASE + '/slots?from=' + from + '&to=' + to)
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.allSlots = (data.slots || []).filter(function (s) {
          return s.status === 'open' && s.date >= p.validFrom && s.date <= p.validTo;
        });
        status.textContent = '';
        applyAgeClass();
      })
      .catch(function () {
        status.textContent =
          '開講日を読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。';
      });
  }

  /* ===== カレンダー描画 ===== */

  function slotByDate(date) {
    for (var i = 0; i < state.slots.length; i++) {
      if (state.slots[i].date === date) return state.slots[i];
    }
    return null;
  }

  function monthsInPeriod() {
    var months = [];
    if (!state.validFrom || !state.validTo) return months;

    var start = state.validFrom.slice(0, 7).split('-');
    var y = Number(start[0]);
    var m = Number(start[1]);
    var end = state.validTo.slice(0, 7);
    if (!y || !m) return months;

    // 念のため上限を設け、条件が壊れても止まらないようにする
    for (var i = 0; i < 24; i++) {
      var cur = y + '-' + pad(m);
      months.push(cur);
      if (cur === end) break;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return months;
  }

  /** 選択中のコースに対応する時間枠だけを表示対象にする */
  function applyAgeClass() {
    var part = PART_BY_AGE[state.ageClass];
    state.slots = state.allSlots.filter(function (s) { return s.part === part; });

    var sample = state.slots[0];
    $('#bk-time').textContent = sample
      ? sample.startTime + '〜' + sample.endTime + '（60分）'
      : '—';

    state.selected = [];
    renderCalendar();
  }

  function renderCalendar() {
    var wrap = $(state.mode === 'edit' ? '#bk-edit-calendar' : '#bk-calendar');
    wrap.innerHTML = '';

    if (state.slots.length === 0) {
      if (state.mode !== 'edit') {
        $('#bk-calendar-status').textContent =
          'この期間にご予約可能な開講日がありません。教室までお問い合わせください。';
      }
      return;
    }

    monthsInPeriod().forEach(function (month) {
      wrap.appendChild(renderMonth(month));
    });

    updateSelectionUI();
  }

  function renderMonth(month) {
    var parts = month.split('-');
    var year = Number(parts[0]);
    var mon = Number(parts[1]);

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
      grid.appendChild(renderDay(year + '-' + pad(mon) + '-' + pad(d), d));
    }

    box.appendChild(grid);
    return box;
  }

  function renderDay(date, dayNum) {
    var slot = slotByDate(date);

    if (!slot) {
      var cell = document.createElement('div');
      cell.className = 'bk-cal-cell bk-cal-cell--off';
      cell.textContent = dayNum;
      return cell;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bk-cal-cell bk-cal-day';
    btn.dataset.slotId = slot.slotId;
    btn.setAttribute('aria-pressed', 'false');

    var num = document.createElement('span');
    num.className = 'bk-cal-num';
    num.textContent = dayNum;
    btn.appendChild(num);

    var meta = document.createElement('span');
    meta.className = 'bk-cal-meta';
    if (slot.full) {
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

    btn.addEventListener('click', function () { toggleDay(btn, slot); });
    return btn;
  }

  function toggleDay(btn, slot) {
    // 編集モードでは、済んでしまった回は外せない
    if (state.mode === 'edit' && state.lockedIds.indexOf(slot.slotId) >= 0) return;

    var idx = state.selected.indexOf(slot.slotId);
    if (idx >= 0) {
      state.selected.splice(idx, 1);
    } else {
      if (state.selected.length >= state.ticketType) return;
      state.selected.push(slot.slotId);
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    var need = state.ticketType;
    var got = state.selected.length;

    Array.prototype.forEach.call(
      document.querySelectorAll('.bk-cal-day'),
      function (btn) {
        var on = state.selected.indexOf(btn.dataset.slotId) >= 0;
        btn.classList.toggle('bk-cal-day--on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        // 済んでしまった回は外せないので押せなくする
        var locked = state.mode === 'edit' && state.lockedIds.indexOf(btn.dataset.slotId) >= 0;
        btn.classList.toggle('bk-cal-day--locked', locked);
        if (!btn.classList.contains('bk-cal-day--full')) {
          btn.disabled = locked || (!on && got >= need);
        }
      }
    );

    // 編集モード（控えページからの変更）では別の要素を更新する
    var prefix = state.mode === 'edit' ? '#bk-edit-' : '#bk-';

    $(prefix + 'count').textContent = got + ' / ' + need + ' 日';
    $(prefix + 'amount').textContent = formatYen(estimateAmount());

    var msg = $(prefix + 'select-msg');
    if (got < need) {
      msg.textContent = 'あと' + (need - got) + '日、参加予定日をお選びください。';
      msg.className = 'bk-select-msg';
    } else {
      msg.textContent = '参加予定日の選択が完了しました。';
      msg.className = 'bk-select-msg bk-select-msg--done';
    }

    $(prefix + 'submit').disabled = got !== need;
  }

  function formatDateJa(date) {
    var d = new Date(date + 'T00:00:00+09:00');
    return (
      Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日（' +
      WEEKDAYS[d.getDay()] + '）'
    );
  }

  /* ===== 選択条件の変更 ===== */

  function resetSelection() {
    state.selected = [];
    updateSelectionUI();
  }

  function onPurchaseTypeChange() {
    state.purchaseType = $('input[name=purchaseType]:checked').value;
    var isSingle = state.purchaseType === 'single';
    $('#bk-ticket-type-row').hidden = isSingle;
    $('#bk-single-count-row').hidden = !isSingle;
    state.ticketType = isSingle
      ? Number($('#bk-single-count').value)
      : Number($('input[name=ticketType]:checked').value);
    resetSelection();
  }

  /* ===== 送信 ===== */

  function onSubmit(e) {
    e.preventDefault();

    var childName = $('#bk-child').value.trim();
    var errorBox = $('#bk-error');
    if (!childName) {
      errorBox.textContent = 'お子様のお名前を入力してください。';
      return;
    }
    if (!$('#bk-birth').value) {
      errorBox.textContent = 'お子様の生年月日を入力してください。';
      return;
    }
    if (!$('#bk-email').value.trim()) {
      errorBox.textContent = 'メールアドレスを入力してください。';
      return;
    }

    var btn = $('#bk-submit');
    errorBox.textContent = '';
    btn.disabled = true;
    btn.textContent = '送信中…';

    var payload = {
      childName: childName,
      birthDate: $('#bk-birth').value,
      email: $('#bk-email').value.trim(),
      ageClass: state.ageClass,
      purchaseType: state.purchaseType,
      ticketType: state.ticketType,
      slotIds: state.selected,
      note: $('#bk-note').value
    };

    fetch(API_BASE + '/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          errorBox.textContent = r.data.message || '送信に失敗しました。時間をおいてお試しください。';
          btn.disabled = false;
          btn.textContent = 'この内容で申し込む';
          if (r.status === 409) { resetSelection(); loadSlots(); }
          return;
        }
        showReceipt(r.data);
      })
      .catch(function () {
        errorBox.textContent = '通信に失敗しました。電波状況をご確認のうえお試しください。';
        btn.disabled = false;
        btn.textContent = 'この内容で申し込む';
      });
  }

  function showReceipt(data) {
    $('#bk-form-section').hidden = true;
    $('#bk-receipt').hidden = false;

    $('#bk-receipt-amount').textContent = formatYen(data.amount);
    $('#bk-receipt-period').textContent = data.validFrom + ' 〜 ' + data.validTo;

    var ul = $('#bk-receipt-dates');
    ul.innerHTML = '';
    (data.dates || []).forEach(function (d) {
      var li = document.createElement('li');
      li.textContent = d.slice(0, 4) + '年' + formatDateJa(d);
      ul.appendChild(li);
    });

    var url =
      location.origin + location.pathname + '?ticket=' + data.ticketId + '&token=' + data.token;
    var link = $('#bk-receipt-link');
    link.href = url;
    link.textContent = url;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ===== 控えの表示と変更 ===== */

  var receipt = { ticketId: '', token: '', ticket: null };

  function todayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function loadReceipt(ticketId, token) {
    $('#bk-form-section').hidden = true;
    $('#bk-notice').hidden = true;
    $('#bk-lookup').hidden = false;
    receipt.ticketId = ticketId;
    receipt.token = token;

    var box = $('#bk-lookup-body');
    box.textContent = '読み込んでいます…';

    fetch(
      API_BASE + '/tickets/' + encodeURIComponent(ticketId) +
        '?token=' + encodeURIComponent(token)
    )
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(function (t) {
        receipt.ticket = t;
        // カレンダーの月を列挙するのに使う
        state.validFrom = t.validFrom;
        state.validTo = t.validTo;

        return fetch(
          API_BASE + '/slots?from=' + t.validFrom.slice(0, 7) + '&to=' + t.validTo.slice(0, 7)
        )
          .then(function (res) { return res.ok ? res.json() : { slots: [] }; })
          .then(function (data) {
            state.allSlots = (data.slots || []).filter(function (sl) {
              return sl.status === 'open' && sl.date >= t.validFrom && sl.date <= t.validTo;
            });
            renderReceipt();
          });
      })
      .catch(function () {
        box.textContent = 'お申込みが見つかりませんでした。URLが正しいかご確認ください。';
      });
  }

  function renderReceipt() {
    var t = receipt.ticket;
    var box = $('#bk-lookup-body');
    box.innerHTML = '';

    var dl = document.createElement('dl');
    dl.className = 'bk-receipt-list';
    [
      ['お名前', t.childName],
      ['コース', t.ageClass === 'age4_5' ? '4〜5歳コース' : '0〜3歳コース'],
      ['有効期間', t.validFrom + ' 〜 ' + t.validTo],
      ['お手続き状況', t.status === 'paid' ? 'お支払い確認済み' : '受付済み（お支払い前）']
    ].forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.textContent = r[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    box.appendChild(dl);

    var editor = document.createElement('div');
    editor.id = 'bk-editor';
    box.appendChild(editor);

    if (t.status === 'pending') {
      openPlanEditor();
    } else {
      renderReadOnly();
    }
  }

  /** お支払い済みの場合は閲覧のみ */
  function renderReadOnly() {
    var t = receipt.ticket;
    var editor = $('#bk-editor');

    var h = document.createElement('h3');
    h.className = 'bk-subhead';
    h.textContent = '参加予定日';
    editor.appendChild(h);

    var ul = document.createElement('ul');
    ul.className = 'bk-date-list';
    t.reservations.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = r.date.slice(0, 4) + '年' + formatDateJa(r.date);
      ul.appendChild(li);
    });
    editor.appendChild(ul);

    var note = document.createElement('p');
    note.className = 'bk-hint';
    note.textContent =
      '※お支払い済みのため、こちらからの変更はできません。変更をご希望の場合は教室までご連絡ください。';
    editor.appendChild(note);
  }

  /* ===== 回数・日程の変更（控えページの本体） ===== */

  function openPlanEditor() {
    var t = receipt.ticket;
    var today = todayJst();

    var cur = state.allSlots.filter(function (sl) {
      return sl.slotId === t.reservations[0].slotId;
    })[0];
    var part = cur ? cur.part : null;

    state.mode = 'edit';
    state.purchaseType = t.purchaseType;
    state.ticketType = t.ticketType;
    state.ageClass = t.ageClass;
    state.selected = t.reservations.map(function (r) { return r.slotId; });
    // 済んでしまった回は外せない
    state.lockedIds = t.reservations
      .filter(function (r) { return r.date <= today; })
      .map(function (r) { return r.slotId; });

    // 同じコースの時間帯で、明日以降の空きがある枠。すでに選んでいる分は残す
    state.slots = state.allSlots.filter(function (sl) {
      if (part && sl.part !== part) return false;
      if (state.selected.indexOf(sl.slotId) >= 0) return true;
      return sl.date > today && !sl.full;
    });

    var editor = $('#bk-editor');
    editor.innerHTML =
      '<h3 class="bk-subhead">回数と参加予定日</h3>' +
      '<div class="bk-field"><label for="bk-edit-type">回数</label>' +
      '<select id="bk-edit-type" class="bk-select"></select></div>' +
      '<div class="bk-summary"><span>選択中 <strong id="bk-edit-count"></strong></span>' +
      '<span>お支払い予定 <strong id="bk-edit-amount"></strong></span></div>' +
      '<p class="bk-pay-note">お支払いは初回レッスン時に現金でお支払いをお願いします</p>' +
      '<p id="bk-edit-select-msg" class="bk-select-msg"></p>' +
      '<div id="bk-edit-calendar"></div>' +
      '<p class="bk-cal-legend">★ … 育児のお悩み相談会はお休みの日（リトミックは通常どおり開講します）<br>' +
      '※当日および過去の日程は変更できません。お急ぎの場合は教室までご連絡ください。</p>' +
      '<p id="bk-edit-error" class="bk-error" role="alert"></p>' +
      '<p id="bk-edit-done" class="bk-select-msg bk-select-msg--done"></p>' +
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
      state.ticketType = Number(this.value);
      // 回数を減らしたときは、済んだ回を優先して残す
      if (state.selected.length > state.ticketType) {
        var keep = state.lockedIds.slice();
        state.selected.forEach(function (id) {
          if (keep.length < state.ticketType && keep.indexOf(id) < 0) keep.push(id);
        });
        state.selected = keep;
      }
      updateSelectionUI();
    });

    $('#bk-edit-submit').addEventListener('click', submitPlan);

    renderCalendar();
  }

  function submitPlan() {
    var btn = $('#bk-edit-submit');
    var err = $('#bk-edit-error');
    err.textContent = '';
    $('#bk-edit-done').textContent = '';
    btn.disabled = true;
    btn.textContent = '変更しています…';

    fetch(API_BASE + '/tickets/' + encodeURIComponent(receipt.ticketId) + '/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: receipt.token,
        ticketType: state.ticketType,
        slotIds: state.selected
      })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) {
          err.textContent = r.data.message || '変更できませんでした。';
          btn.disabled = false;
          btn.textContent = 'この内容に変更する';
          return;
        }
        state.mode = 'form';
        loadReceipt(receipt.ticketId, receipt.token);
        window.setTimeout(function () {
          var d = $('#bk-edit-done');
          if (d) d.textContent = '変更内容を保存しました。';
        }, 600);
      })
      .catch(function () {
        err.textContent = '通信に失敗しました。時間をおいてお試しください。';
        btn.disabled = false;
        btn.textContent = 'この内容に変更する';
      });
  }

  /* ===== 初期化 ===== */

  document.addEventListener('DOMContentLoaded', function () {
    $('#bk-trial-link').href = TRIAL_FORM_URL;

    var params = new URLSearchParams(location.search);
    var ticketId = params.get('ticket');
    var token = params.get('token');
    if (ticketId && token) {
      loadReceipt(ticketId, token);
      return;
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name=ageClass]'),
      function (el) {
        el.addEventListener('change', function () {
          state.ageClass = el.value;
          applyAgeClass();
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

    $('#bk-form').addEventListener('submit', onSubmit);

    loadSlots();
  });
})();

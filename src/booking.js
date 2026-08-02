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
    allSlots: [],
    slots: [],
    selected: [],
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
    var start = state.validFrom.slice(0, 7).split('-');
    var y = Number(start[0]);
    var m = Number(start[1]);
    var end = state.validTo.slice(0, 7);
    while (true) {
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
    var wrap = $('#bk-calendar');
    wrap.innerHTML = '';

    if (state.slots.length === 0) {
      $('#bk-calendar-status').textContent =
        'この期間にご予約可能な開講日がありません。教室までお問い合わせください。';
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
        if (!btn.classList.contains('bk-cal-day--full')) {
          btn.disabled = !on && got >= need;
        }
      }
    );

    $('#bk-count').textContent = got + ' / ' + need + ' 日';
    $('#bk-amount').textContent = formatYen(estimateAmount());

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

  /* ===== 控えの表示と日程変更 ===== */

  var receipt = { ticketId: '', token: '', ticket: null };

  function loadReceipt(ticketId, token) {
    $('#bk-form-section').hidden = true;
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
        // 変更先の候補を出すため、開講枠も読み込んでおく
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

  function todayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function renderReceipt() {
    var t = receipt.ticket;
    var box = $('#bk-lookup-body');
    box.innerHTML = '';

    var dl = document.createElement('dl');
    dl.className = 'bk-receipt-list';
    [
      ['お名前', t.childName],
      ['お申込み', t.purchaseType === 'single'
        ? '単発レッスン ' + t.ticketType + '回'
        : t.ticketType + '回券'],
      ['お支払い金額', formatYen(t.amount)],
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

    var h = document.createElement('h3');
    h.className = 'bk-subhead';
    h.textContent = '参加予定日';
    box.appendChild(h);

    var msg = document.createElement('p');
    msg.className = 'bk-error';
    msg.id = 'bk-change-msg';
    box.appendChild(msg);

    var today = todayJst();

    var ul = document.createElement('ul');
    ul.className = 'bk-date-list';
    t.reservations.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'bk-res-row';

      var label = document.createElement('span');
      label.textContent = r.date.slice(0, 4) + '年' + formatDateJa(r.date);
      li.appendChild(label);

      if (r.date > today) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline btn-sm';
        btn.textContent = '変更';
        btn.addEventListener('click', function () { openChange(r); });
        li.appendChild(btn);
      } else {
        var past = document.createElement('span');
        past.className = 'bk-res-past';
        past.textContent = '変更不可';
        li.appendChild(past);
      }

      ul.appendChild(li);
    });
    box.appendChild(ul);

    var note = document.createElement('p');
    note.className = 'bk-hint';
    note.textContent =
      '※当日および過去の日程は変更できません。お急ぎの場合は教室までご連絡ください。';
    box.appendChild(note);

    var panel = document.createElement('div');
    panel.id = 'bk-change-panel';
    panel.className = 'bk-change-panel';
    panel.hidden = true;
    box.appendChild(panel);
  }

  /** 変更先の候補を表示する */
  function openChange(res) {
    var t = receipt.ticket;
    var today = todayJst();
    var taken = t.reservations.map(function (r) { return r.slotId; });

    // 同じ時間帯（コース）の枠のみを候補にする
    var current = state.allSlots.filter(function (sl) { return sl.slotId === res.slotId; })[0];
    var part = current ? current.part : null;

    var candidates = state.allSlots.filter(function (sl) {
      return (
        sl.date > today &&
        !sl.full &&
        taken.indexOf(sl.slotId) < 0 &&
        (part === null || sl.part === part)
      );
    });

    var panel = $('#bk-change-panel');
    panel.hidden = false;
    panel.innerHTML = '';

    var h = document.createElement('h3');
    h.className = 'bk-subhead';
    h.textContent = formatDateJa(res.date) + ' の変更先をお選びください';
    panel.appendChild(h);

    if (candidates.length === 0) {
      var none = document.createElement('p');
      none.className = 'bk-hint';
      none.textContent = '変更できる空きの日程がありません。教室までご連絡ください。';
      panel.appendChild(none);
      return;
    }

    var list = document.createElement('div');
    list.className = 'bk-change-list';
    candidates.forEach(function (sl) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-change-item';
      var d = document.createElement('span');
      d.textContent = formatDateJa(sl.date) + ' ' + sl.startTime + '〜';
      var m = document.createElement('span');
      m.className = 'bk-change-rest';
      m.textContent = '残' + sl.remaining;
      b.appendChild(d);
      b.appendChild(m);
      b.addEventListener('click', function () { submitChange(res.slotId, sl); });
      list.appendChild(b);
    });
    panel.appendChild(list);

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-outline btn-sm';
    cancel.textContent = 'やめる';
    cancel.addEventListener('click', function () { panel.hidden = true; });
    panel.appendChild(cancel);

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function submitChange(fromSlotId, toSlot) {
    if (!window.confirm(formatDateJa(toSlot.date) + ' に変更します。よろしいですか？')) return;

    var panel = $('#bk-change-panel');
    panel.textContent = '変更しています…';

    fetch(API_BASE + '/tickets/' + encodeURIComponent(receipt.ticketId) + '/change', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: receipt.token,
        fromSlotId: fromSlotId,
        toSlotId: toSlot.slotId
      })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) {
          loadReceipt(receipt.ticketId, receipt.token);
          window.setTimeout(function () {
            var m = $('#bk-change-msg');
            if (m) m.textContent = r.data.message || '変更できませんでした。';
          }, 400);
          return;
        }
        // 最新の内容を読み直す
        loadReceipt(receipt.ticketId, receipt.token);
      })
      .catch(function () {
        panel.hidden = true;
        var m = $('#bk-change-msg');
        if (m) m.textContent = '通信に失敗しました。時間をおいてお試しください。';
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

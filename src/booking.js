/* リトミック予約フォーム（限定公開ページ /rythmique/r7k2m9x4/ 専用） */
(function () {
  'use strict';

  var API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
  var TRIAL_FORM_URL =
    'https://docs.google.com/forms/d/1D1GHXF9IeXEmMy0lBG19rGpgoC9d2AB9rEwnRlm72jE/viewform';

  var ADMISSION_FEE = 1000;
  var TICKET_PRICES = {
    age0_2: { 6: 12500, 7: 13000, 8: 13500 },
    age3_5: { 6: 17000, 7: 17500, 8: 18000 }
  };
  var SINGLE_PRICES = { age0_2: 2500, age3_5: 3000 };

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var state = {
    slots: [],
    selected: [],
    ageClass: 'age0_2',
    purchaseType: 'ticket',
    ticketType: 6,
    isFirstTime: true
  };

  var $ = function (sel) { return document.querySelector(sel); };

  function requiredCount() {
    return state.ticketType;
  }

  function formatYen(n) {
    return n.toLocaleString('ja-JP') + '円';
  }

  function estimateAmount() {
    var base =
      state.purchaseType === 'single'
        ? SINGLE_PRICES[state.ageClass] * state.ticketType
        : TICKET_PRICES[state.ageClass][state.ticketType];
    return base + (state.isFirstTime ? ADMISSION_FEE : 0);
  }

  /* ===== 開講枠の読み込み ===== */

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function addMonths(month, n) {
    var parts = month.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]) + n;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12) + 1;
    return y + '-' + String(m).padStart(2, '0');
  }

  function loadSlots() {
    var from = currentMonth();
    var to = addMonths(from, 7);
    var status = $('#bk-calendar-status');
    status.textContent = '開講日を読み込んでいます…';

    fetch(API_BASE + '/slots?from=' + from + '&to=' + to)
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var today = new Date().toISOString().slice(0, 10);
        state.slots = (data.slots || []).filter(function (s) {
          return s.date >= today && s.status === 'open';
        });
        status.textContent = '';
        renderCalendar();
      })
      .catch(function () {
        status.textContent =
          '開講日を読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。';
      });
  }

  /* ===== カレンダー描画 ===== */

  function renderCalendar() {
    var wrap = $('#bk-calendar');
    wrap.innerHTML = '';

    if (state.slots.length === 0) {
      $('#bk-calendar-status').textContent = '現在ご予約可能な開講日がありません。';
      return;
    }

    var byMonth = {};
    state.slots.forEach(function (s) {
      var m = s.date.slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push(s);
    });

    Object.keys(byMonth).sort().forEach(function (month) {
      var group = document.createElement('div');
      group.className = 'bk-month';

      var h = document.createElement('h4');
      h.className = 'bk-month-title';
      h.textContent = month.split('-')[0] + '年' + Number(month.split('-')[1]) + '月';
      group.appendChild(h);

      var list = document.createElement('div');
      list.className = 'bk-slot-list';

      byMonth[month].forEach(function (slot) {
        list.appendChild(renderSlot(slot));
      });

      group.appendChild(list);
      wrap.appendChild(group);
    });

    updateSelectionUI();
  }

  function renderSlot(slot) {
    var d = new Date(slot.date + 'T00:00:00+09:00');
    var label = document.createElement('label');
    label.className = 'bk-slot';
    if (slot.full) label.classList.add('bk-slot--full');

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = slot.slotId;
    input.disabled = !!slot.full;
    input.addEventListener('change', onSlotToggle);

    var main = document.createElement('span');
    main.className = 'bk-slot-main';

    var date = document.createElement('span');
    date.className = 'bk-slot-date';
    date.textContent =
      Number(slot.date.slice(5, 7)) + '月' + Number(slot.date.slice(8, 10)) + '日（' +
      WEEKDAYS[d.getDay()] + '）';

    var time = document.createElement('span');
    time.className = 'bk-slot-time';
    time.textContent = slot.startTime + '〜' + slot.endTime;

    main.appendChild(date);
    main.appendChild(time);

    var meta = document.createElement('span');
    meta.className = 'bk-slot-meta';
    if (slot.full) {
      meta.textContent = '満席';
      meta.classList.add('bk-slot-meta--full');
    } else {
      meta.textContent = '残り' + slot.remaining + '名';
    }
    main.appendChild(meta);

    label.appendChild(input);
    label.appendChild(main);

    if (slot.counselorAbsent) {
      var note = document.createElement('span');
      note.className = 'bk-slot-note';
      note.textContent = '※この日は育児のお悩み相談会はお休みです（リトミックは通常どおり開講）';
      label.appendChild(note);
    }

    return label;
  }

  function onSlotToggle(e) {
    var id = e.target.value;
    if (e.target.checked) {
      if (state.selected.length >= requiredCount()) {
        e.target.checked = false;
        return;
      }
      state.selected.push(id);
    } else {
      state.selected = state.selected.filter(function (v) { return v !== id; });
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    var need = requiredCount();
    var got = state.selected.length;

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

    // 上限に達したら未選択のチェックボックスを無効化する
    var inputs = document.querySelectorAll('#bk-calendar input[type=checkbox]');
    Array.prototype.forEach.call(inputs, function (i) {
      var slot = state.slots.filter(function (s) { return s.slotId === i.value; })[0];
      if (slot && slot.full) return;
      i.disabled = !i.checked && got >= need;
    });

    $('#bk-submit').disabled = got !== need;
  }

  /* ===== 選択条件の変更 ===== */

  function resetSelection() {
    state.selected = [];
    var inputs = document.querySelectorAll('#bk-calendar input[type=checkbox]');
    Array.prototype.forEach.call(inputs, function (i) { i.checked = false; });
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

    var btn = $('#bk-submit');
    var errorBox = $('#bk-error');
    errorBox.textContent = '';
    btn.disabled = true;
    btn.textContent = '送信中…';

    var payload = {
      guardianName: $('#bk-guardian').value,
      childName: $('#bk-child').value,
      childBirthMonth: $('#bk-birth').value || undefined,
      email: $('#bk-email').value,
      tel: $('#bk-tel').value,
      ageClass: state.ageClass,
      purchaseType: state.purchaseType,
      ticketType: state.ticketType,
      isFirstTime: $('#bk-firsttime').checked,
      photoConsent: $('#bk-photo').checked,
      slotIds: state.selected,
      note: $('#bk-note').value,
      website: $('#bk-website').value
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
          // 満席エラーのときは最新の空き状況を取り直す
          if (r.status === 409) loadSlots();
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
      var dt = new Date(d + 'T00:00:00+09:00');
      li.textContent =
        d.slice(0, 4) + '年' + Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) +
        '日（' + WEEKDAYS[dt.getDay()] + '）';
      ul.appendChild(li);
    });

    var url = location.origin + location.pathname + '?ticket=' + data.ticketId + '&token=' + data.token;
    var link = $('#bk-receipt-link');
    link.href = url;
    link.textContent = url;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ===== 控えの表示 ===== */

  function loadReceipt(ticketId, token) {
    $('#bk-form-section').hidden = true;
    $('#bk-lookup').hidden = false;
    var box = $('#bk-lookup-body');
    box.textContent = '読み込んでいます…';

    fetch(API_BASE + '/tickets/' + encodeURIComponent(ticketId) + '?token=' + encodeURIComponent(token))
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(function (t) {
        box.innerHTML = '';
        var dl = document.createElement('dl');
        dl.className = 'bk-receipt-list';
        var rows = [
          ['お名前', t.childName + '（保護者：' + t.guardianName + '）'],
          ['お申込み', t.purchaseType === 'single' ? '単発レッスン ' + t.ticketType + '回' : t.ticketType + '回券'],
          ['お支払い金額', formatYen(t.amount)],
          ['有効期間', t.validFrom + ' 〜 ' + t.validTo],
          ['お手続き状況', t.status === 'paid' ? 'お支払い確認済み' : '受付済み（お支払い前）']
        ];
        rows.forEach(function (r) {
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

        var ul = document.createElement('ul');
        ul.className = 'bk-date-list';
        t.reservations.forEach(function (r) {
          var li = document.createElement('li');
          var dt2 = new Date(r.date + 'T00:00:00+09:00');
          li.textContent =
            r.date.slice(0, 4) + '年' + Number(r.date.slice(5, 7)) + '月' +
            Number(r.date.slice(8, 10)) + '日（' + WEEKDAYS[dt2.getDay()] + '）';
          ul.appendChild(li);
        });
        box.appendChild(ul);
      })
      .catch(function () {
        box.textContent =
          'お申込みが見つかりませんでした。URLが正しいかご確認ください。';
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
          updateSelectionUI();
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

    $('#bk-firsttime').addEventListener('change', function () {
      state.isFirstTime = this.checked;
      updateSelectionUI();
    });

    $('#bk-form').addEventListener('submit', onSubmit);

    loadSlots();
  });
})();

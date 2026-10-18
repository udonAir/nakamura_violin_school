document.addEventListener('DOMContentLoaded', () => {
    // Scroll Reveal Observer
    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -40px 0px'
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                obs.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const observeReveal = (root = document) => {
        root.querySelectorAll('.reveal:not(.visible)').forEach(el => observer.observe(el));
    };

    observeReveal();

    // Blog: note-posts.json から記事を読み込む
    const THUMB_PLACEHOLDER = `<div class="blog-card-thumb-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
        </div>`;

    const blogSection = document.getElementById('blog');
    const blogGrid = document.getElementById('blog-grid');

    const hideBlog = () => {
        if (blogSection) blogSection.style.display = 'none';
    };

    fetch('/assets/note-posts.json?v=' + Date.now())
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            const posts = data && data.posts;
            if (!posts || posts.length === 0) { hideBlog(); return; }
            if (!blogGrid) return;

            blogGrid.innerHTML = posts.slice(0, 3).map((post, i) => `
                <article class="blog-card reveal reveal-delay-${i + 1}">
                    ${post.thumbnail
                        ? `<img src="${post.thumbnail}" alt="${post.title}" class="blog-card-thumb" loading="lazy">`
                        : THUMB_PLACEHOLDER}
                    <div class="blog-card-body">
                        <p class="blog-card-date">${post.date}</p>
                        <h3 class="blog-card-title">${post.title}</h3>
                        <p class="blog-card-excerpt">${post.excerpt}</p>
                        <a href="${post.link}" target="_blank" rel="noopener" class="blog-card-link">続きを読む</a>
                    </div>
                </article>`).join('');

            if (blogSection) blogSection.style.display = 'block';
            observeReveal(blogGrid);
        })
        .catch(hideBlog);

    // Rythmique: 予約APIの公開エンドポイントから今後3か月分の開講日を表示する
    // API_BASE は src/booking.js と同じ値（APIを作り直したら両方更新する）
    const scheduleBox = document.getElementById('lesson-schedule');
    const scheduleList = document.getElementById('lesson-schedule-list');

    if (scheduleBox && scheduleList) {
        const API_BASE = 'https://tkokeft78i.execute-api.ap-northeast-1.amazonaws.com';
        const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

        // 日付の判定は日本時間で行う
        const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        const monthOffset = (ym, n) => {
            const [y, m] = ym.split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + n, 1));
            return d.toISOString().slice(0, 7);
        };
        const from = todayJst.slice(0, 7);
        const to = monthOffset(from, 2);

        fetch(`${API_BASE}/slots?from=${from}&to=${to}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                const slots = ((data && data.slots) || [])
                    .filter(s => s.status !== 'closed' && s.date >= todayJst);
                if (slots.length === 0) return;

                const byMonth = new Map();
                slots.forEach(s => {
                    const key = s.date.slice(0, 7);
                    if (!byMonth.has(key)) byMonth.set(key, []);
                    byMonth.get(key).push(s);
                });

                byMonth.forEach((items, ym) => {
                    const [y, m] = ym.split('-').map(Number);
                    const col = document.createElement('div');
                    col.className = 'lesson-schedule-month';

                    const head = document.createElement('h4');
                    head.textContent = `${y}年${m}月`;
                    col.appendChild(head);

                    const ul = document.createElement('ul');
                    items.forEach(s => {
                        const [, mm, dd] = s.date.split('-').map(Number);
                        const wd = WEEKDAYS[new Date(Date.UTC(y, mm - 1, dd)).getUTCDay()];
                        const li = document.createElement('li');
                        li.textContent = `${mm}/${dd}（${wd}）${s.startTime}〜${s.endTime}`;
                        if (s.status === 'cancelled') {
                            li.classList.add('is-cancelled');
                            li.insertAdjacentHTML('beforeend', '<span class="lesson-schedule-tag">休講</span>');
                        } else if (s.full) {
                            li.insertAdjacentHTML('beforeend', '<span class="lesson-schedule-tag">満席</span>');
                        }
                        ul.appendChild(li);
                    });
                    col.appendChild(ul);
                    scheduleList.appendChild(col);
                });

                scheduleBox.hidden = false;
            })
            .catch(() => { /* 取得できなければ非表示のまま */ });
    }

    // Mobile Navigation Toggle
    const navToggle = document.querySelector('.mobile-nav-toggle');
    const mainNav = document.getElementById('main-nav');
    const navLinks = document.querySelectorAll('.nav-list a');

    if (navToggle && mainNav) {
        navToggle.addEventListener('click', () => {
            const isActive = mainNav.classList.toggle('active');
            navToggle.classList.toggle('active');
            navToggle.setAttribute('aria-expanded', isActive);
            document.body.style.overflow = isActive ? 'hidden' : '';
        });

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                mainNav.classList.remove('active');
                navToggle.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            });
        });
    }
});

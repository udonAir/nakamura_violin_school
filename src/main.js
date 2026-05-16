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

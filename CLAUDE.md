# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static website for **なかむらバイオリン教室** (Nakamura Violin School), a music school in Takamatsu, Kagawa. Deployed via GitHub Pages at `nakamura-violin.com`.

No build step, no package manager, no framework — plain HTML/CSS/JS. To preview locally, open `index.html` directly in a browser.

## Deployment

Push to `main` → GitHub Pages auto-deploys to `nakamura-violin.com` (configured via `CNAME`).

After pushing, update `sitemap.xml`'s `<lastmod>` date to today.

The `robots.txt` still references the old GitHub Pages URL (`udonair.github.io/...`) in the Sitemap directive — this should eventually be updated to `https://nakamura-violin.com/sitemap.xml`.

## File Structure

```
index.html          # Single-page site (all content)
src/
  index.css         # All styles (design system + components)
  main.js           # Scroll reveal, modals, mobile nav
assets/
  favicon.svg       # Music note favicon (uguisu color #928c36)
  illust-*.png      # Section illustrations (About section)
  IMG_*.jpg/JPG     # Lesson/course photos
  instructor_processed.jpg
  Photo_457.jpg     # Piano instructor photo
```

## Design System

All design tokens are CSS custom properties in `src/index.css`:

- **Primary accent**: `--uguisu: #928c36` (uguisu-iro, an olive-green gold). `--accent-sage` and `--accent-gold` are aliases for the same value.
- **Backgrounds**: `--bg` (warm white `#fdfcfb`), `--bg-alt` (greige `#f4f2f0`)
- **Typography**: `--font-serif` (Shippori Mincho), `--font-sans` (Zen Maru Gothic), `--font-hand` (La Belle Aurore)
- Google Fonts loaded via `<link>` + `preconnect` in `<head>` (not `@import`)

Do not add inline `style=""` attributes — extract to CSS classes instead.

## Page Structure

Single page with these sections in order:
1. Announce bar (教室オープン予定 notice)
2. Header / nav (mobile hamburger menu)
3. Hero (CTA → Google Forms for trial lesson)
4. About (3 feature cards with illustrations)
5. Courses (Rhythmic / Violin / Piano cards → modals)
6. Instructor (2 instructors: バイオリン講師, ピアノ講師 宇野美桜)
7. Access (香川県高松市 — no fixed address yet)
8. Contact (Google Forms CTA)
9. Footer

## Business Context (important for content decisions)

- **Currently open**: Violin lessons (home visit / rental space), Online piano (宇野美桜 instructor)
- **Opening 2027**: Physical studio in 太田・多肥 area, Rhythmic course, Kids/Adult piano
- **No fixed address yet** (house under construction) → no Google Business Profile
- Course modals for unopened courses still show the inquiry CTA intentionally (for lead capture)

## JavaScript Patterns

`src/main.js` handles:
- **Scroll reveal**: IntersectionObserver adds `.visible` to `.reveal` elements, then unobserves (one-shot)
- **Modals**: `setupModal(btnId, modalId)` — closes on backdrop click, close button, or Escape key
- **Mobile nav**: hamburger toggles `.active` on `#main-nav`; closes on link click

## SEO

Structured data (JSON-LD `MusicSchool`), OGP, canonical URL, and sitemap are all in place. When making content changes, check whether `<meta name="description">` and OGP tags need updating to stay accurate.

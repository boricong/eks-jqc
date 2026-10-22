---
version: alpha
name: Notion Analysis
description: An analysis of Notion's design language — a warm, paper-calm productivity system built on an off-white canvas, near-black Inter type, and a single confident blue, punctuated by a playful multi-color sticker palette that does all the personality work while the chrome stays quiet.

colors:
  primary: "#0075de"
  primary-active: "#005bab"
  secondary: "#213183"
  on-primary: "#ffffff"
  canvas: "#ffffff"
  canvas-soft: "#f6f5f4"
  surface: "#ffffff"
  ink: "#000000"
  ink-secondary: "#31302e"
  ink-muted: "#615d59"
  ink-faint: "#a39e98"
  hairline: "#e6e6e6"
  accent-sky: "#62aef0"
  accent-purple: "#d6b6f6"
  accent-purple-deep: "#391c57"
  accent-pink: "#ff64c8"
  accent-orange: "#dd5b00"
  accent-orange-deep: "#793400"
  accent-teal: "#2a9d99"
  accent-green: "#1aae39"
  accent-brown: "#523410"

typography:
  display-1:
    fontFamily: NotionInter
    fontSize: 64px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: -2.125px
  display-2:
    fontFamily: NotionInter
    fontSize: 54px
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: -1.875px
  heading-1:
    fontFamily: NotionInter
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -1px
  heading-2:
    fontFamily: NotionInter
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.23
    letterSpacing: -0.625px
  heading-3:
    fontFamily: NotionInter
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.27
    letterSpacing: -0.25px
  title:
    fontFamily: NotionInter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.125px
  body-md:
    fontFamily: NotionInter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: NotionInter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: 0
  button:
    fontFamily: NotionInter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: NotionInter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0
  eyebrow:
    fontFamily: NotionInter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: 0.125px

rounded:
  xs: 4px
  sm: 5px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 28px
  xxl: 32px

components:
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: 16px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
  button-utility:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 4px 14px
  button-icon-circular:
    backgroundColor: "rgba(0, 0, 0, 0.05)"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
  badge-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.full}"
    padding: 4px 8px
  feature-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 24px
  feature-card-elevated:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 24px
  pricing-plan-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 24px
  pricing-plan-card-featured:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 24px
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    padding: 6px
  hero-band:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-1}"
    padding: 32px
  footer:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.caption}"
    padding: 32px

  # ─── Examples (illustrative) — auto-derived; resolve any TO_FILL markers below ───
  ex-pricing-tier:
    description: "Default Pricing tier card. Re-uses feature-card chrome with brand canvas-soft surface."
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  ex-pricing-tier-featured:
    description: "Featured/highlighted tier — polarity-flipped surface (dark fill + light text in light mode, light fill + dark text in dark mode)."
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  ex-product-selector:
    description: "What's Included summary card — re-purposed for SaaS / B2B verticals (NOT a literal product gallery)."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  ex-cart-drawer:
    description: "Subscription summary — re-purposed for SaaS / B2B (line items per add-on, not literal cart)."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
    item-divider: "{colors.hairline}"
  ex-app-shell-row:
    description: "Sidebar nav row inside the App Shell example. Active state uses brand primary as the indicator."
    backgroundColor: "{colors.canvas}"
    activeIndicator: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  ex-data-table-cell:
    description: "Default data-table th + td chrome. Header uses mono-caps eyebrow typography; body uses body-sm."
    headerBackground: "{colors.canvas-soft}"
    headerTypography: "{typography.eyebrow}"
    bodyTypography: "{typography.body-sm}"
    cellPadding: "{spacing.sm} {spacing.md}"
    rowBorder: "{colors.hairline}"
  ex-auth-form-card:
    description: "Sign-in / sign-up card. Re-uses feature-card chrome with text-input primitives inside."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  ex-modal-card:
    description: "Modal dialog surface — same chrome as feature-card with elevated shadow."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  ex-empty-state-card:
    description: "Empty-state illustration frame."
    backgroundColor: "{colors.canvas-soft}"
    rounded: "{rounded.xl}"
    padding: "{spacing.xxl}"
    captionTypography: "{typography.body-md}"
  ex-toast:
    description: "Toast notification surface — feature-card shape + medium shadow."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.sm} {spacing.md}"
    typography: "{typography.body-sm}"

---


## Overview

Notion looks like a well-organized desk in good daylight. The dominant surface is not pure white but a warm, paper-soft off-white — `{colors.canvas-soft}` (#f6f5f4) — that takes the clinical edge off the screen and makes long pages feel like a document rather than an app. Type is set in `NotionInter` (a tuned Inter) in near-black `{colors.ink}` at large, tightly-tracked weights, so headlines read as confident statements with very little letter-spacing slack at display sizes (`{typography.display-1}` pulls −2.125px of tracking at 64px). The whole system whispers in greys and blacks, then says exactly one thing in colour: a single, dependable blue, `{colors.primary}` (#0075de), reserved almost entirely for the primary call-to-action and inline links.

Against that quiet chrome, Notion lets a **playful multi-colour sticker palette** carry all of the brand's personality — purple, pink, orange, teal, green and sky-blue appear as small illustrated blocks, app-icon stickers, and category dots scattered through the marketing pages. These colours never structure the layout or paint a CTA; they decorate. The discipline is deliberate: the interface stays monochrome-plus-blue so the content (and the cheerful illustrations) can breathe. The one exception to the bright daylight is the homepage hero, which inverts into a deep indigo "night" band (`{colors.secondary}`) with white type and glowing sticker constellations — a single dark island in an otherwise light document.

Surfaces are defined by hairlines and the faintest layered shadows rather than heavy elevation. Cards round at a friendly 12px (`{rounded.lg}`), the marketing CTAs are fully-pill-shaped (`{rounded.full}`), and utility buttons round at a tighter 8px (`{rounded.md}`). Nothing is loud; the brand's character comes from restraint plus one well-placed splash of joy.

**Key Characteristics:**
- Warm paper-soft canvas `{colors.canvas-soft}` over pure white, never clinical
- Near-black `{colors.ink}` `NotionInter` type with tight negative tracking at display sizes (`{typography.display-1}`)
- Exactly one structural accent — Notion blue `{colors.primary}` — reserved for CTAs and links
- A decorative-only multi-colour sticker palette (`{colors.accent-purple}`, `{colors.accent-pink}`, `{colors.accent-orange}`, `{colors.accent-teal}`, `{colors.accent-green}`, `{colors.accent-sky}`) that adds personality without ever painting structure
- Pill-shaped marketing CTAs (`{rounded.full}`) contrasted with 8px utility buttons (`{rounded.md}`)
- Elevation by hairline + barely-there layered shadow, not heavy drop-shadows
- A single dark indigo hero "night" band (`{colors.secondary}`) inverting the otherwise daylight page rhythm

## Colors

> Source pages analysed: the Notion home page plus Pricing, Enterprise, Product (AI), Product (Agents), and Startups. Every secondary page resolved to the same core palette — Notion runs one tightly-scoped system across the marketing site.

### Brand & Accent
- **Notion Blue** (`{colors.primary}` — #0075de): the single structural accent. Primary CTA fill ("Get Notion free"), inline link colour, active-tab and focus signal. This is the only colour that ever paints an action.
- **Pressed Blue** (`{colors.primary-active}` — #005bab): the darker press state of the primary CTA.
- **Deep Indigo** (`{colors.secondary}` — #213183): the dark hero "night" band background and its sticker-constellation field; a deep brand-blue used for full-bleed inverted sections.

The remaining colours form Notion's **decorative sticker palette** — they appear only as illustrated blocks, app stickers and category dots, never as CTAs or structural fills:
- **Sticker Sky** (`{colors.accent-sky}` — #62aef0)
- **Sticker Purple** (`{colors.accent-purple}` — #d6b6f6) / **Deep Purple** (`{colors.accent-purple-deep}` — #391c57)
- **Sticker Pink** (`{colors.accent-pink}` — #ff64c8)
- **Sticker Orange** (`{colors.accent-orange}` — #dd5b00) / **Deep Orange** (`{colors.accent-orange-deep}` — #793400)
- **Sticker Teal** (`{colors.accent-teal}` — #2a9d99)
- **Sticker Green** (`{colors.accent-green}` — #1aae39)
- **Sticker Brown** (`{colors.accent-brown}` — #523410)

### Surface
- **White** (`{colors.canvas}` / `{colors.surface}` — #ffffff): card and panel surfaces, nav bar, form fields.
- **Warm Paper** (`{colors.canvas-soft}` — #f6f5f4): the signature page canvas and the footer band — a warm off-white that gives the whole site its document-like calm.
- **Hairline** (`{colors.hairline}` — #e6e6e6): 1px card borders and dividers, a black-at-10%-on-white blend kept solid for token reuse.

### Text
- **Ink** (`{colors.ink}` — #000000): primary headings and body text (rendered at ~95% alpha for a soft true-black).
- **Warm Charcoal** (`{colors.ink-secondary}` — #31302e): secondary body copy and footer text.
- **Stone** (`{colors.ink-muted}` — #615d59): supporting / muted copy.
- **Ash** (`{colors.ink-faint}` — #a39e98): captions, metadata, placeholder text.

### Semantic
Notion's marketing surfaces do not expose a dedicated error/success palette in the system chrome — status is carried by the sticker palette (e.g. `{colors.accent-green}` for affirmative ticks) rather than a separate semantic ramp.

## Typography

### Font Family
The entire system is set in **`NotionInter`** — Notion's tuned cut of Inter — with a fallback stack of `Inter, -apple-system, system-ui, "Segoe UI", Helvetica, Arial`. A single family carries everything from 64px display headlines to 12px eyebrows; there is no serif, no monospace display face. OpenType `lnum` (lining numerals) and `locl` features are enabled on body and heading roles.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-1}` | 64px | 700 | 1.0 | −2.125px | Hero headline ("Meet the night shift") |
| `{typography.display-2}` | 54px | 700 | 1.04 | −1.875px | Large section headlines |
| `{typography.heading-1}` | 40px | 700 | 1.1 | −1px | Section headlines ("Plans and features") |
| `{typography.heading-2}` | 26px | 700 | 1.23 | −0.625px | Sub-section headings |
| `{typography.heading-3}` | 22px | 700 | 1.27 | −0.25px | Card titles |
| `{typography.title}` | 20px | 600 | 1.4 | −0.125px | Feature titles, callouts |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0 | Default body copy |
| `{typography.body-sm}` | 15px | 400 | 1.33 | 0 | Dense body, table rows, nav |
| `{typography.button}` | 16px | 500 | 1.5 | 0 | Button labels |
| `{typography.caption}` | 14px | 400 | 1.43 | 0 | Captions, footnotes |
| `{typography.eyebrow}` | 12px | 600 | 1.33 | +0.125px | Pill badges, small labels |

### Principles
Notion's type voice is **tight, heavy, and quiet-confident**. Headlines lean on weight 700 and aggressive negative tracking (more negative the larger the size) so display copy feels set, not stretched. Body copy stays at a comfortable 1.5 line-height for document readability. The contrast between a heavy 700 headline and a calm 400 body is the primary expressive lever — there is no decorative typography, only a clear hierarchy.

### Note on Font Substitutes
`NotionInter` is a proprietary tuning of the open-source **Inter** family — substitute Inter directly. To approximate Notion's display tightness, apply the negative letter-spacing values in the table above explicitly (Inter at default tracking will read looser than `NotionInter`).

## Layout

### Spacing System
- **Base unit**: 8px.
- **Tokens (front matter)**: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 28px · `{spacing.xxl}` 32px.
- Card interior padding lands around `{spacing.lg}` (24px); utility buttons use a tight 4px/14px; form fields pad at `{spacing.xxs}`-scale 6px. Section gaps stack the larger steps.

### Grid & Container
Content is centred in a wide max-width column (~1080–1300px on desktop per the extracted breakpoints) with generous outer gutters. Feature sections alternate between full-width text blocks and 2-up / 3-up card grids; the pricing page widens to a 4-column plan table. The dark hero spans full-bleed edge to edge while body sections respect the centred container.

### Whitespace Philosophy
Whitespace is the primary grouping device. Sections are separated by large vertical gaps rather than rules, and cards sit on the warm canvas with quiet hairlines instead of heavy frames. The effect is document-like: airy, scannable, and never crowded.

### Responsive Strategy

#### Breakpoints
| Name | Width | Key Changes |
|---|---|---|
| Wide | 1440px+ | Full multi-column grids, widest container |
| Desktop | 1080–1300px | Standard centred container, 3-up card grids |
| Tablet | 768–840px | Grids collapse to 2-up, nav begins condensing |
| Mobile | ≤600px | Single-column stacks, hamburger nav, full-width CTAs |

#### Touch Targets
Pill CTAs (`button-primary`, `button-secondary`) and utility buttons (`button-utility`) carry comfortable tap padding; aim for a 44×44px minimum hit area on mobile by preserving vertical padding even as labels shrink.

#### Collapsing Strategy
The top nav condenses to a hamburger below the tablet breakpoint; multi-column card grids collapse to a single stacked column; the pricing plan table reflows from 4 side-by-side columns into stacked plan cards. Section padding tightens but the warm-canvas rhythm is preserved.

#### Image Behavior
Product screenshots and illustration tiles sit inside rounded `{rounded.lg}` frames and scale fluidly within their grid cell. Sticker illustrations are small fixed-scale decorative assets that re-flow but do not crop.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | Hairline border `{colors.hairline}`, no shadow | Default cards on the warm canvas |
| 1 — Soft | Layered micro-shadow: `rgba(0,0,0,0.01) 0 0.175px 1.041px`, `0.02 0 0.8px 2.925px`, `0.027 0 2.025px 7.847px`, `0.04 0 4px 18px` | Raised feature cards, floating buttons |
| 2 — Elevated | Deeper 5-stop stack ending in `rgba(0,0,0,0.05) 0 23px 52px` | Modals, popovers, the elevated white pill on the dark hero |

Notion's elevation philosophy is **barely-there**: shadows are built from many near-transparent layers so surfaces feel gently lifted off the paper rather than dramatically dropped. Most cards rely on a hairline alone.

### Decorative Depth
The brand's real depth cue is **illustration**, not shadow. The dark indigo hero (`{colors.secondary}`) uses glowing sticker stickers and a starfield to create a sense of a lit night scene, and feature sections layer small colourful app-icon stickers over plain surfaces to add playful dimensionality. Colour-blocked illustration tiles (purple, pink, orange, teal headers on otherwise-white cards) provide visual rhythm.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Form fields, small tags, inline chips |
| `{rounded.sm}` | 5px | Menu items, list rows, status pills |
| `{rounded.md}` | 8px | Utility / nav buttons, smaller cards |
| `{rounded.lg}` | 12px | Feature cards, illustration frames, content tiles |
| `{rounded.xl}` | 16px | Large containers, image wells |
| `{rounded.full}` | 9999px | Marketing pill CTAs, badges, circular icon buttons |

### Photography Geometry
Product screenshots are framed in rounded `{rounded.lg}` / `{rounded.xl}` wells, typically full-bleed within their container with a hairline edge. Illustration tiles use colour-blocked header bands above white card bodies. Avatars and app-icon stickers are small, sometimes fully circular (`{rounded.full}`). There is no heavy art-direction crop — images scale within their rounded frame.

## Components

> **No hover states documented.** Every spec below documents Default and Active/Pressed states only. Variants live as separate `components:` front-matter entries and are described in their own sub-blocks.

### Navigation

**`nav-bar`** — Top navigation
- White surface `{colors.canvas}`, `{colors.ink}` link text at `{typography.body-sm}`, padding `{spacing.md}`. Sits as a slim sticky bar; left wordmark, centre product/solutions menu links, right "Log in" text link plus a `button-utility` "Get Notion free" CTA. Condenses to a hamburger below the tablet breakpoint.

### Buttons

**`button-primary`** — Primary CTA ("Get Notion free")
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}`, fully pill-shaped `{rounded.full}`. The single blue action on any page.
- Pressed state lives in `button-primary-pressed` (background `{colors.primary-active}`); marketing buttons also apply a brief `scale(0.9)` press transform.

**`button-primary-pressed`**
- Background `{colors.primary-active}`, text `{colors.on-primary}` — the depressed state of the primary CTA.

**`button-secondary`** — Secondary CTA ("Request a demo")
- White surface `{colors.surface}`, text `{colors.ink}`, type `{typography.button}`, pill `{rounded.full}`, carried by the soft Level-1 shadow. Pairs beside `button-primary` in the hero.

**`button-utility`** — Nav / plan-select button
- White surface `{colors.surface}`, text `{colors.ink}`, type `{typography.button}`, tighter `{rounded.md}` (8px), padding `4px 14px`, 1px `{colors.hairline}` border. Used for the nav CTA and pricing plan-select buttons where the marketing pill would be too large.

**`button-icon-circular`** — Carousel / media control
- Circular `{rounded.full}` control with a translucent `rgba(0,0,0,0.05)` fill and `{colors.on-primary}` glyph, used for slide and play/pause controls; applies a `scale(0.9)` press transform.

### Cards & Containers

**`feature-card`** — Content / feature card
- White surface `{colors.surface}`, `{colors.ink}` text, `{typography.body-md}`, rounded `{rounded.lg}` (12px), padding `{spacing.lg}` (24px). The workhorse marketing card; often topped by a colour-blocked illustration band from the sticker palette. Default elevation is flat (hairline only).

**`feature-card-elevated`** — Raised feature card
- Same chrome as `feature-card` with the soft Level-1 layered shadow for cards that float above the canvas (testimonials, floating product panels).

**`pricing-plan-card`** — Pricing plan column
- White surface `{colors.surface}`, `{colors.ink}` text, `{typography.body-sm}`, rounded `{rounded.md}` (8px), padding `{spacing.lg}`. A bordered column listing a plan's price and feature checklist, with a `button-utility` select action.

**`pricing-plan-card-featured`** — Highlighted plan column
- Warm `{colors.canvas-soft}` fill to lift the recommended tier off the white siblings, same `{rounded.md}` shape and padding. Distinguished by surface tint rather than a coloured border.

### Inputs & Forms

**`text-input`** — Text / number field
- White surface `{colors.surface}`, `{colors.ink}` text, `{typography.body-sm}`, 1px `rgb(221,221,221)` border, rounded `{rounded.xs}` (4px), padding `6px`. Square-ish corners deliberately tighter than the pill CTAs. Focus adds the soft Level-1 shadow.

### Signature Components

**`hero-band`** — Dark "night" hero
- Full-bleed deep indigo `{colors.secondary}` band carrying `{typography.display-1}` white headline, sticker-constellation field, and a `button-primary` + `button-secondary` CTA pair. The single inverted dark island in an otherwise daylight page.

**`badge-pill`** — Eyebrow / category pill
- White surface `{colors.surface}`, `{colors.primary}` text, `{typography.eyebrow}` (12px / 600), fully pill `{rounded.full}`, padding `4px 8px`. Small labels such as the pricing "Essential for staying organized" eyebrow and category tags.

**`footer`** — Site footer
- Warm `{colors.canvas-soft}` band, `{colors.ink-secondary}` link text at `{typography.caption}`, padding `{spacing.xxl}`. Multi-column link directory closing every page.

### Examples (illustrative)

> Kit-mirror demonstration surfaces. Each `ex-*` entry references brand-native primitives so downstream consumers (`/preview-design`, `/generate-kit`) re-skin the same 10 surfaces consistently.

**`ex-pricing-tier`** — Default Pricing tier card. Re-uses feature-card chrome with brand canvas-soft surface.
- Properties: `backgroundColor`, `textColor`, `borderColor`, `rounded`, `padding`

**`ex-pricing-tier-featured`** — Featured/highlighted tier — polarity-flipped surface (dark fill + light text in light mode, light fill + dark text in dark mode).
- Properties: `backgroundColor`, `textColor`, `rounded`, `padding`

**`ex-product-selector`** — What's Included summary card — re-purposed for SaaS / B2B verticals (NOT a literal product gallery).
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-cart-drawer`** — Subscription summary — re-purposed for SaaS / B2B (line items per add-on, not literal cart).
- Properties: `backgroundColor`, `rounded`, `padding`, `item-divider`

**`ex-app-shell-row`** — Sidebar nav row inside the App Shell example. Active state uses brand primary as the indicator.
- Properties: `backgroundColor`, `activeIndicator`, `rounded`, `padding`

**`ex-data-table-cell`** — Default data-table th + td chrome. Header uses mono-caps eyebrow typography; body uses body-sm.
- Properties: `headerBackground`, `headerTypography`, `bodyTypography`, `cellPadding`, `rowBorder`

**`ex-auth-form-card`** — Sign-in / sign-up card. Re-uses feature-card chrome with text-input primitives inside.
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-modal-card`** — Modal dialog surface — same chrome as feature-card with elevated shadow.
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-empty-state-card`** — Empty-state illustration frame.
- Properties: `backgroundColor`, `rounded`, `padding`, `captionTypography`

**`ex-toast`** — Toast notification surface — feature-card shape + medium shadow.
- Properties: `backgroundColor`, `rounded`, `padding`, `typography`


## Do's and Don'ts

### Do
- Reserve `{colors.primary}` for the primary action, inline links, and the active/focus signal — nothing decorative.
- Keep the page on the warm `{colors.canvas-soft}` canvas; use pure white `{colors.surface}` for cards and fields to create gentle figure/ground.
- Let the sticker palette (`{colors.accent-pink}`, `{colors.accent-teal}`, `{colors.accent-orange}`, …) live only in illustrations, icon tiles and category dots.
- Set headlines in heavy `{typography.display-1}`/`{typography.heading-1}` with their negative tracking applied explicitly.
- Use pill `{rounded.full}` for marketing CTAs and tighter `{rounded.md}` for nav/utility buttons — the contrast is intentional.
- Define surfaces with `{colors.hairline}` and the barely-there Level-1 shadow rather than heavy drop-shadows.
- Reserve the deep indigo `{colors.secondary}` "night" treatment for a single hero moment, not repeated bands.

### Don't
- Don't paint a CTA or structural fill in any sticker-palette colour — those are decoration only.
- Don't introduce a second structural accent alongside `{colors.primary}`.
- Don't put pill `{rounded.full}` radii on form fields — inputs stay tight at `{rounded.xs}` (4px).
- Don't drop heavy shadows; Notion's elevation is many near-transparent layers, never a hard cast.
- Don't set body copy in a heavy weight — keep 400 for readability and let weight 700 belong to headlines.
- Don't place type on pure clinical white for full pages; the warm `{colors.canvas-soft}` is core to the brand calm.

## EKS 업무 화면 적용 규칙 (2026-10-21)

이 문서를 유일한 디자인 기준으로 사용한다. 아래 규칙은 위 브랜드 원칙을 인증 업무 화면에 적용하는 사용자 확정 사항이다. 기존 라이트/다크 선택 및 별도 테마 정책은 폐지한다. 마케팅 예시의 다크 hero, 대형 display, 장식 팔레트를 업무 화면에 새로 추가하지 않는다.

- **단일 밝은 스타일:** 바탕 `#F6F5F4`, 패널·입력 `#FFFFFF`, 본문 `#000000`, 보조 설명 `#615D59`, 주요 행동 `#0075DE`, 눌림 `#005BAB`. 상태는 중립 배경과 아이콘·명칭으로 구분한다. 예전 브라우저 테마 설정은 읽거나 삭제하지 않는다.
- **작업 폭:** 일반 화면·홈·개별 편집 최대 1280px, 관리 목록·시스템 운영·Excel 표 작업 최대 1760px. 역할별 홈 구성, 검색·필터·페이지, 목록 밀도 40/48px는 유지한다. 큰 표만 내부 가로 스크롤을 사용한다.
- **글꼴·위계:** Inter 대체 글꼴과 한글 Pretendard를 사용한다. 제목 700(40/26/22px), 본문 400(16px), 관리 표 15px, 버튼 500. 좁은 화면의 큰 제목은 32px까지 줄인다. 목록·탭 요약 이외의 긴 내용은 줄바꿈하여 전부 읽을 수 있어야 한다.
- **형태·간격:** 입력 4px, 보조 버튼 8px, 패널 12px, 대화상자 16px. 주요 행동은 pill 형태를 사용한다. 4·8·12·16·24·28·32px 간격 체계를 기본으로 하고 표·문항·일정은 업무 밀도에 맞춰 조정한다. 아이콘과 라벨은 flex/grid 정렬을 사용한다.
- **대비:** `ink-faint`는 의미 있는 작은 글자에 사용하지 않는다. 종이색 배경의 작은 링크는 `#005BAB`을 사용한다. `hairline`은 장식 구분선이고 입력·필수 조작 경계는 `#615D59`로 구분한다. 일반 글자 4.5:1, 큰 글자·필수 조작 경계 3:1 이상을 검증한다.
- **접근성:** 모바일 주요 조작은 44px 이상이다. 오류 입력을 중앙으로 이동하여 고정 저장 영역에 가리지 않는다. 대화상자는 제목·초점·키보드 닫기, 탭은 `tablist/tab/tabpanel`·연결 ID·선택 상태·좌우/Home/End 이동을 제공한다.
- **학습 항목·문항 탐색:** 왼쪽 세로 번호(1, 2, 3)와 오른쪽 한 항목 편집을 사용한다. 번호 외 이름은 본문·툴팁·접근 가능한 이름에서 확인한다. 44px 이상 조작, 좁은 고정 폭(모바일 약 48px), 내부 세로 스크롤, 위/아래·Home/End 이동, 안정적인 ID 선택, 오류·미응답 표식을 제공한다. 모바일에서도 가로 탭으로 바꾸지 않는다.
- **평가 편집·응시:** 편집에서는 기본정보/학습자료/학습 항목/지식 평가/상황 대응 평가를 왼쪽 세로 탐색으로 구성하고 내부 문항 번호 탐색과 구분한다. 상황 설명과 대응 질문을 구분한다. 두 유형 모두 선택지 정답 라디오·번호·여러 줄 내용·삭제를 제공한다. 학습자는 응답 수·이전/다음·제출 전 답안 확인을 사용하며 판정자 승인 UI는 없다.
- **구현:** `design-tokens.css`의 단일 팔레트, `style.css` 공통/업무 레이아웃, `course-editor.css` 문항 편집, `catalog.css` 일괄 관리, `qualification-detail.css` 자격 요약/인증Set/자료 구조를 사용한다. 이전 테마 CSS/스크립트는 유지하지 않는다. Tabulator는 앱/표 범위 선택자로 스타일링하여 지연 로딩에도 같은 팔레트를 적용한다.


### 조직 정책·프로세스 검증 안내 (2026-10-21)

- 조직 깊이는 업무상 제한하지 않는다. 트리 들여쓰기는 시각적으로 최대 5단계 폭까지만 늘린다. 조직별 자격 설정에서는 조직명만 표시하며 깊이는 들여쓰기·펼침 화살표, 전체 경로는 툴팁과 상세에서 확인한다. 사용자 소속 선택기는 필요한 레벨만 추가한다.
- 필수 자격은 상태 문구·이유·다음 행동을 같은 행에 표시하고 모바일에서는 세로로 배치한다. 미설정과 명시적인 빈 목록을 구분한다.
- 학습 안내와 평가 선택은 별도 단계로 표현한다. 직접 작성 자료는 인라인으로 읽고 외부 자료는 유형·이름·설명과 함께 연다.
- 모든 페이지 본문 마지막에 비고정 `MVP 프로세스 검토`를 둔다. 기본 접힘이며 중립 바탕·점선 경계·32px 외부 간격으로 업무 패널과 분리한다. 요약에는 현재 단계와 펼치기 행동을 표시한다. 새 페이지·주요 작업 단계·계정·관리 조직 변경 시 다시 접고 같은 화면의 입력 중에는 유지한다.
- 전체 흐름의 현재 단계를 문자·테두리·굵기로 강조한다. 업무 행동/이후 흐름과 정적 AI 검수 설명은 데스크톱 두 열, 768px 이하 한 열이다. 펼친 안내는 일반 문서 흐름을 따르며 저장 영역과 입력을 가리지 않는다.
- 가상 표는 자체 초점·스크롤을 사용한다. 전역 입력 가림 방지가 표 편집 중 페이지를 움직여 다른 행에 클릭이 전달되지 않도록 한다.

### 관리자 범위·공지·본문과 공통 탐색 (2026-10-21)

- 인증 업무 관리의 공통 사이드바를 기준 일괄 관리에서도 유지한다. 오른쪽 화면만 전환하며 관리 조직·제목을 중복 표시하지 않는다. 1024px 이하에서는 같은 메뉴를 접어 두고 현재 메뉴·열기 버튼을 제공한다. 가로 스크롤은 표 내부에서만 사용한다.
- 조직별 자격 설정은 왼쪽 240~300px 조직 선택, 오른쪽 선택 조직 정보·관리자 지정·필수 자격의 두 열이며 간격은 24px다. 트리에는 조직명만 15px로 표시하고 Lv·직속 인원·필수 개수·설정 상태는 표시하지 않는다. 기본 행은 38px 이상이며 긴 이름은 줄바꿈한다. 허용된 조직만 반환·선택하고 전체 경로와 인원은 오른쪽 상세에서 확인한다.
- 1024px 미만에서는 조직 선택을 위쪽 접이식 영역으로 두고 기본 접힘 요약에 선택 조직명을 표시한다. 펼친 상태에서 조직을 선택하면 다시 접고 요약 버튼에 초점을 둔다. 모바일 트리 행과 선택 해제 버튼은 44px 이상이다.
- 관리자 지정은 직접 소속 구성원 검색 → 한 행 한 사람 체크박스 → 별도 `선택한 관리자 N명` 영역 → 명시적 저장 순서다. 검색으로 숨겨진 사람도 선택 영역에 유지하며 해제 버튼은 체크 상태와 동기화한다. 임시 선택과 저장된 지정을 구분한다.
- 팀 후보 편집은 오른쪽 하단의 별도 펼침 영역으로 두고 `팀 전체 공통 설정`을 표시한다. 불필요한 상단 절차 안내 영역은 제거하고 상세 입력 및 기존 저장 확인 동선에 집중한다.
- 설명 본문은 400 굵기·줄 높이 1.6, 제목과 설명 8~12px, 문단 12px, 의미 구획 24px를 사용한다. h4 이하에도 브라우저 기본 여백을 남기지 않는다. 사용자 입력 줄바꿈은 보존하고 긴 URL·경로는 영역 안에서 줄바꿈한다. 표와 입력 폼의 기존 밀도는 유지한다.
- 자격 설명·개인 목표·일정을 구분하고 날짜는 라벨/값 그리드로 정렬한다. 모바일에서는 한 열로 전환한다.
- 홈 공지는 시스템 공지와 내 팀 공지를 각각 별도 영역·게시 대상·빈 상태로 제공한다. 공지 상세에도 대상을 표시한다. 운영자의 업무 관리 조직과 실제 소속 팀을 혼동하지 않는다.

### 자격 상세·학습자료 (2026-10-21)

- 화면명·H1·브레드크럼·브라우저 제목·프로세스 안내는 `자격 상세`다. 자격명은 상단 요약의 대표 제목이며 최대 작업 폭은 1280px다. 자격 설명·취득 조건·자격 전체의 수료/평가 집계·목표 인증일·기간을 상단에 한 번만 표시한다. 설명은 3줄 미리보기와 전체 펼치기를 제공한다.
- 아래는 280px 인증Set 탐색과 24px 간격의 선택 인증Set 상세다. 전체 자격 진행과 선택 인증Set의 목표/일정/평가 상태를 분리한다. 1024px 미만은 인증Set 선택을 접이식으로 제공하고 현재 인증Set·상태를 유지한다. 많은 인증Set은 탐색 영역 내부에서만 스크롤하며 긴 인증Set명은 줄바꿈한다.
- 학습자료는 유형·제목·설명 요약의 독립적인 접이식 영역이다. 첫 직접 작성 자료만 기본 펼침, 여러 자료 동시 펼침·모두 펼치기/접기를 허용한다. 인증Set 이동 시 현재 화면에서 자료별 펼침 상태를 유지한다. 본문은 최대 72ch·1.6 줄 높이·원래 줄바꿈이며 외부 링크는 설명과 새 창 표기를 제공한다.
- 자료 아래에 실제 평가 현황과 `평가하기`를 두고 별도 완료 입력을 요구하지 않는다. 응시 이력·수료증·인증서와 현재 유효 상태는 실제 저장된 기록으로 표시한다. 자료 펼침·열람은 진행률과 수료 근거에 포함하지 않는다.

### 상태·재인증 표시 (2026-10-22)

- 자격의 하위 구성요소는 인증Set으로 표시한다. 기준 완성도, 기준 운영 상태, 개인 자격 효력, 인원 대상자 Hold를 다른 라벨과 영역에 둔다. 색만으로 상태를 구별하지 않는다.
- 대상자 관리는 검색/필터 → 체크박스 목록 → 별도 선택 인원 → 사유·영향 확인 → 저장 순서다. 목록 가로 스크롤은 패널 내부에 한정한다.
- 인증서에는 최초 취득 근거를 유지하고 현재 효력/만료/재인증 시작일을 라벨·값으로 정렬한다. 상태 사건과 유효기간 이력은 별도 접이식 목록으로 제공한다. 긴 사유는 줄바꿈하고 모바일에서는 날짜 그리드를 한 열로 바꾼다.
- 재인증 확인에는 이전/새 만료일과 적용 버전을 함께 표시하고 MVP 완료 버튼 처리임을 명시한다. 실제 평가 점수나 인증Set 수료를 갱신 근거처럼 표시하지 않는다.

### 평가 검토·결과 화면 (2026-10-22)

- 응시의 제출은 검토 진입이고 검토의 최종 제출만 채점한다. 마지막 문항 안내/미응답 팝업은 공통 대화상자와 키보드 초점을 사용한다. 잠긴 실기는 이유와 지식 평가 이동을 표시한다.
- 답안 검토는 요약/문항 카드/최종 제출의 세 구획이며24px 간격, 카드16~24px, 영역 제목22px/질문16px·500/본문16px/보조14px·1.6 줄높이다. 20문항 페이지를 사용하고 페이지 열람 여부는 제출 조건이 아니다. 최종 제출 후 수정 불가 문구는 버튼 바로 위에 둔다.
- 결과 영역에만 통과 배경 #EDF8F0·제목 #19492A, 미통과 배경 #FFF1ED·제목 #813122를 허용한다. 로컬 Topography SVG는 불투명도0.055, 본문·점수는 밝은 전경 영역에 둔다. 색뿐 아니라 문구/아이콘으로 구분하고 주요 버튼은 기존 파랑이다. 배경은 Hero Patterns/Steve Schoger CC BY4.0이며 결과 하단에 출처·라이선스·색/불투명도 변경을 표시한다.
- 모바일은 한 열·44px 조작, 제출 영역의 초점 가림과 페이지 가로 넘침을 검사한다. 효력(유효/Hold/Revoke)과 재인증 예정/가능·만료일은 별도로 표시한다.


### 테스트 관리·설정 이전 (2026-10-22)

- 기존 진행 초기화, 설정·기준 보존 전체 초기화, 설정·기준 이전은 별도 패널·제목으로 구분한다. 강한 초기화에는 전체 조직 범위를 명시한다.
- 보존/삭제 건수는 데스크톱 두 열, 모바일 한 열이며 글자 14px·라벨/값 정렬과 행 구분선을 사용한다. 현재 서버/파일 비교는 의미가 같은 열의 표로 표시한다.
- 단계는 미리보기·파일 검사 → 확인 문구 → 명시적 실행이다. 완료 결과와 백업 정보는 접속 계정 선택 화면에서도 확인할 수 있다. 복구·진행을 장식 차트로 표현하지 않는다.
- 모바일 조작은 44px 이상, 파일명·백업 경로는 영역 안에서 줄바꿈하며 표의 가로 스크롤을 페이지로 확장하지 않는다.

## 기준 직접 저장·세로 편집 탐색 (2026-10-22)

- 초안/사용 중 배지·게시 잠금·사용 등록 행동을 제거한다. 자격 목록은 자격명(보완 표시)/버전/Active·Hold·Revoke/작업만 표시한다. 삭제된 항목은 별도 필터와 읽기 전용 상세로 제공한다.
- 개별 저장은 변경 전후와 현재 버전 수정/자동 새 버전 여부를 확인한다. 팀 적용은 별도 행동임을 명확하게 표시한다. 부족한 내용은 미완성으로 저장하고 신규 운영 제한을 안내한다.
- 인증Set 편집은 하나의 외곽선 안에 상위 탐색 172px와 콘텐츠를 연결한다. 상위 탭은 이름을, 하위 학습·문항 탭은 숫자를 표시한다. 방향과 숫자 표시 옵션을 분리한다. 선택 강조는 왼쪽 선과 선택 상태, 문항 오류는 표시·접근 가능한 설명으로 전달한다.
- 768px 미만의 상위 탐색은 현재 영역명이 있는 접이식 세로 목록이며 하위 번호는 계속 세로다. 위/아래·Home/End와 tab/tabpanel 연결을 제공하고 두 계층의 키 이벤트를 분리한다. 탭 전환은 입력 데이터를 초기화하지 않는다.
- 영역 제목22px/700, 항목 제목20px/600, 상위 탭15px/500, 라벨14px/500·도움말14px/400, 입력16px/400·줄 높이1.5~1.6. 큰 구획24px, 필드16px, 라벨8px. 배점/합격기준은 좁은 숫자 입력, 본문/선택지는 왼쪽 정렬한다.
- 자료와 학습 범위 설명은 별도 완료 기록을 요구하지 않는다. 오류 이동은 영역·문항을 먼저 열고 해당 입력에 초점을 맞춘다. 저장은 전체 인증Set 단위다.
- 참고: [Carbon 세로 Tabs](https://www.carbondesignsystem.com/building-blocks/core/components/tabs/guidelines), [W3C Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). 업무 화면 배치에 맞게 적용한다.

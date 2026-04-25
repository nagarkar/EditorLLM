---
paths:
  - "**/*.html"
  - "**/*.css"
---

# GAS Sidebar / Dialog UI & CSS Rules

These rules apply to every HTML sidebar and dialog in Google Apps Script projects.
They were derived from real dark-mode theming failures in this workspace.

---

## 1. Never Use Emoji in Icon Controls

Emoji (🔄, 📋, 🗑️, etc.) live in Unicode ranges that render as colored image
glyphs and **ignore CSS `color`**. They cannot be themed. Do not use them in
buttons, icon-only controls, or any interactive element where color matters.

**Root cause of dark-mode visibility failures**: emoji appeared white-on-white
because CSS `color` had no effect.

---

## 2. Safe Unicode Blocks for GAS Icon Symbols

Use only characters from these blocks — they have broad Google Sans / Arial /
system-font coverage and inherit CSS `color`:

| Block | Range | Examples |
|-------|-------|---------|
| Arrows | U+2190–U+21FF | ↺ ← ↓ ↑ |
| Mathematical Operators | U+2200–U+22FF | ⊘ ⊕ ⊡ ⊞ |
| Geometric Shapes | U+25A0–U+25FF | ▶ ▸ ■ □ |

**Blocks to avoid:**
- Miscellaneous Technical (U+2300–U+23FF) — includes ⎘ and many rendering-inconsistent glyphs
- Dingbats (U+2700–U+27BF)
- Any block described as "emoji" in Unicode documentation

---

## 3. Avoid "SMALL" Named Unicode Variants

Before using any geometric or arrow character, look up its Unicode name.
Characters with "SMALL" in their name (e.g. U+25B8 "BLACK RIGHT-POINTING
**SMALL** TRIANGLE") render visually undersized relative to other symbols at
the same `font-size`.

Always prefer the full-size sibling:
- U+25B8 ▸ (SMALL) → U+25B6 ▶ (full-size)

---

## 4. Icon Button Sizing Ratio

For icon-only buttons, `font-size` must be **~57%** of the button's width/height
dimension. Always pair with `line-height: 1`.

```css
.icon-btn {
  width: 28px;
  height: 28px;
  font-size: 16px;   /* ≈ 57% of 28px */
  line-height: 1;    /* required — prevents vertical drift */
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Without `line-height: 1`, vertical centering drifts unpredictably across browsers.

---

## 5. One Symbol = One Meaning, Project-Wide

The same glyph must not carry different semantic meanings across different
sidebars (e.g. using 📋 for navigation in Sidebar but for "copy" in LogSidebar).

Maintain an **icon→meaning map** comment at the top of each HTML file or in a
shared CSS comment block, and enforce consistency during every edit.

```html
<!-- Icon map: ↺ = refresh | ▶ = run | ⊘ = clear | ■ = stop -->
```

---

## 6. GAS Font Size Standards

| Context | Size |
|---------|------|
| Body text | 13px |
| Secondary / helper text | 12px |
| Decorative uppercase labels (`.section-label`) | 11px |
| Minimum for any rendered text | 11px |

Never use a font size below 11px for any text that a user might read.

---

## 7. Scan Inline Styles on Every Theme Pass

GAS HTML files accumulate hardcoded color values in `style=""` attributes that
the CSS file does not control. A theme change is **incomplete** until:

```bash
grep -n 'style=".*color\|style=".*background\|style=".*border' *.html
```

returns clean (or all results are confirmed intentional overrides).

Specifically audit:
- `border-color` and `border` on inline elements
- `accent-color` on checkboxes / radio buttons
- `background` and `background-color` on badges and status spans
- JS-set inline styles (see rule 8 below)

---

## 8. Dynamic JS Inline Colors Need Dark-Theme Variants

Any JavaScript that writes `element.style.color` or `element.style.background`
inline (score badges, status spans, sweep overlay messages, etc.) **cannot**
reference CSS variables — inline styles override them.

For every JS-set color value, provide an explicit dark-palette variant:

```javascript
// BAD — hardcoded light-palette color, invisible on dark background
el.style.color = '#2d6a4f';

// GOOD — check user-preference / data-theme and branch
const dark = document.documentElement.dataset.theme === 'dark';
el.style.color = dark ? '#81c995' : '#2d6a4f';
```

Track all JS-set colors in the same icon/color map comment (rule 5) so they
are not forgotten during future theme passes.

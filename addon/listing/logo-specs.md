# Logo Specs — EditorLLM Marketplace Listing

## Required files

| File | Dimensions | Format |
|------|-----------|--------|
| `addon/listing/logo128.png` | 128 × 128 px | PNG, transparent background |
| `addon/listing/logo512.png` | 512 × 512 px | PNG, transparent background |

Both files must be present before submitting to the Marketplace. The 128 px
version is shown on the Marketplace card and next to the add-on name in the
Extensions menu; the 512 px version is used on the listing detail page.

---

## Design constraints

- **No text.** The 128 px size makes text illegible; use a symbol or monogram only.
- **Transparent background.** Google places the icon on white cards and dark
  sidebars — a white or coloured fill will look broken in one context.
- **Works on both light and dark backgrounds.** Use solid shapes or a
  dual-tone design with sufficient contrast on both. Avoid very light greys.
- **Legible at 128 px.** Test the design at actual size before finalising —
  details that look good at 512 px often disappear at 128 px.
- **Square safe area.** Keep the main symbol within the centre 80% of the
  canvas (i.e. leave ~10% padding on each side) so the icon is not clipped
  when Google applies rounded corners.

---

## Resizing from an SVG source

If you have a source SVG (`logo.svg`), use ImageMagick to produce both sizes:

```bash
# 128 × 128
magick logo.svg -resize 128x128 -background none addon/listing/logo128.png

# 512 × 512
magick logo.svg -resize 512x512 -background none addon/listing/logo512.png
```

If `magick` is not available, install ImageMagick:
```bash
brew install imagemagick   # macOS
```

Or use Inkscape (if installed):
```bash
inkscape logo.svg --export-png=addon/listing/logo128.png -w 128 -h 128
inkscape logo.svg --export-png=addon/listing/logo512.png -w 512 -h 512
```

---

## Checklist before submitting

- [ ] `addon/listing/logo128.png` exists, is exactly 128 × 128 px, transparent background
- [ ] `addon/listing/logo512.png` exists, is exactly 512 × 512 px, transparent background
- [ ] Icon is legible at 128 px (view at actual size in Finder / Preview)
- [ ] Icon looks correct on both white and dark grey backgrounds
- [ ] No text in the image

# Screenshot Guide — EditorLLM Marketplace Listing

## Technical requirements

- **Dimensions:** 1280 × 800 px (standard) or 2560 × 1600 px (HiDPI / Retina)
- **Format:** PNG
- **Minimum:** 1 screenshot required; Google recommends at least 3
- **File names:** `screenshot01.png`, `screenshot02.png`, … (sequential)
- **Destination:** `addon/listing/`

---

## Before capturing — hide personal data

1. Use a throwaway Google account or a document with no real personal content.
2. Clear any visible API keys from the Settings panel before opening it.
3. In Chrome: **View → Hide Toolbar** / zoom to 100% so the browser chrome does
   not appear in the capture.
4. Set browser window to exactly 1280 × 800 before capturing (use a window-
   resize extension or DevTools device mode).
5. Redact any document text that contains real names, addresses, or other PII
   before opening the add-on — the screenshot shows whatever is on screen.

---

## Recommended screens to capture

### screenshot01.png — Sidebar open with agent result visible
**What to show:** A Google Docs document with the EditorLLM sidebar open on
the right. An EarTune or Audit run has completed; the sidebar shows the job log
with a "finished" status and the document has one or two yellow-highlighted
annotation comments visible in the margin.

**Why it works:** Immediately communicates the core value — AI annotations
inside a real document — without requiring the viewer to read a description.

---

### screenshot02.png — Extensions menu open
**What to show:** The Google Docs menu bar with **Extensions → EditorLLM**
expanded, showing all six agent sub-menus (Architect, EarTune, Auditor, Tether,
TTS, General Purpose) and the utility items below the separator.

**Why it works:** Confirms the add-on is installed and shows the full feature
surface at a glance.

---

### screenshot03.png — Before / after annotation on a prose passage
**What to show:** A split or side-by-side view (or a single view with the
Drive comment panel open) showing a passage of text with an EarTune or Audit
comment attached. The comment should contain a specific, readable suggestion
(e.g. "This sentence is 47 words — consider splitting after 'however'").

**Why it works:** Makes the value proposition concrete and shows the quality of
the output.

---

### screenshot04.png — Settings panel (API key and model config)
**What to show:** The Settings dialog open, with the Gemini API key field
showing `••••••••` (masked), the model dropdowns visible, and the Save button
in view. The ElevenLabs key field may be empty.

**Why it works:** Addresses the first question new users have ("how do I set it
up?") and shows the BYOK (bring your own key) model clearly.

---

### screenshot05.png — TTS directive panel or audio playback
**What to show:** Either (a) the TTS dialog with a waveform / playback controls
visible and a Drive download link, or (b) the sidebar's Directives tab showing
two or three TTS markers on a document tab with voice and model labels.

**Why it works:** Differentiates EditorLLM from text-only AI tools and
showcases the audio workflow for authors who need to hear their prose.

---

## Capture checklist

- [ ] Window is exactly 1280 × 800 px
- [ ] No personal data visible in document text
- [ ] No real API keys visible
- [ ] Zoom level is 100%
- [ ] Browser toolbar is hidden or cropped out
- [ ] Files saved as PNG to `addon/listing/screenshot0N.png`
- [ ] At least 3 screenshots present before submitting to Marketplace

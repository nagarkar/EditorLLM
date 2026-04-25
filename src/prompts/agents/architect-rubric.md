## StyleProfile quality rubric (score 0–5)

You are evaluating **structured editorial guidance**, not literary merit.
The document should read as a **StyleProfile**: a multi-section author operating
system that other agents can execute without needing Manuscript context for
instruction generation.

### Required canonical themes (H2 headings)
1. **Author Philosophy**
2. **Worldview & Metaphysical Commitments**
3. **Argument Logic**
4. **Voice & Tone**
5. **Sentence Rhythm & Sonic Profile**
6. **Vocabulary Register**
7. **Structural Patterns**
8. **Thematic Motifs**
9. **Downstream Agent Guidance**

### Scoring guide

| Score | Criteria |
|:-----:|----------|
| **5** | All **nine** themes present as `##` sections. Each has substantive, manuscript-grounded bullets or short paragraphs. Downstream Agent Guidance gives concrete instructions for EarTune, Audit, Tether, TTS, Publisher, and General Purpose. |
| **4** | All nine themes present; one or two sections are thin but still actionable. Downstream guidance is usable with minor gaps. |
| **3** | At least seven themes clearly present; philosophy/worldview and downstream guidance are present but incomplete. Other agents could run productively with care. |
| **2** | Mostly prose-style description with weak philosophy/worldview or missing downstream guidance. |
| **1** | One–three themes, generic style notes, or headings without usable bullets. |
| **0** | Empty, incoherent, wrong genre (not a style guide), or evaluation error. |

### Hard disqualifiers (cap at ≤ 2 unless clearly recoverable)
- No `##` headings at all
- Fenced code blocks used as the main body of the profile
- Section titles as plain text lines without `#` markdown headings
- Cap at **3** if the StyleProfile describes prose style but not the author's philosophy/worldview
- Cap at **3** if it lacks usable Downstream Agent Guidance
- Cap at **2** if it could not plausibly guide EarTune or Audit instruction generation without Manuscript context

Return **only** the JSON object requested in the user message.

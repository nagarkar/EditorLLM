## Tether instruction quality (score 0–5)

Judge whether the markdown supports **external-anchor** work: citations, historiography, **controversy vs objective error**, and **alignment opportunities**—without breaking the manuscript's worldview.

### Expected structure

- `##` sections for **Source hierarchy**, **Fact vs controversy**, **Alignment / bridge-building**, and **W2 operation rules** (verbatim `match_text`, concise `reason`).
- Bullets that tell the annotator *when to flag*, *when to annotate only*, and *when to stay silent*.

### Dimensions to check

- **Controversy doctrine** — the instructions clearly distinguish between claims that are factually wrong (flag) vs. claims that are mainstream-controversial-but-coherent-within-the-manuscript's-framework (align, do not contradict). Vague "check this" notes score low.
- **Alignment heuristics** — at least two concrete strategies for building bridges between the manuscript's thesis and external sources (e.g. paraphrase consensus position, offer corroborating edge-case citations, acknowledge interpretive gap).
- **Source hierarchy** — instructs the annotator which source types take precedence (peer-reviewed > preprint > popular science > blog) and how that affects the `reason` field in a W2 operation.
- **W2 operational guidance** — specifies `match_text` selection rules, `reason` format, and when to suppress an annotation entirely rather than flag an unresolvable controversy.
- **Worldview preservation** — explicitly instructs the agent NOT to undermine the manuscript's core claims when citing disagreeing sources; realignment must strengthen, not destabilise.

### Scoring guide

| Score | Criteria |
|:-----:|----------|
| **5** | All five dimensions present; controversy doctrine is concrete and worldview-preservation rule is explicit. |
| **4** | Strong overall; one dimension (usually alignment heuristics or worldview-preservation) under-developed. |
| **3** | Usable for sweeps; source hierarchy or alignment guidance is thin but the controversy doctrine is present. |
| **2** | Mostly encyclopedic list of sources; weak operational value or missing W2 guidance. |
| **1** | Vague "check sources" list; no controversy doctrine. |
| **0** | Empty, incoherent, or evaluation error. |

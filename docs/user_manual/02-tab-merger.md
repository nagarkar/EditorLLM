# Tab Merger

## What It Does

The Tab Merger combines content from multiple document tabs into a single **Manuscript** tab. This is the foundation for all agent work — agents read Manuscript as the canonical source of the manuscript.

## When to Use

- After writing or editing chapter tabs, merge them so agents see the latest text.
- Before generating a StyleProfile (the Architect reads Manuscript).
- Before running a technical audit across the full manuscript.

## How to Use

### From the Sidebar

1. Open the sidebar (**EditorLLM** > **Open Sidebar**).
2. Scroll to the **Create Manuscript** section.
3. In the text area, enter the tab names you want to merge, separated by commas:
   ```
   Chapter 1, Chapter 2, Chapter 3, Appendix A
   ```
4. Click **Save** to remember this list for next time.
5. Click **Create Manuscript**.

The merger:
1. Clears the Manuscript tab completely.
2. Copies the content of each listed tab into Manuscript, in the order you specified.
3. Inserts a page break between each tab's content.
4. Shows a progress indicator (e.g., "Merging 2 / 5: Chapter 2").

### Loading Saved Tab Names

Click **Load Saved** to restore the last-saved comma-separated list. This is useful when you merge the same set of tabs regularly.

## Important Notes

- **Tab names are case-sensitive.** "Chapter 1" and "chapter 1" are different.
- **Ordering matters.** Tabs are merged in the exact order you list them.
- **Manuscript is overwritten** every time you merge. The previous content is lost.
- If a listed tab doesn't exist, that tab is skipped and reported as an error in the status. Other tabs still merge successfully.
- The merge preserves formatting: paragraphs, tables, and list items are copied with their original styling.

## Typical Workflow

1. Write/edit your chapter tabs.
2. Open the sidebar, enter tab names, click **Create Manuscript**.
3. Run the Structural Architect to regenerate the StyleProfile from the fresh Manuscript.
4. Run Ear-Tune or Technical Audit on specific tabs.

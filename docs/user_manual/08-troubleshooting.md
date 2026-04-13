# Troubleshooting

## Common Errors

### "Gemini API key not set"

**Cause:** No API key is configured in either script properties or user properties.

**Fix:** Open the sidebar > Setup > **Set API Key**. Paste your Gemini API key.

### "Model X is not available or has been deprecated"

**Cause:** The configured Gemini model name is no longer valid.

**Fix:**
1. Open the sidebar > Model Configuration.
2. Click **Refresh List** to fetch current models.
3. Select a valid model for the tier that errored.
4. Click **Save**.

The error message includes a list of available models to help you choose.

### "MergedContent tab is empty"

**Cause:** The Structural Architect was run before merging any tabs.

**Fix:** Use the Tab Merger to merge your chapter tabs into MergedContent first, then rerun the Architect.

### "Tab X not found"

**Cause:** A tab referenced by an agent doesn't exist in the document.

**Fix:** Click **Initialize Tabs** in the Setup section to create missing standard tabs.

### "Click ↻ to detect the active tab first"

**Cause:** You clicked Ear-Tune or Audit without first refreshing the active tab.

**Fix:** Click the **↻** button next to the active tab label, wait for it to show the correct tab name, then click the action button.

### Ear-Tune or Audit shows no changes

**Cause:** The agent's match_text didn't find the target passage. This happens when Gemini returns a slightly different string than what's actually in the document.

**Fix:** This is a known limitation of text-matching. Check the Apps Script logs (View > Logs in the script editor) for "match_text not found" warnings. The agent falls back to highlighting the first word in the tab body.

### Log Sidebar shows no output

**Cause:** The log ring buffer in CacheService is empty or has expired (entries are evicted after 6 hours).

**Possible fixes:**
- Trigger an operation (Ear-Tune, Audit) and then open the log sidebar — it only shows entries from the current session.
- If entries immediately disappear, confirm the sidebar is open *before* starting the operation so it captures entries from the beginning.
- Check Apps Script Executions (https://script.google.com) for server-side errors that may be preventing log writes.

### "Could not fetch comments"

**Cause:** The Drive API failed to list comments, typically due to a permissions issue.

**Fix:** Re-authorize the add-on by refreshing the document and accepting the permissions prompt when the EditorLLM menu loads.

### Processing comments replies to 0 threads

**Possible causes:**
- No comments have an `@tag` as the last message.
- All tagged threads have already been answered (the last message is an AI reply).
- The tag used isn't recognised (e.g., `@helper` is not a registered agent tag).

**Fix:** Check your comment threads. The last message must start with a registered tag (`@AI`, `@architect`, `@eartune`, `@ear-tune`, `@audit`, `@auditor`).

## Checking Logs

For detailed debugging, open the Apps Script editor:

1. Go to https://script.google.com
2. Open the EditorLLM project.
3. Click **Executions** in the left sidebar.
4. Find the most recent execution and click it to see logs.

Key log prefixes:
- `[CommentProcessor]` — comment routing, thread parsing, dispatch
- `[ArchitectAgent]`, `[EarTuneAgent]`, `[AuditAgent]`, `[CommentAgent]` — per-agent Gemini calls and context
- `[DocOps]` — tab creation and registry operations

## Performance

- **First run is slow.** The standard tab creation step (Initialize Tabs) calls the Docs REST API, which takes 2-5 seconds per tab.
- **Gemini thinking tier** takes longer than fast. Architect and Auditor operations may take 15-30 seconds.
- **Large documents** are truncated. Agents read a limited number of characters from each tab (typically 6,000-12,000) to stay within API limits.
- **Many comments** are now paginated. Documents with 20+ comments fetch all pages automatically.

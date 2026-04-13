# Setup & Configuration

## Opening EditorLLM

1. Open your Google Doc.
2. In the menu bar, click **EditorLLM** > **Open Sidebar**.
3. The sidebar appears on the right side of the document.

If you don't see the EditorLLM menu, the add-on may not be installed on this document. Ask the document owner to verify the script is bound and authorized.

### Live Log Sidebar

For long-running operations (Ear-Tune, Audit), a real-time progress log is available:

1. Click **EditorLLM** > **Open Log Sidebar**.
2. The log sidebar opens on the right. It polls every two seconds and streams log entries as the agent runs.
3. Each entry shows a timestamp, log level, and message — e.g., `[INFO] EarTuneAgent: processing paragraph 3/12`.

The log sidebar is non-blocking: you can continue reading or editing while an agent runs. Close it at any time; it does not interrupt the running operation.

## First-Time Setup

### Initialize Tabs

Click **Initialize Tabs** in the Setup section of the sidebar. This creates the standard tab structure your document needs:

| Tab | Location | Purpose |
|---|---|---|
| MergedContent | Root | Holds the combined manuscript text |
| Agentic Instructions | Root | Parent tab for all agent configuration |
| StyleProfile | Under Agentic Instructions | The generated style guide |
| EarTune | Under Agentic Instructions | Ear-Tune system prompt |
| TechnicalAudit | Under Agentic Instructions | Audit rules |
| Comment Instructions | Under Agentic Instructions | Instructions for the @AI comment responder |

You only need to do this once per document. Re-running it is safe — existing tabs are not overwritten.

### Set Your Gemini API Key

1. Click **Set API Key** in the Setup section.
2. A browser prompt asks for your Gemini API key.
3. Paste the key and click OK.

The key is stored in your personal user properties. If an administrator has set a shared key via script properties, that key takes precedence and you can skip this step.

To get a Gemini API key, visit [Google AI Studio](https://aistudio.google.com/apikey).

## Model Configuration

EditorLLM uses three model tiers. Each can be configured independently.

| Tier | Used by | Recommended for |
|---|---|---|
| **Fast** | Comment Agent, Audio EarTune | Low-latency tasks: comments, prose styling |
| **Thinking** | Structural Architect, Logical Auditor | Deep reasoning: style analysis, technical audits |
| **DeepSeek** | (Available for future agents) | Experimental model slot |

### Configuring Models

1. In the **Model Configuration** section of the sidebar, click **Refresh List** to fetch all available Gemini models from the API.
2. Type in each field — the dropdown autocompletes from the fetched list.
3. Click **Save** to persist your selection.

Click **Load Saved** at any time to see the currently configured models.

Default models are used when no configuration has been saved:
- Fast: `gemini-2.0-flash`
- Thinking: `gemini-2.5-pro-preview-03-25`
- DeepSeek: `gemini-2.0-flash-thinking-exp-01-21`

> **Tip:** If you see a "model not found" error when running an agent, the configured model may have been deprecated. Open the sidebar, click Refresh List, select an available model, and Save.

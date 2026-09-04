// ── server-types.d.ts ──────────────────────────────────────────────────────
// Pure data-shape interfaces that cross the google.script.run boundary as JSON.
// Included in BOTH tsconfig.json (server) and tsconfig.client.json (client)
// so both sides describe the same contract without duplicating source.
//
// Rules for what belongs here:
//   ✓ Plain interfaces with only primitive / array / nested-interface members
//   ✓ Types that appear as return values of google.script.run calls
//   ✗ GAS API types (GoogleAppsScript.*) — server-only
//   ✗ Types used only internally on the server and never returned as JSON
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A TTS or break directive attached to a named range in the document.
 * Returned by getTabDirectives() and consumed by the client directive table.
 */
interface TtsDirective {
  name:       string;
  bookmarkId: string;
  type:       'tts' | 'break';
  /** First few words of the anchored text — present on tts directives. */
  matchText?:        string;
  voice_id?:         string;
  tts_model?:        string;
  stability?:        number;
  similarity_boost?: number;
  /** Break-specific payload. */
  payload?: { timeMs?: number };
}

/**
 * Audio quality specification — drives both the ElevenLabs outputFormat
 * parameter and the client-side ffmpeg silence / concatenation settings.
 */
interface AudioQualitySpec {
  outputFormat: 'mp3_22050_32' | 'mp3_44100_64' | 'mp3_44100_128' | 'mp3_44100_192';
  sampleRate:   number;
  bitRate:      number;
  channels:     number;
}

/**
 * One element of the array returned by elevenLabsTextToSpeechFromDirectives.
 * The client assembles these into a single audio file via ffmpeg.
 *   - 'audio' — ElevenLabs-generated MP3 bytes as base64
 *   - 'break' — silent gap; client generates the silence
 */
type AudioSegmentItem =
  | { type: 'audio'; audioBase64: string }
  | { type: 'break'; durationMs: number };

/**
 * A single voice entry returned by ElevenLabsService.listVoices().
 */
interface ElevenLabsVoice {
  voice_id: string;
  name:     string;
  category: string;
  use_case: string;
  labels:   Record<string, string>;
}

/**
 * A single TTS-capable model returned by ElevenLabsService.listModels().
 */
interface ElevenLabsModel {
  model_id:    string;
  name:        string;
  description: string;
}

/**
 * A single rule in a pronunciation dictionary.
 */
interface ElevenLabsPronunciationRule {
  string_to_replace: string;
  replace_with:      string;
  /** "ipa" for phoneme rules; "" for alias rules. */
  alphabet: string;
}

/**
 * A pronunciation dictionary cached by ElevenLabsService.
 */
interface ElevenLabsPronunciationDictionary {
  id:         string;
  version_id: string;
  name:       string;
  rules:      ElevenLabsPronunciationRule[];
}

/**
 * Snapshot of the user's ElevenLabs character quota.
 * Returned by elevenLabsGetUserSubscription; used by the sidebar to render
 * "credits remaining" alongside the Last / Session stats.
 */
interface ElevenLabsSubscription {
  characterCount: number;
  characterLimit: number;
}

/**
 * Metadata persisted after each successful TTS generation.
 * Returned by elevenLabsGetLastGenerationMeta; used to reload the last audio.
 */
interface ElevenLabsLastGenMeta {
  fileId:        string;
  driveUrl:      string;
  driveFileName?: string;
  voiceName:     string;
  modelName:     string;
  charCount:     number;
  elapsedMs?:    number;
  timestamp:     number;
}

/**
 * A user-defined agent definition stored in User or Document Properties.
 * Crosses the google.script.run boundary when listing/saving agents.
 */
interface CustomAgentDefinition {
  /** Stable UUID (no dashes), e.g. "a1b2c3d4e5f6...". */
  id: string;
  /** Human-readable name shown in the UI, e.g. "My Reviewer". */
  displayName: string;
  /** Comment routing tag — must include the @ prefix, e.g. "@myreviewer". */
  tag: string;
  /** The doc tab where the user writes this agent's instructions. Optional — leave blank to rely solely on the system prompt. */
  instructionTabName?: string;
  /** Optional: a single context tab the agent reads during W2/W3 (e.g. "StyleProfile"). */
  contextTabName?: string;
  /** The LLM system prompt for this agent. */
  systemPrompt: string;
  /** Which workflows are enabled. */
  workflows: {
    /** W2 — annotate a manuscript tab with highlights and comments. */
    w2: boolean;
    /** W3 — reply to comment threads addressed with this agent's tag. */
    w3: boolean;
    /** W6 — Run with Context: process a content tab with a user-supplied refine action and write to an output tab. */
    w6: boolean;
  };
  /** Where this definition is currently stored. */
  storedIn: 'user' | 'document' | 'script';
  /** Email of the user who owns this definition (set when storedIn === 'document'). */
  ownerEmail?: string;
  /** Unix timestamp (ms) when this definition was first created. */
  createdAt: number;
}

/** Response shape from listCustomAgents(). */
interface CustomAgentsListResponse {
  agents: CustomAgentDefinition[];
  /** Email of the user making the request — used to determine edit/delete ownership. */
  currentUserEmail: string;
}

/**
 * A single entry in an agent export payload.
 * Tab content is bundled so the agent can be reconstructed in another document.
 */
interface AgentExportEntry {
  displayName:           string;
  tag:                   string;
  systemPrompt:          string;
  workflows:             { w2: boolean; w3: boolean; w6: boolean };
  instructionTabName?:   string;
  instructionTabContent?: string;
  contextTabName?:       string;
  contextTabContent?:    string;
}

/** Top-level export payload for agent definitions. */
interface AgentExportPayload {
  version:    1;
  exportedAt: string;
  agents:     AgentExportEntry[];
}

/** A named, ordered agent team for Agentic Team Analysis. */
interface AgentTeamDefinition {
  id:         string;
  name:       string;
  agentIds:   string[];
  storedIn:   'user' | 'document';
  createdAt:  number;
  ownerEmail?: string;
}

/** Export payload for agent teams. */
interface AgentTeamExportPayload {
  version:    1;
  exportedAt: string;
  teams:      AgentTeamDefinition[];
}

/** Return value from startOrContinueTeamAnalysis(). */
interface TeamAnalysisResult {
  status:         'complete' | 'continuing' | 'error';
  processedCount: number;
  totalCount:     number;
  outputTabName:  string;
  error?:         string;
}

/**
 * A section of an audio manifest — either spoken text or a silence gap.
 */
type ManifestSection =
  | {
      id: string;
      type: 'speech';
      text: string;
      voiceId: string;
      voiceName: string;
      ttsModel: string;
      stability: number;
      similarityBoost: number;
    }
  | {
      id: string;
      type: 'silence';
      durationMs: number;
    };

interface PronunciationDictionaryLocator {
  pronunciationDictionaryId: string;
  versionId: string;
}

/**
 * A serialisable audio manifest generated from TTS directives on a document tab.
 * Returned by buildManifest() and consumed by the desktop app.
 */
interface AudioManifest {
  version: 1;
  documentTitle: string;
  tabName: string;
  generatedAt: string;
  sections: ManifestSection[];
  /** Pronunciation dictionary locators to apply when generating audio for all sections. */
  pronunciationDictionaryLocators?: PronunciationDictionaryLocator[];
}

type PartialManifestKind = 'chapter' | 'openingCredits' | 'closingCredits' | 'aboutAuthor';

interface PartialManifest {
  chapter?: AudioManifest;
  openingCredits?: AudioManifest;
  closingCredits?: AudioManifest;
  aboutAuthor?: AudioManifest;
}

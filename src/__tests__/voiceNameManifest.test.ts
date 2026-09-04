/**
 * Repro test for bug: buildManifest returns empty voiceName for every speech section,
 * even when the ElevenLabs voice cache has the correct mapping.
 *
 * Root cause: buildManifest reads d.payload?.voice_name (never stored in the directive
 * payload) instead of looking up the voice name from ElevenLabsService.ensureVoiceMappings().
 *
 * This test is the ground truth for the bug hunt — do NOT modify it during iterations.
 */
import { encodeDirectiveNamedRangeName, makeDirectivePropertyKey_ } from '../agentHelpers';
import {
  clearJestDocumentPropertyCache_,
  createEditorLlmCodeVmContext,
} from './helpers/gasVmContext';

const ctx = createEditorLlmCodeVmContext();

describe('buildManifest voice name population', () => {
  const propStore = new Map<string, string>();
  let uuidCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    propStore.clear();
    clearJestDocumentPropertyCache_();
    uuidCounter = 0;

    // Build a minimal document body: one paragraph containing one text node.
    const textNode: any = {
      getType: () => 'TEXT',
      asText() { return textNode; },
      getText: () => 'Hello World',
    };
    const body: any = {};
    const paragraph: any = {
      getType: () => 'PARAGRAPH',
      getNumChildren: () => 1,
      getChild: () => textNode,
      getParent: () => body,
      getChildIndex: (child: any) => (child === textNode ? 0 : -1),
    };
    textNode.getParent = () => paragraph;
    body.getText = () => 'Hello World';
    body.getNumChildren = () => 1;
    body.getChild = () => paragraph;
    body.getChildIndex = (child: any) => (child === paragraph ? 0 : -1);

    // Named range anchored at position 0 in the text node.
    const namedRange = {
      getName: () => encodeDirectiveNamedRangeName('TtsAgent', 'abc123', 'bookmark123'),
      getRange: () => ({
        getRangeElements: () => [
          {
            getElement: () => textNode,
            getStartOffset: () => 0,
            getEndOffsetInclusive: () => 10,
          },
        ],
      }),
      remove: jest.fn(),
    };

    const bookmark = {
      getId: () => 'bookmark123',
      getPosition: () => ({
        getSurroundingText: () => textNode,
        getSurroundingTextOffset: () => 0,
      }),
      remove: jest.fn(),
    };

    const tab = {
      getBody: () => body,
      getNamedRanges: jest.fn().mockReturnValue([namedRange]),
      getBookmarks: jest.fn().mockReturnValue([bookmark]),
    };

    const activeDoc = {
      getId: () => 'docId',
      getName: () => 'Test Document',
    };

    ctx.DocumentApp = {
      ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH' },
      getActiveDocument: () => activeDoc,
    };
    ctx.DocOps = {
      getTabByName: jest.fn((name: string) => (name === 'TestTab' ? tab : null)),
    };
    ctx.Tracer = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
    ctx.PropertiesService = {
      getDocumentProperties: () => ({
        getProperty: (key: string) => propStore.get(key) ?? null,
        setProperty: (key: string, value: string) => { propStore.set(key, value); },
        deleteProperty: (key: string) => { propStore.delete(key); },
      }),
    };
    ctx.Utilities = {
      getUuid: jest.fn(() => {
        uuidCounter += 1;
        return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
      }),
    };

    // ElevenLabsService with a seeded voice map: voice123 → 'Great Voice Name'.
    ctx.ElevenLabsService = {
      ...ctx.ElevenLabsService,
      ensureVoiceMappings: jest.fn().mockReturnValue({ voice123: 'Great Voice Name' }),
      getVoiceMappings: jest.fn().mockReturnValue({ voice123: 'Great Voice Name' }),
      getSelectedDictionary: jest.fn().mockReturnValue(null),
    };

    // TTS directive payload — voice_id set, voice_name intentionally absent (as stored in practice).
    propStore.set(
      makeDirectivePropertyKey_('abc123'),
      JSON.stringify({
        v: 2,
        type: 'tts',
        payload: {
          tts_model: 'eleven_multilingual_v2',
          voice_id: 'voice123',
          stability: 0.75,
          similarity_boost: 0.8,
          // voice_name intentionally NOT stored here — this matches the real storage format
        },
      }),
    );
  });

  it('populates voiceName from the ElevenLabs voice cache', () => {
    const manifest = ctx.buildManifest('TestTab');

    expect(manifest).not.toBeNull();
    expect(manifest.sections).toHaveLength(1);

    const speech = manifest.sections[0];
    expect(speech.type).toBe('speech');
    expect(speech.voiceId).toBe('voice123');

    // This assertion fails before the fix because buildManifest reads
    // d.payload?.voice_name (always undefined) instead of the voice cache.
    expect(speech.voiceName).toBe('Great Voice Name');
  });
});

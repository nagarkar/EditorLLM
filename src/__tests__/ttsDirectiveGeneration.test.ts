import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const agentHelpersJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/agentHelpers.js'),
  'utf8',
);
const directivePersistenceJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/DirectivePersistence.js'),
  'utf8',
);
const codeJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/Code.js'),
  'utf8',
);

const ctx = Object.assign(vm.createContext({}), global) as any;
vm.runInContext(agentHelpersJs, ctx);
vm.runInContext(directivePersistenceJs, ctx);
vm.runInContext(codeJs, ctx);

function elevenLabsTextToSpeechFromDirectives(
  tabName: string,
  useStitching: boolean,
): {
  ok: boolean;
  audioBase64?: string;
  driveUrl?: string;
  driveFileId?: string;
  driveFileName?: string;
  segmentCount?: number;
  error?: string;
} {
  return ctx.elevenLabsTextToSpeechFromDirectives(tabName, useStitching);
}

describe('elevenLabsTextToSpeechFromDirectives', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    ctx.Tracer = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    ctx.DocumentApp = {
      getActiveDocument: jest.fn().mockReturnValue({
        getId: () => 'doc-123',
      }),
    };

    ctx.DocOps = {
      getTabContent: jest.fn(),
      getTabByName: jest.fn(),
    };

    ctx.Drive = {
      Files: {
        create: jest.fn().mockReturnValue({ id: 'file-123' }),
      },
      Permissions: {
        create: jest.fn(),
      },
    };

    ctx.Utilities = {
      getUuid: jest.fn().mockReturnValue('12345678-1234-1234-1234-123456789abc'),
      newBlob: jest.fn().mockReturnValue({}),
      base64Encode: jest.fn().mockReturnValue('combined-audio-b64'),
    };
  });

  it('makes the right sequence of stitched ElevenLabs calls for mixed directives', () => {
    const tabText = [
      'Intro text. ',
      'Alpha starts here and continues. ',
      'Beta changes voice. ',
      'Gamma returns to voice A. ',
      'Delta stays on voice A.',
    ].join('');

    ctx.DocOps.getTabContent.mockReturnValue(tabText);
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      {
        name: 'directive_TtsAgent_d1_b1',
        agent: 'TtsAgent',
        type: 'tts',
        matchText: 'Alpha',
        _insertPos: 12,
        voice_id: 'voice-a',
        tts_model: 'model-a1',
        stability: 0.11,
        similarity_boost: 0.21,
      },
      {
        name: 'directive_TtsAgent_d2_b2',
        agent: 'TtsAgent',
        type: 'tts',
        matchText: 'Beta',
        _insertPos: 45,
        voice_id: 'voice-b',
        tts_model: 'model-b1',
        stability: 0.31,
        similarity_boost: 0.41,
      },
      {
        name: 'directive_TtsAgent_d3_b3',
        agent: 'TtsAgent',
        type: 'tts',
        matchText: 'Gamma',
        _insertPos: 65,
        voice_id: 'voice-a',
        tts_model: 'model-a2',
        stability: 0.51,
        similarity_boost: 0.61,
      },
      {
        name: 'directive_TtsAgent_d4_b4',
        agent: 'TtsAgent',
        type: 'tts',
        matchText: 'Delta',
        _insertPos: 91,
        voice_id: 'voice-a',
        tts_model: 'model-a3',
        stability: 0.71,
        similarity_boost: 0.81,
      },
    ]);

    const ttsMock = jest.fn()
      .mockReturnValueOnce({ audioBytes: [1, 2], requestId: 'req-a1' })
      .mockReturnValueOnce({ audioBytes: [3, 4], requestId: 'req-b1' })
      .mockReturnValueOnce({ audioBytes: [5, 6], requestId: 'req-a2' })
      .mockReturnValueOnce({ audioBytes: [7, 8], requestId: 'req-a3' });

    ctx.ElevenLabsService = {
      textToSpeechWithStitching: ttsMock,
    };

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result.ok).toBe(true);
    expect(result.segmentCount).toBe(4);
    expect(result.audioBase64).toBe('combined-audio-b64');
    expect(ttsMock).toHaveBeenCalledTimes(4);

    expect(ttsMock).toHaveBeenNthCalledWith(
      1,
      'Intro text. Alpha starts here and continues.',
      'voice-a',
      'model-a1',
      [],
      { stability: 0.11, similarity_boost: 0.21 },
    );

    expect(ttsMock).toHaveBeenNthCalledWith(
      2,
      'Beta changes voice.',
      'voice-b',
      'model-b1',
      [],
      { stability: 0.31, similarity_boost: 0.41 },
    );

    expect(ttsMock).toHaveBeenNthCalledWith(
      3,
      'Gamma returns to voice A.',
      'voice-a',
      'model-a2',
      ['req-a1'],
      { stability: 0.51, similarity_boost: 0.61 },
    );

    expect(ttsMock).toHaveBeenNthCalledWith(
      4,
      'Delta stays on voice A.',
      'voice-a',
      'model-a3',
      ['req-a1', 'req-a2'],
      { stability: 0.71, similarity_boost: 0.81 },
    );
  });

  it('returns an error when no directives exist on the tab', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Hello world');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([]);

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result).toEqual({ ok: false, error: 'No directives found on this tab.' });
  });

  it('returns an error when the tab text is empty', () => {
    ctx.DocOps.getTabContent.mockReturnValue('   ');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'd1', type: 'tts', _insertPos: 0, voice_id: 'voice-a', tts_model: 'model-a' },
    ]);

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result).toEqual({ ok: false, error: 'Tab is empty.' });
  });

  it('returns an error when no TTS directives remain after filtering', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Hello world');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'break-1', type: 'break', _insertPos: 5, payload: { timeMs: 250 } },
    ]);

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result).toEqual({ ok: false, error: 'No TTS directives found on this tab.' });
  });

  it('returns an error when directives have no locatable positions', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Hello world');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'd1', type: 'tts', _insertPos: -1, voice_id: 'voice-a', tts_model: 'model-a' },
    ]);

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result).toEqual({ ok: false, error: 'No TTS directives found on this tab.' });
  });

  it('continues successfully when Drive save fails after audio generation', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Intro Alpha Beta');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'd1', type: 'tts', _insertPos: 6, voice_id: 'voice-a', tts_model: 'model-a', stability: 0.6, similarity_boost: 0.75 },
    ]);
    ctx.ElevenLabsService = {
      textToSpeechWithStitching: jest.fn().mockReturnValue({ audioBytes: [1, 2, 3], requestId: 'req-1' }),
    };
    ctx.Drive.Files.create = jest.fn().mockImplementation(() => { throw new Error('Drive down'); });

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result.ok).toBe(true);
    expect(result.audioBase64).toBe('combined-audio-b64');
    expect(result.driveUrl).toBeUndefined();
  });

  it('returns an error when ElevenLabs synthesis throws mid-generation', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Intro Alpha Beta');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'd1', type: 'tts', _insertPos: 6, voice_id: 'voice-a', tts_model: 'model-a', stability: 0.6, similarity_boost: 0.75 },
      { name: 'd2', type: 'tts', _insertPos: 12, voice_id: 'voice-b', tts_model: 'model-b', stability: 0.6, similarity_boost: 0.75 },
    ]);
    ctx.ElevenLabsService = {
      textToSpeechWithStitching: jest.fn()
        .mockReturnValueOnce({ audioBytes: [1], requestId: 'req-1' })
        .mockImplementationOnce(() => { throw new Error('quota exceeded'); }),
    };

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('quota exceeded');
  });

  it('passes no previous request ids when stitching is disabled', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Intro Alpha Beta');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'd1', type: 'tts', _insertPos: 6, voice_id: 'voice-a', tts_model: 'model-a', stability: 0.6, similarity_boost: 0.75 },
      { name: 'd2', type: 'tts', _insertPos: 12, voice_id: 'voice-a', tts_model: 'model-a', stability: 0.6, similarity_boost: 0.75 },
    ]);
    const ttsMock = jest.fn()
      .mockReturnValueOnce({ audioBytes: [1], requestId: 'req-1' })
      .mockReturnValueOnce({ audioBytes: [2], requestId: 'req-2' });
    ctx.ElevenLabsService = { textToSpeechWithStitching: ttsMock };

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', false);

    expect(result.ok).toBe(true);
    expect(ttsMock.mock.calls[0][3]).toEqual([]);
    expect(ttsMock.mock.calls[1][3]).toEqual([]);
  });

  it('injects break directives into the segment text', () => {
    ctx.DocOps.getTabContent.mockReturnValue('Intro Alpha Beta');
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'tts-1', type: 'tts', _insertPos: 6, voice_id: 'voice-a', tts_model: 'model-a', stability: 0.6, similarity_boost: 0.75 },
      { name: 'break-1', type: 'break', _insertPos: 12, payload: { timeMs: 250 } },
    ]);
    const ttsMock = jest.fn().mockReturnValue({ audioBytes: [1], requestId: 'req-1' });
    ctx.ElevenLabsService = { textToSpeechWithStitching: ttsMock };

    const result = elevenLabsTextToSpeechFromDirectives('TestTab', true);

    expect(result.ok).toBe(true);
    expect(ttsMock).toHaveBeenCalledWith(
      'Intro Alpha <break time="250ms" />Beta',
      'voice-a',
      'model-a',
      [],
      { stability: 0.6, similarity_boost: 0.75 },
    );
  });
});

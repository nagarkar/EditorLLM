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

describe('cursor-created directives and preview boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ctx.Tracer = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  it('creates a one-character directive range from the cursor position', () => {
    const bookmark = { getId: () => 'bookmark-1', remove: jest.fn() };
    const addElement = jest.fn().mockReturnThis();
    const surroundingText: any = { getText: () => 'Hello world' };
    surroundingText.asText = () => surroundingText;
    const builtRange = {
      getRangeElements: jest.fn().mockReturnValue([
        {
          getElement: () => surroundingText,
          getStartOffset: () => 2,
          getEndOffsetInclusive: () => 2,
        },
      ]),
    };
    const build = jest.fn().mockReturnValue(builtRange);
    const addNamedRange = jest.fn();
    const addBookmark = jest.fn().mockReturnValue(bookmark);
    const newPosition = jest.fn().mockReturnValue({ pos: true });
    const newRange = jest.fn().mockReturnValue({ addElement, build });

    ctx.DocumentApp = {
      getActiveDocument: () => ({
        getCursor: () => ({
          getSurroundingText: () => surroundingText,
          getSurroundingTextOffset: () => 2,
        }),
      }),
    };
    ctx.DocOps = {
      getTabByName: jest.fn().mockReturnValue({ newRange, newPosition, addBookmark, addNamedRange }),
    };
    ctx.getActiveTabName = jest.fn().mockReturnValue('TestTab');

    const result = ctx.addTtsDirectiveFromSelection('TestTab', {
      tts_model: 'model-a',
      voice_id: 'voice-a',
      stability: 0.6,
      similarity_boost: 0.75,
    });

    expect(result).toBe(true);
    expect(addElement).toHaveBeenCalledWith(surroundingText, 2, 2);
    expect(newPosition).toHaveBeenCalledWith(surroundingText, 2);
    expect(addBookmark).toHaveBeenCalled();
    expect(addNamedRange).toHaveBeenCalled();
  });

  it('rejects cursor placement at the end of the text node', () => {
    ctx.DocumentApp = {
      getActiveDocument: () => ({
        getCursor: () => ({
          getSurroundingText: () => ({ getText: () => 'abc' }),
          getSurroundingTextOffset: () => 3,
        }),
      }),
    };
    ctx.DocOps = {
      getTabByName: jest.fn().mockReturnValue({ newRange: jest.fn() }),
    };
    ctx.getActiveTabName = jest.fn().mockReturnValue('TestTab');

    expect(() => ctx.addTtsDirectiveFromSelection('TestTab', {
      tts_model: 'model-a',
      voice_id: 'voice-a',
      stability: 0.6,
      similarity_boost: 0.75,
    })).toThrow('Cursor must be placed before a character');
  });

  it('returns an error when preview cannot find the requested directive', () => {
    ctx.DocOps = { getTabContent: jest.fn().mockReturnValue('Hello world') };
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'directive-1', type: 'tts', _insertPos: 0, voice_id: 'voice-a', tts_model: 'model-a' },
    ]);

    const result = ctx.elevenLabsPreviewDirective('TestTab', 'missing');

    expect(result).toEqual({
      ok: false,
      error: 'Directive not found or could not locate in tab text.',
    });
  });

  it('returns an error when preview segment is empty', () => {
    ctx.DocOps = { getTabContent: jest.fn().mockReturnValue('Hello world') };
    ctx.getDirectivesOnTab_ = jest.fn().mockReturnValue([
      { name: 'directive-1', type: 'tts', _insertPos: 0, voice_id: 'voice-a', tts_model: 'model-a' },
      { name: 'directive-2', type: 'tts', _insertPos: 0, voice_id: 'voice-b', tts_model: 'model-b' },
    ]);

    const result = ctx.elevenLabsPreviewDirective('TestTab', 'directive-1');

    expect(result).toEqual({
      ok: false,
      error: 'Directive segment is empty.',
    });
  });
});

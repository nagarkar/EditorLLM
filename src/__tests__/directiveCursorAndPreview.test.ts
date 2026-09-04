import {
  clearJestDocumentPropertyCache_,
  createEditorLlmCodeVmContext,
} from './helpers/gasVmContext';

const ctx = createEditorLlmCodeVmContext();

describe('cursor-created directives and preview boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearJestDocumentPropertyCache_();
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

});

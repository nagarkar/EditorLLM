import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { encodeDirectiveNamedRangeName, makeDirectivePropertyKey_ } from '../agentHelpers';

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

function makeTextNode(text: string) {
  const textNode: any = {
    getType: () => 'TEXT',
    asText: () => textNode,
    getText: () => text,
  };
  return textNode;
}

function makeBody(textNode: any) {
  const body: any = {};
  const paragraph: any = {
    getType: () => 'PARAGRAPH',
    getNumChildren: () => 1,
    getChild: () => textNode,
    getParent: () => body,
    getChildIndex: (child: any) => child === textNode ? 0 : -1,
  };
  textNode.getParent = () => paragraph;
  body.getNumChildren = () => 1;
  body.getChild = () => paragraph;
  body.getChildIndex = (child: any) => child === paragraph ? 0 : -1;
  return body;
}

function makeNamedRange(name: string, textNode: any, matchText: string, startOffset: number) {
  return {
    getName: () => name,
    getRange: () => ({
      getRangeElements: () => [{
        getElement: () => textNode,
        getStartOffset: () => startOffset,
        getEndOffsetInclusive: () => startOffset + matchText.length - 1,
      }],
    }),
    remove: jest.fn(),
  };
}

function makeBookmark(rawId: string, textNode: any, offset: number) {
  return {
    getId: () => rawId,
    getPosition: () => ({
      getSurroundingText: () => textNode,
      getSurroundingTextOffset: () => offset,
    }),
    remove: jest.fn(),
  };
}

describe('TTS directives via real directive persistence', () => {
  const propStore = new Map<string, string>();
  let textNode: any;
  let namedRange: any;
  let bookmark: any;
  let tab: any;
  let activeDoc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    propStore.clear();

    textNode = makeTextNode('Hello World');
    namedRange = makeNamedRange(
      encodeDirectiveNamedRangeName('TtsAgent', 'abc123', 'bookmark123'),
      textNode,
      'Hello World',
      0
    );
    bookmark = makeBookmark('bookmark123', textNode, 0);
    tab = {
      getBody: () => makeBody(textNode),
      getNamedRanges: jest.fn().mockReturnValue([namedRange]),
      getBookmarks: jest.fn().mockReturnValue([bookmark]),
    };
    activeDoc = {
      getId: () => 'docId',
      setCursor: jest.fn(),
      setSelection: jest.fn(),
    };

    ctx.DocumentApp = {
      ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH' },
      getActiveDocument: () => activeDoc,
    };
    ctx.DocOps = {
      getTabByName: jest.fn((tabName: string) => tabName === 'TestTab' ? tab : null),
    };
    ctx.Tracer = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
    ctx.PropertiesService = {
      getDocumentProperties: () => ({
        getProperty: (key: string) => propStore.get(key) ?? null,
        setProperty: (key: string, value: string) => { propStore.set(key, value); },
        deleteProperty: (key: string) => { propStore.delete(key); },
      }),
    };

    propStore.set(makeDirectivePropertyKey_('abc123'), JSON.stringify({
      v: 2,
      type: 'tts',
      payload: {
        tts_model: 'eleven_multilingual_v2',
        voice_id: 'voice123',
        stability: 0.75,
        similarity_boost: 0.8,
      },
    }));
  });

  it('loads TTS directives by reading real named ranges, bookmarks, and stored records', () => {
    const directives = ctx.getTabDirectives('TestTab');

    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      agent: 'TtsAgent',
      directiveId: 'abc123',
      bookmarkId: 'bookmark123',
      matchText: 'Hello World',
      type: 'tts',
      tts_model: 'eleven_multilingual_v2',
      voice_id: 'voice123',
      stability: 0.75,
      similarity_boost: 0.8,
      _insertPos: 0,
      _matchPos: 0,
    });
  });

  it('updates the stored payload via the real updateTtsDirective code path', () => {
    const oldName = encodeDirectiveNamedRangeName('TtsAgent', 'abc123', 'bookmark123');

    const result = ctx.updateTtsDirective('TestTab', 'bookmark123', oldName, {
      tts_model: 'new_model',
      voice_id: 'newvoice',
      stability: 0.9,
      similarity_boost: 0.99,
    });

    expect(result).toBe(true);
    expect(JSON.parse(propStore.get(makeDirectivePropertyKey_('abc123')) || '{}')).toMatchObject({
      type: 'tts',
      payload: {
        tts_model: 'new_model',
        voice_id: 'newvoice',
        stability: 0.9,
        similarity_boost: 0.99,
      },
    });
  });

  it('deletes the real named range, bookmark, and stored payload', () => {
    const namedRangeName = encodeDirectiveNamedRangeName('TtsAgent', 'abc123', 'bookmark123');

    const result = ctx.deleteTtsDirective('TestTab', 'bookmark123', namedRangeName);

    expect(result).toBe(true);
    expect(namedRange.remove).toHaveBeenCalledTimes(1);
    expect(bookmark.remove).toHaveBeenCalledTimes(1);
    expect(propStore.has(makeDirectivePropertyKey_('abc123'))).toBe(false);
  });
});

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import {
  encodeDirectiveNamedRangeName,
  makeDirectivePropertyKey_,
} from '../agentHelpers';

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

function clearDirectivesOnTab(tabName: string): void {
  ctx.clearDirectivesOnTab(tabName);
}

function dirName(directiveId: string, bookmarkRaw: string): string {
  return encodeDirectiveNamedRangeName('TtsAgent', directiveId, bookmarkRaw);
}

function makeNR(name: string) {
  return { getName: () => name, remove: jest.fn() };
}

function makeBM(rawId: string) {
  return { getId: () => rawId, remove: jest.fn() };
}

function makeTab(
  namedRanges: ReturnType<typeof makeNR>[],
  bookmarks: ReturnType<typeof makeBM>[],
) {
  return {
    getNamedRanges: jest.fn().mockReturnValue(namedRanges),
    getBookmarks: jest.fn().mockReturnValue(bookmarks),
  };
}

describe('clearDirectivesOnTab', () => {
  const propStore = new Map<string, string>();

  beforeEach(() => {
    propStore.clear();
    jest.clearAllMocks();
    ctx.PropertiesService = {
      getDocumentProperties: () => ({
        getProperty: (key: string) => propStore.get(key) ?? null,
        setProperty: (key: string, val: string) => { propStore.set(key, val); },
        deleteProperty: (key: string) => { propStore.delete(key); },
      }),
    };
  });

  function setTab(tab: ReturnType<typeof makeTab> | null): void {
    ctx.DocOps = {
      getTabByName: jest.fn().mockReturnValue(tab),
      isManagedTab: jest.fn().mockReturnValue(true),
    };
  }

  it('removes directive properties along with named ranges and bookmarks', () => {
    const nr = makeNR(dirName('abc123', 'id.target'));
    const bm = makeBM('id.target');
    propStore.set(makeDirectivePropertyKey_('abc123'), '{"v":2,"type":"tts","payload":{}}');
    setTab(makeTab([nr], [bm]));

    clearDirectivesOnTab('TestTab');

    expect(nr.remove).toHaveBeenCalledTimes(1);
    expect(bm.remove).toHaveBeenCalledTimes(1);
    expect(propStore.has(makeDirectivePropertyKey_('abc123'))).toBe(false);
  });

  it('skips annotation ranges', () => {
    const annot = makeNR('annotation_id_abc123');
    const bm = makeBM('id.target');
    setTab(makeTab([annot], [bm]));

    clearDirectivesOnTab('TestTab');

    expect(annot.remove).not.toHaveBeenCalled();
    expect(bm.remove).not.toHaveBeenCalled();
  });
});

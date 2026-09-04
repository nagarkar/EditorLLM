const fs = require('fs');
const path = require('path');

function loadCompiledGlobal(varName: string, fileName: string): void {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dist', fileName),
    'utf8'
  );
  const patched = src.replace(new RegExp('^const ' + varName + '\\b', 'm'), varName);
  const fn = new Function(patched);
  fn();
}

describe('DocOps.getOrCreateRootTabAtIndex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).Tracer = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const mockDocTab = { getBody: jest.fn() };
    const mockTab = { asDocumentTab: jest.fn().mockReturnValue(mockDocTab) };
    const mockDocument = {
      getTabs: jest.fn().mockReturnValue([]),
      getId: jest.fn().mockReturnValue('mock-doc-id'),
      getTab: jest.fn().mockReturnValue(mockTab),
    };

    (global as any).DocumentApp = {
      getActiveDocument: jest.fn().mockReturnValue(mockDocument),
      openById: jest.fn().mockReturnValue(mockDocument),
    };

    (global as any).Docs = {
      Documents: {
        get: jest.fn().mockReturnValue({ tabs: [] }),
        batchUpdate: jest.fn().mockReturnValue({
          replies: [{
            addDocumentTab: {
              tab: {
                tabProperties: {
                  tabId: 't.manuscript',
                },
              },
            },
          }],
        }),
      },
    };

    loadCompiledGlobal('DocOps', 'DocOps.js');
  });

  it('creates a missing root tab at the requested top-level index', () => {
    const docTab = (global as any).DocOps.getOrCreateRootTabAtIndex('Manuscript', 0);

    expect((global as any).Docs.Documents.batchUpdate).toHaveBeenCalledWith(
      {
        requests: [{
          addDocumentTab: {
            tabProperties: {
              title: 'Manuscript',
              index: 0,
            },
          },
        }],
      },
      'mock-doc-id'
    );
    expect(docTab).toBeDefined();
  });
});

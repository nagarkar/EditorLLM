// TypeScript version of the Jest setup file
declare const global: any;

const mockBody = {
  getText: jest.fn().mockReturnValue(''),
  clear: jest.fn(),
  appendParagraph: jest.fn(),
  findText: jest.fn().mockReturnValue(null),
};

const mockDocumentTab = {
  getBody: jest.fn().mockReturnValue(mockBody),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
};

const mockTab = {
  getTitle: jest.fn().mockReturnValue('MockTab'),
  getId: jest.fn().mockReturnValue('mock-tab-id'),
  getChildTabs: jest.fn().mockReturnValue([]),
  asDocumentTab: jest.fn().mockReturnValue(mockDocumentTab),
};

const mockDocument = {
  getTabs: jest.fn().mockReturnValue([mockTab]),
  addTab: jest.fn().mockReturnValue(mockTab),
  getId: jest.fn().mockReturnValue('mock-doc-id'),
  getName: jest.fn().mockReturnValue('Mock Document'),
};

global.DocumentApp = {
  getActiveDocument: jest.fn().mockReturnValue(mockDocument),
  ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH' },
};

global.PropertiesService = {
  getUserProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue(null),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
  }),
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue(null),
    setProperty: jest.fn(),
  }),
};

global.UrlFetchApp = {
  fetch: jest.fn().mockReturnValue({
    getContentText: jest.fn().mockReturnValue('{}'),
    getResponseCode: jest.fn().mockReturnValue(200),
  }),
};

global.ScriptApp = {
  getOAuthToken: jest.fn().mockReturnValue('mock-token'),
};

global.Drive = {
  Comments: {
    create: jest.fn().mockReturnValue({ id: 'mock-comment-id' }),
    list: jest.fn().mockReturnValue({ comments: [] }),
  },
};

global.Logger = {
  log: jest.fn(),
};

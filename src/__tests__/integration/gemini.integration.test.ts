import { callGemini } from './helpers/gemini';
import { BATCH_REPLY_SCHEMA } from './helpers/schemas';
import { INTEGRATION_SYSTEM_PROMPT } from './fixtures/testDocument';

describe('Gemini integration helper', () => {
  it('throws a descriptive error when the API key is invalid', () => {
    expect(() =>
      callGemini(INTEGRATION_SYSTEM_PROMPT, 'test', BATCH_REPLY_SCHEMA, {
        tier:               'fast',
        testWithInvalidKey: true,
      })
    ).toThrow(/Gemini API error/);
  });
});

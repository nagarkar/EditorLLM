import { supportsThinkingConfig } from './integration/helpers/gemini';

describe('supportsThinkingConfig', () => {
  it('returns true for documented thinking-capable Gemini model families', () => {
    expect(supportsThinkingConfig('gemini-2.5-pro')).toBe(true);
    expect(supportsThinkingConfig('gemini-2.5-flash')).toBe(true);
    expect(supportsThinkingConfig('gemini-2.5-flash-lite')).toBe(true);
    expect(supportsThinkingConfig('gemini-3-flash-preview')).toBe(true);
    expect(supportsThinkingConfig('gemini-3.1-pro-preview')).toBe(true);
    expect(supportsThinkingConfig('gemini-3-pro-image-preview')).toBe(true);
  });

  it('returns false for configured models that should not receive thinkingConfig', () => {
    expect(supportsThinkingConfig('gemini-2.0-flash-001')).toBe(false);
    expect(supportsThinkingConfig('gemini-2.0-flash-thinking-exp-01-21')).toBe(false);
    expect(supportsThinkingConfig('gemini-1.5-pro')).toBe(false);
    expect(supportsThinkingConfig('')).toBe(false);
  });
});

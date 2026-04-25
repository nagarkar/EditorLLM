import {
  assertBookmarkIdWireable_,
  bookmarkIdToWire_,
  decodeDirectiveNamedRangeName,
  decodeTtsDirectiveMiddleWire,
  encodeDirectiveNamedRangeName,
  encodeTtsDirectiveMiddleWire,
  makeDirectivePropertyKey_,
  sanitizeDirectiveNamePart_,
  splitDirectiveNamedRangeName,
  wireToBookmarkId_,
} from '../agentHelpers';

const BOOKMARK_KIX_STYLE = 'kix.LSILUvJ9dU4G';
const BOOKMARK_LONG_ALNUM = 'idk0x7f3a2b1c9e4d2a8f3b6c1';

describe('directive named range codec', () => {
  describe('sanitizeDirectiveNamePart_', () => {
    it('keeps alphanumerics and underscores', () => {
      expect(sanitizeDirectiveNamePart_('TtsAgent')).toBe('TtsAgent');
      expect(sanitizeDirectiveNamePart_('abc_123_X')).toBe('abc_123_X');
    });

    it('strips brackets, punctuation, and spaces', () => {
      expect(sanitizeDirectiveNamePart_('[TtsAgent]')).toBe('TtsAgent');
      expect(sanitizeDirectiveNamePart_('id.abc-12')).toBe('idabc12');
    });
  });

  describe('bookmarkId wire rules', () => {
    it('rejects more than one dot', () => {
      expect(() => assertBookmarkIdWireable_('kix.a.b')).toThrow(/at most one/);
    });

    it('rejects underscore in raw bookmark id', () => {
      expect(() => assertBookmarkIdWireable_('kix_bad')).toThrow(/must not contain '_'/);
    });

    it('round-trips a single dot for kix-style ids', () => {
      expect(bookmarkIdToWire_(BOOKMARK_KIX_STYLE)).toBe('kix_LSILUvJ9dU4G');
      expect(wireToBookmarkId_('kix_LSILUvJ9dU4G')).toBe(BOOKMARK_KIX_STYLE);
    });
  });

  describe('directive property keys', () => {
    it('creates stable property keys from directive ids', () => {
      expect(makeDirectivePropertyKey_('abc123')).toBe('directive:abc123');
    });
  });

  describe('splitDirectiveNamedRangeName', () => {
    it('splits agent, directiveId, and bookmark', () => {
      const name = encodeDirectiveNamedRangeName('TtsAgent', 'abc123', BOOKMARK_LONG_ALNUM);
      expect(splitDirectiveNamedRangeName(name)).toEqual({
        agent: 'TtsAgent',
        directiveId: 'abc123',
        bookmarkWire: BOOKMARK_LONG_ALNUM,
        bookmarkRaw: BOOKMARK_LONG_ALNUM,
      });
    });
  });

  describe('encodeDirectiveNamedRangeName + decodeDirectiveNamedRangeName', () => {
    it('round-trips a kix-style bookmark id', () => {
      const name = encodeDirectiveNamedRangeName('[TtsAgent]', 'abc123', BOOKMARK_KIX_STYLE);
      expect(name).toBe('directive_TtsAgent_abc123_kix_LSILUvJ9dU4G');

      const dec = decodeDirectiveNamedRangeName(name);
      expect(dec.ok).toBe(true);
      if (!dec.ok) return;
      expect(dec.agent).toBe('TtsAgent');
      expect(dec.directiveId).toBe('abc123');
      expect(dec.bookmarkId).toBe('kix_LSILUvJ9dU4G');
      expect(dec.bookmarkRaw).toBe(BOOKMARK_KIX_STYLE);
    });

    it('returns not_directive_name for invalid strings', () => {
      expect(decodeDirectiveNamedRangeName('nounderscores')).toEqual({
        ok: false,
        reason: 'not_directive_name',
      });
    });

    it('throws when sanitized agent is empty', () => {
      expect(() =>
        encodeDirectiveNamedRangeName('[]', 'abc123', BOOKMARK_LONG_ALNUM)
      ).toThrow(/Directive agent prefix/);
    });
  });

  describe('TTS payload wire codec', () => {
    it('round-trips TTS payload fields separately from directive name', () => {
      const middle = encodeTtsDirectiveMiddleWire({
        tts_model: 'eleven_multilingual_v2',
        voice_id: '21m00Tcm4TlvDq8ikWAM',
        stability: 0.5,
        similarity_boost: 0.75,
      });
      expect(middle).toBe('eleven_multilingual_v2_21m00Tcm4TlvDq8ikWAM_500_750');

      const dec = decodeTtsDirectiveMiddleWire(middle);
      expect(dec.ok).toBe(true);
      if (!dec.ok) return;
      expect(dec.payload).toMatchObject({
        tts_model: 'eleven_multilingual_v2',
        voice_id: '21m00Tcm4TlvDq8ikWAM',
        stability: 0.5,
        similarity_boost: 0.75,
      });
    });
  });
});

/**
 * Tests for exportPartialManifest — the routing/guarding wrapper around buildManifest.
 *
 * Strategy: load Code.js into a vm context, then replace ctx.buildManifest and
 * ctx.buildSpecialManifest_ with jest.fn() stubs so we test only the routing
 * logic (prohibited tabs, special-key mapping, chapter fallback, null
 * pass-through) without needing a live GAS runtime.
 *
 * Requires `npm run build` to be run first (reads from dist/).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { Constants } from '../Constants';

const agentHelpersJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/agentHelpers.js'),
  'utf8',
);
const constantsJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/Constants.js'),
  'utf8',
);
const codeJs = fs.readFileSync(
  path.resolve(__dirname, '../../dist/Code.js'),
  'utf8',
);

const ctx = Object.assign(vm.createContext({}), global) as any;
vm.runInContext(agentHelpersJs, ctx);
vm.runInContext(constantsJs, ctx);
vm.runInContext(codeJs, ctx);

const FAKE_MANIFEST: any = {
  version: 1,
  documentTitle: 'Test Doc',
  tabName: 'SomeTab',
  generatedAt: new Date().toISOString(),
  sections: [
    {
      id: 'sec1',
      type: 'speech',
      text: 'Hello world.',
      voiceId: 'v1',
      voiceName: 'Voice One',
      ttsModel: 'eleven_multilingual_v2',
      stability: 0.5,
      similarityBoost: 0.75,
    },
  ],
};

describe('exportPartialManifest — routing logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Stub both internal builders
    ctx.buildManifest = jest.fn().mockReturnValue(FAKE_MANIFEST);
    ctx.buildSpecialManifest_ = jest.fn().mockReturnValue(null); // credits return null by default
  });

  // ── Prohibited tabs ──────────────────────────────────────────────────────

  it('throws for PUBLISHER_SALES', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_SALES))
      .toThrow('Sales copy is for EPUB publishing');
  });

  it('throws for PUBLISHER_HOOKS', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_HOOKS))
      .toThrow('Hooks are for EPUB publishing');
  });

  it('throws for PUBLISHER_COVER', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_COVER))
      .toThrow('Cover tab contains design prompts');
  });

  it('throws for PUBLISHER_VISUAL_STYLES', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_VISUAL_STYLES))
      .toThrow('Visual Styles is for EPUB styling');
  });

  it('throws for PUBLISHER_COPYRIGHT', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_COPYRIGHT))
      .toThrow('Copyright tab is document metadata');
  });

  it('throws for PUBLISHER_INSTRUCTIONS', () => {
    expect(() => ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_INSTRUCTIONS))
      .toThrow('Publisher Instructions is a system-prompt tab');
  });

  // ── Special audio-section tabs ────────────────────────────────────────────

  it('wraps PUBLISHER_OPENING_CREDITS under { openingCredits: manifest }', () => {
    ctx.buildSpecialManifest_ = jest.fn().mockReturnValue(FAKE_MANIFEST);
    const result = ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS);
    expect(result).toEqual({ openingCredits: FAKE_MANIFEST });
    expect(ctx.buildSpecialManifest_).toHaveBeenCalledWith(
      Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS, false,
    );
  });

  it('wraps PUBLISHER_CLOSING_CREDITS under { closingCredits: manifest }', () => {
    ctx.buildSpecialManifest_ = jest.fn().mockReturnValue(FAKE_MANIFEST);
    const result = ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS);
    expect(result).toEqual({ closingCredits: FAKE_MANIFEST });
    expect(ctx.buildSpecialManifest_).toHaveBeenCalledWith(
      Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS, false,
    );
  });

  it('wraps PUBLISHER_ABOUT_AUTHOR under { aboutAuthor: manifest }', () => {
    ctx.buildSpecialManifest_ = jest.fn().mockReturnValue(FAKE_MANIFEST);
    const result = ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR);
    expect(result).toEqual({ aboutAuthor: FAKE_MANIFEST });
    expect(ctx.buildSpecialManifest_).toHaveBeenCalledWith(
      Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR, true,
    );
  });

  // ── Chapter tabs include chapter + available credits ──────────────────────

  it('wraps an arbitrary chapter tab under { chapter: manifest } when no credits available', () => {
    // buildSpecialManifest_ returns null (no credits tabs exist)
    const result = ctx.exportPartialManifest('Chapter 1');
    expect(result).toEqual({ chapter: FAKE_MANIFEST });
    expect(ctx.buildManifest).toHaveBeenCalledWith('Chapter 1');
  });

  it('includes credits in chapter export when credits tabs have content', () => {
    const OC_MANIFEST = { ...FAKE_MANIFEST, tabName: 'Opening Audio Credits' };
    const CC_MANIFEST = { ...FAKE_MANIFEST, tabName: 'Closing Audio Credits' };
    const AA_MANIFEST = { ...FAKE_MANIFEST, tabName: 'About The Author' };
    ctx.buildSpecialManifest_ = jest.fn().mockImplementation(
      (tabName: string) => {
        if (tabName === Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS) return OC_MANIFEST;
        if (tabName === Constants.TAB_NAMES.PUBLISHER_CLOSING_CREDITS) return CC_MANIFEST;
        if (tabName === Constants.TAB_NAMES.PUBLISHER_ABOUT_AUTHOR) return AA_MANIFEST;
        return null;
      },
    );
    const result = ctx.exportPartialManifest('Chapter 1');
    expect(result).toEqual({
      chapter: FAKE_MANIFEST,
      openingCredits: OC_MANIFEST,
      closingCredits: CC_MANIFEST,
      aboutAuthor: AA_MANIFEST,
    });
  });

  it('wraps a non-publisher tab under { chapter: manifest }', () => {
    const result = ctx.exportPartialManifest('Part One — The Beginning');
    expect(result).toEqual({ chapter: FAKE_MANIFEST });
  });

  // ── Null pass-through (no content on tab) ────────────────────────────────

  it('returns null when buildManifest returns null for a chapter tab', () => {
    ctx.buildManifest = jest.fn().mockReturnValue(null);
    const result = ctx.exportPartialManifest('Chapter 2');
    expect(result).toBeNull();
  });

  it('returns null for a special tab when buildSpecialManifest_ returns null', () => {
    ctx.buildSpecialManifest_ = jest.fn().mockReturnValue(null);
    const result = ctx.exportPartialManifest(Constants.TAB_NAMES.PUBLISHER_OPENING_CREDITS);
    expect(result).toBeNull();
  });
});

// Ambient type declarations for the GAS client-side API and sidebar helpers.
// Not compiled to JS — exists only for TypeScript checking in client/*.ts files.

// ── google.script.run ──────────────────────────────────────────────────────
declare namespace google {
  namespace script {
    interface ServerCallBuilder {
      withSuccessHandler(fn: (result: any) => void): ServerCallBuilder;
      withFailureHandler(fn: (err: { message: string }) => void): ServerCallBuilder;
      [fnName: string]: any;
    }
    const run: ServerCallBuilder;
    const host: {
      close(): void;
      editor: { focus(): void };
    };
  }
}

// ── runServer helper ──────────────────────────────────────────────────────
// Declared here so all client modules can call it without import.
// The implementation lives in 01-helpers.ts.
declare function runServer(fnName: string, ...args: any[]): Promise<any>;

// ── MultiSelectTabs ────────────────────────────────────────────────────────
// Defined in Sidebar.html inline script; declared here for TypeScript checking.
declare class MultiSelectTabs {
  constructor(containerId: string, options?: { onChange?: (selected: string[]) => void });
  static create(options: { container: HTMLElement; placeholder?: string; onChange?: (selected: string[]) => void }): MultiSelectTabs;
  getSelected(): string[];
  setOptions(names: string[]): void;
  setSelected(names: string[]): void;
  getValue(): string[];
}

// ── FFmpeg (CDN-loaded @ffmpeg/ffmpeg v0.11.x) ────────────────────────────
declare const FFmpeg: {
  createFFmpeg(opts: { corePath?: string; workerPath?: string; wasmPath?: string; mainName?: string; log?: boolean }): any;
};

// ── DOM element access ────────────────────────────────────────────────────
// GAS sidebar code uses getElementById without element-specific casts.
// Extend HTMLElement with the common properties so the migration compiles;
// tighten these to proper subtypes (HTMLInputElement etc.) incrementally.
interface HTMLElement {
  value: any;
  checked: any;
  disabled: any;
  placeholder: any;
  src: any;
  href: any;
  selectedIndex: any;
  options: any;
  play(): void;
}

// querySelectorAll / NodeListOf<Element> — extend Element for .value access
interface Element {
  value: any;
}

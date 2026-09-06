/**
 * Minimal DOM type declarations for the voice module.
 *
 * The extension tsconfig only includes "chrome" and "node" types,
 * so standard DOM types like Audio, BlobEvent, etc. are unavailable.
 */

declare class AudioElement extends EventTarget {
  src: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
}

declare class AudioClass {
  constructor(src?: string);
  src: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
}

declare const Audio: AudioClass;
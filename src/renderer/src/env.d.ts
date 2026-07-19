import type { XpadApi } from '../../preload/index';

declare global {
  interface Window {
    xpad: XpadApi;
  }
}

export {};

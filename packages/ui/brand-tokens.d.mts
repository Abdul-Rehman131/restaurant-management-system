import type { Plugin } from 'vite';

export interface BrandTokens {
  brand: string;
  brandDark: string;
  background: string;
}

export function readTokens(theme?: 'light' | 'dark'): Record<string, string>;
export function brandTokens(): BrandTokens;
export function brandHtml(): Plugin;

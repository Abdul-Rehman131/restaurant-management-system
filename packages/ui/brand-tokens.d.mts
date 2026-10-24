import type { Plugin } from 'vite';

export interface BrandTokens {
  brand: string;
  brandDark: string;
  background: string;
}

export function brandTokens(): BrandTokens;
export function brandHtml(): Plugin;

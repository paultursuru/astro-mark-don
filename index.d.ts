import type { AstroIntegration } from 'astro';

export interface AstroMarkDonOptions {
  exclude?: string[];
  turndownOptions?: {
    headingStyle?: 'atx' | 'setext';
    codeBlockStyle?: 'fenced' | 'indented';
    bulletListMarker?: '-' | '+' | '*';
  };
  cleanupFn?: (markdown: string, pagePath: string) => string;
}

export default function astroMarkDon(options?: AstroMarkDonOptions): AstroIntegration;

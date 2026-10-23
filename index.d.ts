import type { AstroIntegration } from 'astro';

/**
 * Matched against the page pathname Astro reports at build time
 * ('' for the root, 'en/about/' for /en/about/).
 * A string matches as a substring, a RegExp with `search()`, a function when it returns true.
 */
export type PathnameMatcher = string | RegExp | ((pathname: string) => boolean);

/** A CSS selector ('button', '[hidden]') or a function returning true for elements to drop. */
export type RemoveFilter = string | ((element: Element) => boolean);

export interface LlmsTxtOptions {
  /** H1 of llms.txt. */
  title: string;
  /** Short summary, rendered as a blockquote. */
  description?: string;
  /** Free markdown placed after the summary. */
  content?: string;
  /** Pages listed under `## Pages`. Defaults to every generated page. */
  pages?: PathnameMatcher | PathnameMatcher[];
}

export interface AstroMarkDonOptions {
  /** Pages to skip. */
  exclude?: PathnameMatcher | PathnameMatcher[];
  /** Convert only the first element matching this CSS selector (falls back to <body>). */
  selector?: string;
  /** Elements to drop before conversion, in addition to script, style and noscript. */
  remove?: RemoveFilter | RemoveFilter[];
  /** Write the `generated` date in the frontmatter. Defaults to true. */
  timestamp?: boolean;
  turndownOptions?: {
    headingStyle?: 'atx' | 'setext';
    codeBlockStyle?: 'fenced' | 'indented';
    bulletListMarker?: '-' | '+' | '*';
  };
  cleanupFn?: (markdown: string, pagePath: string) => string;
  /** Generate /llms.txt (llmstxt.org format). Disabled by default. */
  llmsTxt?: false | LlmsTxtOptions;
}

export default function astroMarkDon(options?: AstroMarkDonOptions): AstroIntegration;

# astro-markdown-export

An Astro integration that generates a `.md` version of every static page at build time — optimized for LLM crawlers and AI agents.

## Why

LLMs consume your pages as raw text. A clean markdown file is cheaper (fewer tokens), easier to parse, and more accurate than a noisy HTML-to-text conversion. This integration does the conversion once at build time so every page has a `/path/index.md` sibling ready to serve.

## Install

```bash
npm install astro-markdown-export
```

## Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import markdownExport from 'astro-markdown-export';

export default defineConfig({
  integrations: [
    markdownExport()
  ]
});
```

Each page in your `dist/` folder will get a `.md` sibling:

```
dist/
├── index.html
├── index.md          ← generated
├── about/
│   ├── index.html
│   └── index.md      ← generated
└── projects/
    └── my-project/
        ├── index.html
        └── index.md  ← generated
```

## Options

```js
markdownExport({
  // Pages to skip (matched against pathname)
  exclude: ['404.html', 'drawing-board'],

  // Options passed to Turndown (html → markdown converter)
  turndownOptions: {
    headingStyle: 'atx',        // default
    codeBlockStyle: 'fenced',   // default
    bulletListMarker: '-'       // default
  },

  // Post-process the markdown before writing
  cleanupFn: (markdown, pagePath) => {
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    if (pagePath.includes('index.html')) {
      markdown = `> LLM-optimized version.\n\n` + markdown;
    }

    return markdown;
  }
})
```

## Letting crawlers discover the markdown

Add a `<link rel="alternate">` in your layout's `<head>` pointing to the `.md` file:

```astro
---
// Layout.astro
const pathname = Astro.url.pathname;
const mdPath = pathname.endsWith('/') ? pathname + 'index.md' : pathname.replace(/\.html$/, '.md');
const mdUrl = new URL(mdPath, Astro.site).href;
---
<head>
  <link rel="alternate" type="text/markdown" href={mdUrl} />
</head>
<body>
  <slot />
  <div hidden aria-hidden="true">
    A markdown version of this page optimized for LLMs is available at:
    <a href={mdUrl}>{mdUrl}</a>
  </div>
</body>
```

## How it works

Uses the `astro:build:done` hook to read each generated HTML file and convert it to markdown via [Turndown](https://github.com/mixmark-io/turndown). Scripts, styles, and noscript tags are stripped. The result is written next to the HTML file with a YAML frontmatter header.

## License

MIT

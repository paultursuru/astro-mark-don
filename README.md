# astro-mark-don

An Astro integration that generates a `.md` version of every static page at build time — optimized for LLM crawlers and AI agents.

Part of the **mark-don** family — see also [mark-don](https://github.com/paultursuru/mark-don), the original Ruby gem that inspired this integration.

## Why

LLMs consume your pages as raw text. A clean markdown file is cheaper (fewer tokens), easier to parse, and more accurate than a noisy HTML-to-text conversion. This integration does the conversion once at build time so every page has a `/path/index.md` sibling ready to serve.

## Install

```bash
npm install astro-mark-don
```

## Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import markDon from 'astro-mark-don';

export default defineConfig({
  integrations: [
    markDon()
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
markDon({
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

## Serving `.md` files with the correct Content-Type

By default, some hosts serve `.md` files as `application/octet-stream`, which triggers a file download instead of displaying the content. This doesn't affect LLMs that fetch URLs directly via HTTP — they read the body regardless — but it can break browser-based tools or headless browser crawlers.

No action is needed unless you observe this issue. The examples below are starting points — they haven't all been tested on every platform version or configuration. If something doesn't work, check your host's documentation for MIME type or response header configuration.

**Netlify** — add a `_headers` file at the root of your `dist/` or `public/` folder:

```
/*.md
  Content-Type: text/markdown; charset=utf-8
```

**Vercel** — add to `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)\\.md",
      "headers": [{ "key": "Content-Type", "value": "text/markdown; charset=utf-8" }]
    }
  ]
}
```

**fly.io / Generic nginx** | **_tested and approved_** - add a `location` block for `.md` files inside your `server` block. This avoids conflicts with the existing `include /etc/nginx/mime.types;` directive:

```nginx
http {
  # ... other http blocks ...
  server {
    # ... other server blocks ...
    location ~* \.md$ {
        default_type "text/markdown; charset=utf-8";
      }
    }
  }
}
```

Do not add a top-level `types {}` block alongside `include /etc/nginx/mime.types;` — the two conflict and will break your server config.

For other platforms, the fix is equivalent: map the `.md` extension to `text/markdown` or `text/plain` in the server's MIME type configuration.

## How it works

Uses the `astro:build:done` hook to read each generated HTML file and convert it to markdown via [Turndown](https://github.com/mixmark-io/turndown). Scripts, styles, and noscript tags are stripped. The result is written next to the HTML file with a YAML frontmatter header.

## License

MIT

# astro-mark-don

An Astro integration that generates a `.md` version of every static page at build time, plus an optional `llms.txt` that tells LLM crawlers and AI agents where to find them.

Part of the **mark-don** family. See also [mark-don](https://github.com/paultursuru/mark-don), the original Ruby gem that inspired this integration.

## Why

LLMs consume your pages as raw text. A clean markdown file is cheaper (fewer tokens), easier to parse, and more accurate than a noisy HTML-to-text conversion. This integration does the conversion once at build time so every page has a `.md` companion at a matching URL ready to serve.

## Install

```bash
npm install astro-mark-don
```

Works with Astro 4, 5 and 6.

## Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import markDon from 'astro-mark-don';

export default defineConfig({
  site: 'https://example.com', // used for absolute URLs in the frontmatter and llms.txt
  integrations: [
    markDon()
  ]
});
```

Each page in your `dist/` folder gets a `.md` file at a URL that mirrors the page itself. The root becomes `index.md`, and every other page becomes `<page>.md` (instead of `<page>/index.md`), so the markdown URL is identical to the page URL with a `.md` suffix:

```
dist/
├── index.html
├── index.md             ← generated  (/ → /index.md)
├── about/
│   └── index.html
├── about.md             ← generated  (/about → /about.md)
└── projects/
    ├── my-project/
    │   └── index.html
    └── my-project.md    ← generated  (/projects/my-project → /projects/my-project.md)
```

Each file starts with a YAML frontmatter. Values are quoted, so a `:` or a `#` in a title is safe:

```markdown
---
title: "About : Example"
source: "https://example.com/about/"
generated: "2026-10-23T08:07:39.927Z"
note: "This is a markdown version optimized for LLMs. For the full experience, visit the HTML version."
---

## About
...
```

`title` comes from the page's `<title>`. `source` is the absolute page URL when `site` is set in your Astro config, and a site-relative path (`/about/`) otherwise.

In `astro dev`, any `.md` URL is converted on the fly from the page it mirrors, with the same options. `llms.txt` is only written at build time.

## Options

```js
markDon({
  // Pages to skip. See "Matching pages" below.
  exclude: ['drawing-board', /^404\/$/],

  // Convert only the first element matching this CSS selector.
  // Pages without a match fall back to <body>, with a warning.
  selector: 'main',

  // Elements to drop before conversion, in addition to script, style and noscript:
  // CSS selectors, or functions receiving each element.
  remove: ['button', 'svg', 'template', '[hidden]', '[aria-hidden="true"]', (el) => el.classList.contains('toast')],

  // Set to false to omit the `generated` date, so unchanged pages give identical files on every build.
  timestamp: true,

  // Options passed to Turndown (html → markdown converter)
  turndownOptions: {
    headingStyle: 'atx',        // default
    codeBlockStyle: 'fenced',   // default
    bulletListMarker: '-'       // default
  },

  // Post-process the markdown before writing (the frontmatter is added afterwards)
  cleanupFn: (markdown, pagePath) => {
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    if (pagePath === '') {
      markdown = `> LLM-optimized version of the home page.\n\n` + markdown;
    }

    return markdown;
  },

  // Generate /llms.txt. Disabled by default. See below.
  llmsTxt: false
})
```

### Matching pages

`exclude` and `llmsTxt.pages` take one matcher or an array of them. Each one is tested against the pathname Astro reports for the page: `''` for the root, `'about/'` for `/about/`, `'en/about/'` for `/en/about/` (no trailing slash with `build.format: 'file'` or `trailingSlash: 'never'`).

| Matcher | Matches when | Example |
| --- | --- | --- |
| string | the pathname contains it | `'en/'` matches `en/` and `en/about/` |
| RegExp | the pathname matches it | `/^en\/$/` matches `en/` only, `/^$/` matches the root only |
| function | it returns `true` | `(pathname) => pathname.endsWith('about/')` |

### Cleaning up app pages

Interactive pages carry a lot of UI that reads as noise once flattened: close buttons, icons, labels of panels that only JavaScript fills in. `remove` drops matching elements from the DOM before Turndown runs, and `selector` keeps only the part of the page worth reading.

`remove` works on the parsed DOM rather than through Turndown's own `remove()`, because Turndown's built-in rules take precedence: with Turndown alone, a `<p hidden>` or an `<a aria-hidden="true">` would still be converted.

## llms.txt

[llms.txt](https://llmstxt.org) is a markdown file at the root of a site that tells LLMs what the site is and which pages to read. It is the main way for agents to discover your `.md` files. Enable it with `llmsTxt`:

```js
markDon({
  llmsTxt: {
    title: 'MeridianWay',
    description: 'Two walking routes between two points: one in the sun, the other in the shade.',
    content: `To open the app on a given walk, link to https://meridian-way.ch/ with these query parameters:

- \`from\` and \`to\`: start and destination as \`lat,lng\`.
- \`dt\` (optional): local date and time, \`YYYY-MM-DDTHH:MM\`.`,
    pages: (pathname) => pathname.endsWith('about/'),
  },
})
```

This writes `dist/llms.txt`:

```markdown
# MeridianWay

> Two walking routes between two points: one in the sun, the other in the shade.

To open the app on a given walk, link to https://meridian-way.ch/ with these query parameters:

- `from` and `to`: start and destination as `lat,lng`.
- `dt` (optional): local date and time, `YYYY-MM-DDTHH:MM`.

## Pages

- [About : MeridianWay](https://meridian-way.ch/about.md): MeridianWay calculates two pedestrian routes...
- [About : MeridianWay](https://meridian-way.ch/en/about.md): MeridianWay calculates two pedestrian routes...
```

| Option | Required | Description |
| --- | --- | --- |
| `title` | yes | The H1. |
| `description` | no | A short summary, rendered as a blockquote. |
| `content` | no | Free markdown placed after the summary. Per the spec, avoid headings here: `##` sections are read as lists of links. |
| `pages` | no | Pages listed under `## Pages`, using the matchers above. Defaults to every generated `.md`. Each entry uses the page `<title>` and its `<meta name="description">`. |

Links are absolute when `site` is set in your Astro config. Excluded pages never appear. If `dist/llms.txt` already exists (for instance copied from `public/llms.txt`), it is left untouched and a warning is logged.

## Letting crawlers discover the markdown

`llms.txt` is the entry point most agents look for. To also point from each page to its own markdown version, add a `<link rel="alternate">` in your layout's `<head>`:

```astro
---
// Layout.astro
const pathname = Astro.url.pathname;
const normalized = pathname.replace(/\/$/, '');
const mdPath = normalized === '' ? '/index.md' : `${normalized}.md`;
const mdUrl = new URL(mdPath, Astro.site).href;
---
<head>
  <link rel="alternate" type="text/markdown" href={mdUrl} />
</head>
```

## Serving `.md` files with the correct Content-Type

By default, some hosts serve `.md` files as `application/octet-stream`, which triggers a file download instead of displaying the content. This doesn't affect LLMs that fetch URLs directly via HTTP (they read the body regardless), but it can break browser-based tools or headless browser crawlers. `llms.txt` is served as `text/plain` by most hosts, which is fine.

No action is needed unless you observe this issue. The examples below are starting points: they haven't all been tested on every platform version or configuration. If something doesn't work, check your host's documentation for MIME type or response header configuration.

**Netlify**: add a `_headers` file at the root of your `dist/` or `public/` folder:

```
/*.md
  Content-Type: text/markdown; charset=utf-8
```

**Vercel**: add to `vercel.json`:

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

**fly.io / Generic nginx** | **_tested and approved_**: add a `location` block for `.md` files inside your `server` block. This avoids conflicts with the existing `include /etc/nginx/mime.types;` directive:

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
```

Do not add a top-level `types {}` block alongside `include /etc/nginx/mime.types;`: the two conflict and will break your server config.

For other platforms, the fix is equivalent: map the `.md` extension to `text/markdown` or `text/plain` in the server's MIME type configuration.

## How it works

Uses the `astro:build:done` hook to read each generated HTML file, parse it with [domino](https://github.com/mixmark-io/domino) (the DOM implementation Turndown already uses), and convert its `<body>` (or the `selector` match) to markdown via [Turndown](https://github.com/mixmark-io/turndown). Scripts, styles, noscript tags and the `remove` matches are stripped. The result is written to a `.md` file whose URL mirrors the page (`/about` → `/about.md`, `/` → `/index.md`), with a YAML frontmatter header. When `llmsTxt` is set, `llms.txt` is written last, from the pages that were converted.

## Upgrading from 0.1

With default options, the same `.md` files are written at the same URLs, with these differences in their content:

- The page `<title>` moves from the first line of the body to a `title` field in the frontmatter.
- Frontmatter values are quoted. `generated` is now a string, not a YAML timestamp.
- `source` is the absolute page URL when `site` is set, otherwise a site-relative path with a leading slash (`/about/` instead of `about/`, `/` instead of an empty value for the root).
- Status pages (`404`, `500`) built as `404.html` in the default `directory` format were skipped with an error. They now get a `.md` like every other page: add `exclude: /^(404|500)\/?$/` to keep them out.
- The integration is now named `astro-mark-don` in Astro's logs.

## License

MIT

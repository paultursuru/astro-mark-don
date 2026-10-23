import TurndownService from 'turndown';
import domino from '@mixmark-io/domino';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTE = 'This is a markdown version optimized for LLMs. For the full experience, visit the HTML version.';

const toArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

function createTurndownService(turndownOptions) {
  const service = new TurndownService(turndownOptions);
  service.remove(['script', 'style', 'noscript']);
  return service;
}

// Strings match as substrings, RegExps with search() (which ignores the g flag and lastIndex).
function matchesAny(matchers, pathname) {
  return matchers.some((matcher) => {
    if (typeof matcher === 'function') return Boolean(matcher(pathname));
    if (matcher instanceof RegExp) return pathname.search(matcher) !== -1;
    return pathname.includes(matcher);
  });
}

// Same rule as Astro's build: does the page pathname end with a slash?
function appendsSlash(config) {
  if (config.trailingSlash === 'always') return true;
  if (config.trailingSlash === 'never') return false;
  return config.build?.format === 'directory';
}

// '' -> index.md, 'en/about/' -> en/about.md
function mdFileFor(pathname) {
  const normalized = pathname.replace(/\/$/, '');
  return normalized === '' ? 'index.md' : `${normalized}.md`;
}

// Astro writes /404 as 404.html in the directory format, and index routes as about/index.html in the preserve format.
function htmlCandidates(pathname) {
  if (pathname.endsWith('.html')) return [pathname];
  const trimmed = pathname.replace(/\/$/, '');
  if (trimmed === '') return ['index.html'];
  const nested = `${trimmed}/index.html`;
  const flat = `${trimmed}.html`;
  return pathname.endsWith('/') ? [nested, flat] : [flat, nested];
}

async function readFirst(dir, files) {
  for (const [i, file] of files.entries()) {
    try {
      return await fs.readFile(path.join(dir, file), 'utf-8');
    } catch (error) {
      if (error.code !== 'ENOENT' || i === files.length - 1) throw error;
    }
  }
}

function siteUrl(site, base, sitePath) {
  const fullPath = base.replace(/\/?$/, '/') + sitePath;
  return site ? new URL(fullPath, site).href : encodeURI(fullPath);
}

// JSON strings are valid YAML double-quoted scalars, so any ':' or '#' is safe.
function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function convertPage(html, pathname, settings) {
  const { service, selector, remove, cleanupFn, timestamp, site, base, logger } = settings;
  const doc = domino.createDocument(html);

  // Converting <body> (not the whole document) keeps the <title> text out of the markdown.
  let root = doc.body;
  if (selector) {
    const selected = doc.querySelector(selector);
    if (selected) root = selected;
    else logger.warn(`No element matches "${selector}" on /${pathname}: converting <body>`);
  }

  // Turndown's own remove() loses to its built-in rules (p, a, h1...), so filter the DOM first.
  if (remove.length) {
    const doomed = [...root.querySelectorAll('*')].filter((el) =>
      remove.some((filter) => (typeof filter === 'string' ? el.matches(filter) : filter(el)))
    );
    for (const el of doomed) el.remove();
  }

  let markdown = service.turndown(root);
  if (cleanupFn) {
    markdown = cleanupFn(markdown, pathname);
  }

  const title = doc.title.trim();
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
  const header = frontmatter({
    title,
    source: siteUrl(site, base, pathname),
    generated: timestamp && new Date().toISOString(),
    note: NOTE,
  });

  return { markdown: header + markdown, title, description };
}

function renderLlmsTxt({ title, description, content }, entries, site, base) {
  const sections = [`# ${title}`];
  if (description) {
    sections.push(description.trim().split('\n').map((line) => `> ${line}`.trimEnd()).join('\n'));
  }
  if (content) {
    sections.push(content.trim());
  }
  if (entries.length) {
    const links = entries.map((entry) => {
      const text = (entry.title || `/${entry.pathname}`).replace(/[\\[\]]/g, '\\$&');
      const summary = entry.description.replace(/\s+/g, ' ');
      return `- [${text}](${siteUrl(site, base, entry.mdFile)})${summary ? `: ${summary}` : ''}`;
    });
    sections.push(['## Pages', '', ...links].join('\n'));
  }
  return `${sections.join('\n\n')}\n`;
}

async function writeLlmsTxt(llmsTxt, generated, outDir, { site, base, logger }) {
  if (!llmsTxt.title) {
    logger.warn('llmsTxt.title is required: llms.txt skipped');
    return;
  }
  if (!site) {
    logger.warn('`site` is not set in astro.config: llms.txt links are relative');
  }

  const filters = toArray(llmsTxt.pages);
  const entries = generated
    .filter((entry) => filters.length === 0 || matchesAny(filters, entry.pathname))
    .sort((a, b) => (a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0));
  if (entries.length === 0) {
    logger.warn('No page matches llmsTxt.pages: llms.txt has no Pages section');
  }

  try {
    // 'wx' fails if the file exists, e.g. copied from public/.
    await fs.writeFile(path.join(outDir, 'llms.txt'), renderLlmsTxt(llmsTxt, entries, site, base), { flag: 'wx' });
    logger.info(`Generated llms.txt (${entries.length} pages)`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    logger.warn('llms.txt already exists in the output directory (from public/?): left untouched');
  }
}

export default function astroMarkDon(options = {}) {
  const {
    exclude = [],
    turndownOptions = {
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    },
    cleanupFn = null,
    selector = null,
    remove = [],
    timestamp = true,
    llmsTxt = false
  } = options;

  const excludeMatchers = toArray(exclude);
  const removeFilters = toArray(remove);
  let site;
  let base = '/';
  let appendSlash = false;

  const settingsFor = (service, logger) => ({
    service, selector, remove: removeFilters, cleanupFn, timestamp, site, base, logger
  });

  return {
    name: 'astro-mark-don',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site;
        base = config.base ?? '/';
        appendSlash = appendsSlash(config);
      },

      // Dev: intercept *.md requests and convert HTML on-the-fly
      'astro:server:setup': ({ server, logger }) => {
        const service = createTurndownService(turndownOptions);
        const devBase = base.replace(/\/?$/, '/');

        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (!url.pathname.endsWith('.md')) return next();

          // /en/about.md -> 'en/about/', /index.md -> '' (the pathnames Astro gives at build time)
          let pathname;
          try {
            pathname = decodeURI(url.pathname);
          } catch {
            return next();
          }
          if (!pathname.startsWith(devBase)) return next();
          pathname = pathname.slice(devBase.length).replace(/(^|\/)index\.md$/, '').replace(/\.md$/, '');
          if (pathname && appendSlash) pathname += '/';

          if (matchesAny(excludeMatchers, pathname)) return next();

          try {
            // Ask the socket that received this request, so the port Vite actually picked is used.
            const { localAddress, localPort, encrypted } = req.socket;
            const host = localAddress?.includes(':') ? `[${localAddress}]` : localAddress;
            const origin = `${encrypted ? 'https' : 'http'}://${host}:${localPort}`;
            const htmlRes = await fetch(origin + encodeURI(devBase + pathname) + url.search, {
              headers: { accept: 'text/html' }
            });
            if (!htmlRes.ok) return next();

            const html = await htmlRes.text();
            const { markdown } = convertPage(html, pathname, settingsFor(service, logger));

            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.end(markdown);
          } catch (error) {
            logger.warn(`Could not convert /${pathname}: ${error.message}`);
            next();
          }
        });
      },

      // Build: write a .md file for each page, at a URL mirroring the page
      'astro:build:done': async ({ dir, pages, logger }) => {
        const outDir = fileURLToPath(dir);
        const service = createTurndownService(turndownOptions);
        const settings = settingsFor(service, logger);
        const generated = [];

        for (const { pathname } of pages) {
          if (matchesAny(excludeMatchers, pathname)) continue;

          try {
            const html = await readFirst(outDir, htmlCandidates(pathname));
            const page = convertPage(html, pathname, settings);

            // /coucou/ -> /coucou.md, the root stays /index.md
            const mdFile = mdFileFor(pathname);
            const mdPath = path.join(outDir, mdFile);

            await fs.mkdir(path.dirname(mdPath), { recursive: true });
            await fs.writeFile(mdPath, page.markdown, 'utf-8');
            generated.push({ pathname, mdFile, title: page.title, description: page.description });
            logger.debug(`Generated ${mdFile}`);
          } catch (error) {
            logger.error(`Could not convert /${pathname}: ${error.message}`);
          }
        }

        logger.info(`Generated ${generated.length} markdown files`);

        if (llmsTxt) {
          await writeLlmsTxt(llmsTxt, generated, outDir, settings);
        }
      }
    }
  };
}

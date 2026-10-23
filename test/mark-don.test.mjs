import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import markDon from '../index.mjs';

const FIXTURE = fileURLToPath(new URL('./fixture/dist/', import.meta.url));
// Astro's pathnames for the fixture (directory format, trailingSlash 'ignore').
const PAGES = ['', 'about/', 'en/', 'en/about/', '404/'];
const tmpDirs = [];

after(() => Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))));

function createLogger() {
  const messages = { info: [], warn: [], error: [], debug: [] };
  const logger = { messages };
  for (const level of Object.keys(messages)) logger[level] = (message) => messages[level].push(message);
  return logger;
}

function astroConfig(overrides = {}) {
  return { site: 'https://example.com', base: '/', trailingSlash: 'ignore', build: { format: 'directory' }, ...overrides };
}

// Runs the integration on a fresh copy of the fixture, in a directory whose name contains a space.
async function build(options, { config = astroConfig(), pages = PAGES, setup } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mark don '));
  tmpDirs.push(dir);
  await fs.cp(FIXTURE, dir, { recursive: true });
  if (setup) await setup(dir);

  const integration = markDon(options);
  const logger = createLogger();
  await integration.hooks['astro:config:done']({ config, logger });
  await integration.hooks['astro:build:done']({
    dir: pathToFileURL(dir + path.sep),
    pages: pages.map((pathname) => ({ pathname })),
    assets: new Map(),
    logger,
  });

  const read = (file) => fs.readFile(path.join(dir, file), 'utf-8');
  const exists = (file) => fs.access(path.join(dir, file)).then(() => true, () => false);
  const mdFiles = async () =>
    (await fs.readdir(dir, { recursive: true }))
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => file.endsWith('.md'))
      .sort();
  return { dir, logger, read, exists, mdFiles };
}

function parseFrontmatter(markdown) {
  const [, block, body] = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  const fields = Object.fromEntries(
    block.split('\n').map((line) => {
      const i = line.indexOf(': ');
      return [line.slice(0, i), JSON.parse(line.slice(i + 2))];
    })
  );
  return { fields, body };
}

test('writes .md files at URLs mirroring the pages', async () => {
  const { dir, mdFiles, logger } = await build();
  assert.match(dir, / /, 'the fixture path contains a space (%20 in the file URL)');
  assert.deepEqual(await mdFiles(), ['404.md', 'about.md', 'en.md', 'en/about.md', 'index.md']);
  assert.deepEqual(logger.messages.error, []);
  assert.deepEqual(logger.messages.info, ['Generated 5 markdown files']);
});

test('root page: absolute source, title in frontmatter, not in the body', async () => {
  const { read } = await build();
  const { fields, body } = parseFrontmatter(await read('index.md'));
  assert.equal(fields.source, 'https://example.com/');
  assert.equal(fields.title, 'Home: the #1 place');
  assert.ok(!body.includes('Home: the #1 place'));
  assert.ok(body.startsWith('# [Example](/)'));
  assert.ok(!body.includes('script') && !body.includes('Enable JavaScript'));
});

test('frontmatter values with ":" and "#" are quoted', async () => {
  const { read } = await build();
  const markdown = await read('index.md');
  assert.ok(markdown.includes('title: "Home: the #1 place"\n'));
  assert.ok(markdown.includes('source: "https://example.com/"\n'));
  assert.match(markdown, /\ngenerated: "\d{4}-\d\d-\d\dT[\d:.]+Z"\n/);
  assert.ok(markdown.includes('note: "This is a markdown version optimized for LLMs. For the full experience, visit the HTML version."\n'));
});

test('source is site-relative without `site`, and honours `base`', async () => {
  const relative = await build({}, { config: astroConfig({ site: undefined }) });
  assert.equal(parseFrontmatter(await relative.read('index.md')).fields.source, '/');
  assert.equal(parseFrontmatter(await relative.read('en/about.md')).fields.source, '/en/about/');

  const withBase = await build({}, { config: astroConfig({ base: '/docs' }) });
  assert.equal(parseFrontmatter(await withBase.read('about.md')).fields.source, 'https://example.com/docs/about/');
});

test('timestamp: false makes the output stable across builds', async () => {
  const first = await build({ timestamp: false });
  const second = await build({ timestamp: false });
  const markdown = await first.read('about.md');
  assert.ok(!markdown.includes('generated:'));
  assert.equal(markdown, await second.read('about.md'));
});

test('exclude: strings keep the substring behaviour', async () => {
  const { mdFiles } = await build({ exclude: ['en/'] });
  assert.deepEqual(await mdFiles(), ['404.md', 'about.md', 'index.md']);
});

test('exclude: a RegExp can target the root or a single page', async () => {
  const root = await build({ exclude: /^$/ });
  assert.deepEqual(await root.mdFiles(), ['404.md', 'about.md', 'en.md', 'en/about.md']);

  const enOnly = await build({ exclude: [/^en\/$/] });
  assert.deepEqual(await enOnly.mdFiles(), ['404.md', 'about.md', 'en/about.md', 'index.md']);

  const global = await build({ exclude: [/about/g] });
  assert.deepEqual(await global.mdFiles(), ['404.md', 'en.md', 'index.md'], 'the g flag does not skip matches');
});

test('exclude: a function receives the pathname', async () => {
  const seen = [];
  const { mdFiles } = await build({
    exclude: (pathname) => {
      seen.push(pathname);
      return pathname === '' || pathname.startsWith('404');
    },
  });
  assert.deepEqual(seen, PAGES);
  assert.deepEqual(await mdFiles(), ['about.md', 'en.md', 'en/about.md']);
});

test('remove: CSS selectors and functions, including elements Turndown has rules for', async () => {
  const before = parseFrontmatter(await (await build()).read('index.md')).body;
  for (const text of ['×', 'Hidden paragraph', '⇅', 'Icon title', 'Distance']) {
    assert.ok(before.includes(text), `"${text}" is in the default output`);
  }
  assert.ok(!before.includes('Template label'), 'template content is never converted');

  const { read } = await build({
    remove: ['button', 'svg', 'template', '[hidden]', '[aria-hidden="true"]', (el) => el.classList.contains('results')],
  });
  const body = parseFrontmatter(await read('index.md')).body;
  for (const text of ['×', 'Hidden paragraph', '⇅', 'Icon title', 'Distance']) {
    assert.ok(!body.includes(text), `"${text}" is removed`);
  }
  assert.ok(body.includes('Root intro.'));
});

test('selector: converts the matching element, falls back to <body> with a warning', async () => {
  const { read, logger } = await build({ selector: 'main' });
  const about = parseFrontmatter(await read('about.md'));
  assert.equal(about.body, '## About\n\nAbout text.');
  assert.equal(about.fields.title, 'About : Example');

  assert.ok(parseFrontmatter(await read('index.md')).body.includes('Root intro.'));
  assert.deepEqual(logger.messages.warn, [
    'No element matches "main" on /: converting <body>',
    'No element matches "main" on /en/: converting <body>',
    'No element matches "main" on /404/: converting <body>',
  ]);
});

test('cleanupFn still receives the markdown and the pathname', async () => {
  const calls = [];
  const { read } = await build({
    cleanupFn: (markdown, pathname) => {
      calls.push(pathname);
      return `${markdown}\n\n<!-- ${pathname} -->`;
    },
  });
  assert.deepEqual(calls, PAGES);
  assert.ok((await read('about.md')).endsWith('<!-- about/ -->'));
});

test('llms.txt is not generated by default', async () => {
  const { exists } = await build();
  assert.equal(await exists('llms.txt'), false);
});

test('llms.txt: title, summary, content, then the filtered pages', async () => {
  const { read, logger } = await build({
    llmsTxt: {
      title: 'Example',
      description: 'Routes in the sun or in the shade.',
      content: 'Deep links: `https://example.com/?from=<lat>,<lng>`.',
      pages: (pathname) => pathname.endsWith('about/'),
    },
  });
  assert.equal(
    await read('llms.txt'),
    [
      '# Example',
      '',
      '> Routes in the sun or in the shade.',
      '',
      'Deep links: `https://example.com/?from=<lat>,<lng>`.',
      '',
      '## Pages',
      '',
      '- [About : Example](https://example.com/about.md): What this site does.',
      '- [About \\[en\\]](https://example.com/en/about.md): Line one. Line two.',
      '',
    ].join('\n')
  );
  assert.ok(logger.messages.info.includes('Generated llms.txt (2 pages)'));
});

test('llms.txt: lists every generated page by default, sorted, without the excluded ones', async () => {
  const { read } = await build({ exclude: '404', llmsTxt: { title: 'Example' } });
  assert.equal(
    await read('llms.txt'),
    [
      '# Example',
      '',
      '## Pages',
      '',
      '- [Home: the #1 place](https://example.com/index.md): Sun or shade: pick your walk.',
      '- [About : Example](https://example.com/about.md): What this site does.',
      '- [Home (en)](https://example.com/en.md)',
      '- [About \\[en\\]](https://example.com/en/about.md): Line one. Line two.',
      '',
    ].join('\n')
  );
});

test('llms.txt: an existing file (from public/) is left untouched', async () => {
  const { read, logger } = await build(
    { llmsTxt: { title: 'Example' } },
    { setup: (dir) => fs.writeFile(path.join(dir, 'llms.txt'), 'hand-written\n') }
  );
  assert.equal(await read('llms.txt'), 'hand-written\n');
  assert.deepEqual(logger.messages.warn, ['llms.txt already exists in the output directory (from public/?): left untouched']);
});

test('dev: serves .md on whatever port the server got, with a query string', async (t) => {
  const integration = markDon({ exclude: /^en\/$/ });
  const logger = createLogger();
  await integration.hooks['astro:config:done']({ config: astroConfig(), logger });

  let middleware;
  await integration.hooks['astro:server:setup']({ server: { middlewares: { use: (fn) => (middleware = fn) } }, logger });

  // Stand-in for Astro: serves the fixture HTML for page URLs.
  const server = http.createServer((req, res) => {
    middleware(req, res, async () => {
      const { pathname } = new URL(req.url, 'http://localhost');
      try {
        const html = await fs.readFile(path.join(FIXTURE, pathname, 'index.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const about = await fetch(`${origin}/about.md?utm_source=llm`);
  assert.equal(about.status, 200);
  assert.equal(about.headers.get('content-type'), 'text/markdown; charset=utf-8');
  const { fields, body } = parseFrontmatter(await about.text());
  assert.equal(fields.source, 'https://example.com/about/');
  assert.ok(body.includes('About text.'));

  const root = await fetch(`${origin}/index.md`);
  assert.equal(parseFrontmatter(await root.text()).fields.title, 'Home: the #1 place');

  // Excluded: falls through to the next handler.
  assert.equal((await fetch(`${origin}/en.md`)).status, 404);
  assert.equal((await fetch(`${origin}/en/about.md`)).status, 200);
});

import TurndownService from 'turndown';
import fs from 'fs/promises';
import path from 'path';

function createTurndownService(turndownOptions) {
  const service = new TurndownService(turndownOptions);
  service.remove(['script', 'style', 'noscript']);
  return service;
}

function htmlToMarkdown(html, pagePath, turndownService, cleanupFn) {
  let markdown = turndownService.turndown(html);
  if (cleanupFn) {
    markdown = cleanupFn(markdown, pagePath);
  }
  const header = `---
source: ${pagePath}
generated: ${new Date().toISOString()}
note: This is a markdown version optimized for LLMs. For the full experience, visit the HTML version.
---

`;
  return header + markdown;
}

export default function astroMarkdownExport(options = {}) {
  const {
    exclude = [],
    turndownOptions = {
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    },
    cleanupFn = null
  } = options;

  return {
    name: 'astro-markdown-export',
    hooks: {
      // Dev: intercept *.md requests and convert HTML on-the-fly
      'astro:server:setup': ({ server }) => {
        const turndownService = createTurndownService(turndownOptions);

        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.endsWith('.md')) return next();

          const pagePath = req.url.replace(/\/index\.md$/, '/').replace(/^\//, '');

          if (exclude.some(pattern => pagePath.includes(pattern))) return next();

          try {
            // Fetch the HTML version from the dev server itself
            const htmlUrl = req.url.replace(/\/index\.md$/, '/').replace(/\.md$/, '');
            const base = `http://localhost:${server.config.server.port ?? 4321}`;
            const htmlRes = await fetch(base + (htmlUrl || '/'));
            if (!htmlRes.ok) return next();

            const html = await htmlRes.text();
            const markdown = htmlToMarkdown(html, pagePath, turndownService, cleanupFn);

            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.end(markdown);
          } catch {
            next();
          }
        });
      },

      // Build: write .md files next to each .html
      'astro:build:done': async ({ dir, pages }) => {
        console.log('📝 Generating markdown versions...');
        const turndownService = createTurndownService(turndownOptions);

        for (const page of pages) {
          const pagePath = page.pathname;

          if (exclude.some(pattern => pagePath.includes(pattern))) continue;

          try {
            let htmlFile = pagePath;
            if (pagePath === '' || pagePath.endsWith('/')) {
              htmlFile = pagePath + 'index.html';
            } else if (!pagePath.endsWith('.html')) {
              htmlFile = pagePath + '.html';
            }

            const htmlPath = path.join(dir.pathname, htmlFile);
            const html = await fs.readFile(htmlPath, 'utf-8');
            const markdown = htmlToMarkdown(html, pagePath, turndownService, cleanupFn);

            // Mirror the page path with a .md extension: /coucou -> /coucou.md
            // (the root stays /index.md). Keeps the markdown URL identical to the
            // page URL instead of the /coucou/index.md form.
            const normalizedPath = pagePath.replace(/\/$/, '');
            const mdFile = normalizedPath === '' ? 'index.md' : `${normalizedPath}.md`;
            const mdPath = path.join(dir.pathname, mdFile);

            await fs.mkdir(path.dirname(mdPath), { recursive: true });
            await fs.writeFile(mdPath, markdown, 'utf-8');
            console.log(`  ✓ Generated: ${mdPath.replace(dir.pathname, '')}`);
          } catch (error) {
            console.error(`  ✗ Error processing ${pagePath}:`, error.message);
          }
        }

        console.log('✨ Markdown export complete!');
      }
    }
  };
}

import TurndownService from 'turndown';
import fs from 'fs/promises';
import path from 'path';

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
      'astro:build:done': async ({ dir, pages }) => {
        console.log('📝 Generating markdown versions...');

        const turndownService = new TurndownService(turndownOptions);
        turndownService.remove(['script', 'style', 'noscript']);

        for (const page of pages) {
          const pagePath = page.pathname;

          if (exclude.some(pattern => pagePath.includes(pattern))) {
            continue;
          }

          try {
            let htmlFile = pagePath;
            if (pagePath === '' || pagePath.endsWith('/')) {
              htmlFile = pagePath + 'index.html';
            } else if (!pagePath.endsWith('.html')) {
              htmlFile = pagePath + '.html';
            }

            const htmlPath = path.join(dir.pathname, htmlFile);
            const html = await fs.readFile(htmlPath, 'utf-8');

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
            markdown = header + markdown;

            const mdPath = htmlPath.replace('.html', '.md');
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

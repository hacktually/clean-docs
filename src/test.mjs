import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const WATCH_PATH = process.env.WATCH_PATH || 'src';
const BEFORE_SHA = process.env.BEFORE_SHA;
const AFTER_SHA = process.env.AFTER_SHA;
const DOCS_DIR = 'docs';
const PROMPTS_DIR = 'prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Load style guidance once, reuse across every file in this run ---
function loadSystemPrompt() {
  const files = ['formatting.md', 'detail-level.md', 'audience.md'];
  const sections = files.map((f) => {
    const p = path.join(PROMPTS_DIR, f);
    if (!existsSync(p)) {
      console.warn(`Warning: prompt file ${p} not found, skipping.`);
      return '';
    }
    return readFileSync(p, 'utf-8').trim();
  }).filter(Boolean);

  return [
    'You are a technical documentation generator. Follow these guidelines exactly when producing markdown documentation.',
    '',
    ...sections,
  ].join('\n\n');
}

function getChangedFiles() {
  const before = /^0+$/.test(BEFORE_SHA) ? `${AFTER_SHA}~1` : BEFORE_SHA;

  let diffOutput;
  try {
    diffOutput = execSync(`git diff --name-only ${before} ${AFTER_SHA} -- ${WATCH_PATH}`)
      .toString()
      .trim();
  } catch {
    diffOutput = execSync(`git ls-tree -r --name-only ${AFTER_SHA} -- ${WATCH_PATH}`)
      .toString()
      .trim();
  }

  return diffOutput
    .split('\n')
    .filter(Boolean)
    .filter((f) => existsSync(f));
}

async function generateDocForFile(filePath, systemPrompt) {
  const content = readFileSync(filePath, 'utf-8');

  const userPrompt = `Generate documentation for the file "${filePath}".

Output ONLY the markdown content — no preamble, no meta-commentary, no "Here is the documentation" framing.

File content:
\`\`\`
${content}
\`\`\`
`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

function docPathFor(sourceFile) {
  const relative = path.relative(WATCH_PATH, sourceFile);
  const parsed = path.parse(relative);
  return path.join(DOCS_DIR, parsed.dir, `${parsed.name}.md`);
}

async function main() {
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log('No relevant files changed. Skipping doc generation.');
    return;
  }

  const systemPrompt = loadSystemPrompt();
  console.log(`Generating docs for ${changedFiles.length} file(s):`, changedFiles);

  const generatedPaths = [];

  for (const file of changedFiles) {
    try {
      console.log(`Processing ${file}...`);
      const markdown = await generateDocForFile(file, systemPrompt);
      const outPath = docPathFor(file);

      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, markdown, 'utf-8');
      generatedPaths.push(outPath);

      console.log(`  -> wrote ${outPath}`);
    } catch (err) {
      console.error(`Failed to generate docs for ${file}:`, err.message);
    }
  }

  updateIndex(generatedPaths);
}

function updateIndex(newPaths) {
  const indexPath = path.join(DOCS_DIR, 'README.md');
  mkdirSync(DOCS_DIR, { recursive: true });

  let existingLinks = new Set();
  if (existsSync(indexPath)) {
    const existing = readFileSync(indexPath, 'utf-8');
    const matches = [...existing.matchAll(/\[.*?\]\((.*?)\)/g)];
    matches.forEach((m) => existingLinks.add(m[1]));
  }

  newPaths.forEach((p) => {
    const relLink = path.relative(DOCS_DIR, p);
    existingLinks.add(relLink);
  });

  const sorted = [...existingLinks].sort();
  const lines = [
    '# Documentation',
    '',
    'Auto-generated documentation index.',
    '',
    ...sorted.map((link) => `- [${link}](${link})`),
    '',
  ];

  writeFileSync(indexPath, lines.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

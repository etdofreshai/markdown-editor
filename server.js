import express from 'express';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'markdown-editor.sqlite');
const DEFAULT_MODEL = process.env.CODEX_MODEL || process.env.OPENAI_MODEL || 'gpt-5.1-codex';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || undefined;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
`);

const defaultMarkdown = `# Markdown Editor\n\nStart writing in this ephemeral draft. Click **Create New File** to get a persistent SQLite-backed link with a session id in the URL.\n\n- Pretty markdown is the default.\n- Raw markdown is always one click away.\n- Prompt edits work before and after creating a file.\n`;

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
marked.setOptions({ gfm: true, breaks: true });
function renderMarkdown(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''));
}

const app = express();
app.use(express.json({ limit: '3mb' }));
app.use(express.static('public', { extensions: ['html'] }));

const getDoc = db.prepare('SELECT id, title, markdown, created_at, updated_at FROM documents WHERE id = ?');
const createDoc = db.prepare('INSERT INTO documents (id, title, markdown) VALUES (?, ?, ?)');
const saveDoc = db.prepare(`UPDATE documents SET title = ?, markdown = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
const addMsg = db.prepare('INSERT INTO messages (document_id, role, content) VALUES (?, ?, ?)');
const listMsgs = db.prepare('SELECT role, content, created_at FROM messages WHERE document_id = ? ORDER BY id DESC LIMIT ?');

app.get('/healthz', (_req, res) => res.json({ ok: true, db: DB_PATH }));
app.get('/api/ephemeral', (_req, res) => res.json({ id: null, title: 'Ephemeral Markdown', markdown: defaultMarkdown, html: renderMarkdown(defaultMarkdown), ephemeral: true }));
app.post('/api/document', (req, res) => {
  const id = crypto.randomBytes(9).toString('base64url');
  const title = String(req.body.title || 'Untitled Markdown').slice(0, 200);
  const markdown = String(req.body.markdown ?? defaultMarkdown);
  createDoc.run(id, title, markdown);
  const doc = getDoc.get(id);
  res.status(201).json({ ...doc, html: renderMarkdown(doc.markdown), url: `/d/${id}` });
});
app.get('/api/document/:id', (req, res) => {
  const doc = getDoc.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'document_not_found' });
  res.json({ ...doc, html: renderMarkdown(doc.markdown) });
});
app.put('/api/document/:id', (req, res) => {
  const existing = getDoc.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'document_not_found' });
  const title = String(req.body.title || existing.title || 'Untitled Markdown').slice(0, 200);
  const markdown = String(req.body.markdown ?? '');
  saveDoc.run(title, markdown, req.params.id);
  const doc = getDoc.get(req.params.id);
  res.json({ ...doc, html: renderMarkdown(doc.markdown) });
});
app.post('/api/render', (req, res) => res.json({ html: renderMarkdown(String(req.body.markdown || '')) }));
app.get('/api/document/:id/messages', (req, res) => res.json({ messages: listMsgs.all(req.params.id, Number(req.query.limit || 30)).reverse() }));

function extractMarkdown(text) {
  const fence = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

async function editMarkdownWithPrompt(markdown, prompt) {
  if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
    const err = new Error('Set OPENAI_API_KEY or CODEX_API_KEY in Dokploy env to enable prompt editing.');
    err.status = 501;
    err.code = 'ai_not_configured';
    throw err;
  }
  const client = new OpenAI({ apiKey: process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });
  const system = 'You are an expert markdown editor embedded in a web app. Apply the user request to the provided markdown document. Return ONLY the complete updated markdown document. Do not explain. Preserve intent and formatting unless asked to change it.';
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Current markdown document:\n\n${markdown}\n\nUser request:\n${prompt}\n\nReturn the full updated markdown only.` }
    ]
  });
  return extractMarkdown(completion.choices?.[0]?.message?.content || markdown);
}

app.post('/api/prompt', async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt_required' });
  const markdown = String(req.body.markdown ?? '');
  try {
    const updated = await editMarkdownWithPrompt(markdown, prompt);
    res.json({ title: String(req.body.title || 'Ephemeral Markdown').slice(0, 200), markdown: updated, html: renderMarkdown(updated), message: 'Updated the draft.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.code, message: err.message });
    throw err;
  }
});

app.post('/api/document/:id/prompt', async (req, res) => {
  const doc = getDoc.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'document_not_found' });
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt_required' });
  addMsg.run(doc.id, 'user', prompt);
  try {
    const updated = await editMarkdownWithPrompt(doc.markdown, prompt);
    saveDoc.run(doc.title, updated, doc.id);
    addMsg.run(doc.id, 'assistant', 'Updated the document.');
    const next = getDoc.get(doc.id);
    res.json({ ...next, html: renderMarkdown(next.markdown), message: 'Updated the document.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.code, message: err.message });
    throw err;
  }
});

app.get('/d/:id', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', message: err.message });
});
app.listen(PORT, '0.0.0.0', () => console.log(`markdown-editor listening on ${PORT}, db=${DB_PATH}`));

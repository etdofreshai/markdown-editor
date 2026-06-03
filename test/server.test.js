import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('server persists markdown and renders html', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-'));
  const port = 3900 + Math.floor(Math.random()*1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'db.sqlite') }, stdio: ['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now()+8000;
      const tick = async () => {
        try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return resolve(); } catch {}
        if (Date.now()>deadline) return reject(new Error('server timeout'));
        setTimeout(tick, 100);
      }; tick();
    });
    let r = await fetch(`http://127.0.0.1:${port}/api/document/default`);
    assert.equal(r.status, 200);
    let doc = await r.json();
    assert.match(doc.markdown, /Markdown Editor/);
    r = await fetch(`http://127.0.0.1:${port}/api/document/default`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({ title:'Test', markdown:'# Hello\n\n**world**' }) });
    assert.equal(r.status, 200);
    doc = await r.json();
    assert.match(doc.html, /<strong>world<\/strong>/);
    assert.ok(fs.existsSync(path.join(dir, 'db.sqlite')));
  } finally {
    child.kill('SIGTERM');
  }
});

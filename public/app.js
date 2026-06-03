let docId = location.pathname.startsWith('/d/') ? decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '') : null;
const $ = (id) => document.getElementById(id);
const title = $('title'), status = $('status'), pretty = $('prettyEditor'), raw = $('rawEditor'), chat = $('chatLog'), prompt = $('prompt'), createFileBtn = $('createFileBtn'), styleSelect = $('styleSelect');
let markdown = '', saveTimer = null, mode = 'pretty', suppress = false;
let undoStack = [], redoStack = [], lastKnownState = null;
let pageScrollBeforeEdit = 0;
const HISTORY_LIMIT = 200;
const STYLE_KEY = 'markdown-editor-style';
function applyStyle(style){
  document.body.dataset.style = style;
  styleSelect.value = style;
  localStorage.setItem(STYLE_KEY, style);
}
applyStyle(localStorage.getItem(STYLE_KEY) || 'aurora');

function currentState(){ return { title: title.value, markdown }; }
function sameState(a,b){ return a?.title === b?.title && a?.markdown === b?.markdown; }
function pushUndo(state = currentState()){
  const last = undoStack[undoStack.length - 1];
  if (sameState(last, state)) return;
  undoStack.push({ ...state });
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}
function noteChanged(){ const next = currentState(); if (lastKnownState && !sameState(lastKnownState, next)) pushUndo(lastKnownState); lastKnownState = { ...next }; }
function isPersistent(){ return Boolean(docId); }
function updateCreateButton(){ createFileBtn.textContent = isPersistent() ? 'Persistent File' : 'Create New File'; createFileBtn.disabled = isPersistent(); }
function rememberPageScroll(){ pageScrollBeforeEdit = window.scrollY || document.documentElement.scrollTop || 0; }
function restorePageScroll(){
  const current = window.scrollY || document.documentElement.scrollTop || 0;
  if (Math.abs(current - pageScrollBeforeEdit) > 2) window.scrollTo(0, pageScrollBeforeEdit);
}

function htmlToMarkdown(root){
  const walk = (node, ctx = {}) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const childText = (nextCtx = ctx) => [...node.childNodes].map(child => walk(child, nextCtx)).join('');
    if (tag === 'h1') return `# ${childText().trim()}\n\n`;
    if (tag === 'h2') return `## ${childText().trim()}\n\n`;
    if (tag === 'h3') return `### ${childText().trim()}\n\n`;
    if (tag === 'p' || tag === 'div') return `${childText().trim()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${childText()}**`;
    if (tag === 'em' || tag === 'i') return `*${childText()}*`;
    if (tag === 'code') return node.parentElement?.tagName.toLowerCase()==='pre' ? childText() : `\`${childText()}\``;
    if (tag === 'pre') return `\n\`\`\`\n${childText().trim()}\n\`\`\`\n\n`;
    if (tag === 'li') {
      const marker = ctx.ordered ? `${ctx.index ?? 1}. ` : '- ';
      return `${marker}${childText().trim().replace(/\n{2,}/g, '\n')}\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      return [...node.children].map((child, i) => walk(child, { ordered: tag === 'ol', index: i + 1 })).join('') + '\n';
    }
    if (tag === 'a') return `[${childText()}](${node.getAttribute('href') || ''})`;
    return childText();
  };
  return [...root.childNodes].map(node => walk(node)).join('').replace(/\n{3,}/g,'\n\n').trim() + '\n';
}
function selectionToMarkdown(){
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return markdown;
  const range = selection.getRangeAt(0);
  if (!pretty.contains(range.commonAncestorContainer)) return null;
  const fragment = range.cloneContents();
  const container = document.createElement('div');
  container.appendChild(fragment);
  return htmlToMarkdown(container);
}
function prettySelectionMarkdownOffset(){
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!pretty.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.setStart(pretty, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const container = document.createElement('div');
  container.appendChild(before.cloneContents());
  return Math.min(htmlToMarkdown(container).length, markdown.length);
}
function focusRawAtOffset(offset){
  if (typeof offset !== 'number') return;
  const safeOffset = Math.max(0, Math.min(offset, raw.value.length));
  raw.focus({ preventScroll: true });
  raw.setSelectionRange(safeOffset, safeOffset);
  const before = raw.value.slice(0, safeOffset);
  const line = before.split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(raw).lineHeight) || 22;
  const targetTop = Math.max(0, line * lineHeight - raw.clientHeight / 2);
  raw.scrollTop = targetTop;
}
async function api(path, opts={}){ const r = await fetch(path, {headers:{'content-type':'application/json'}, ...opts}); if(!r.ok) throw await r.json().catch(()=>({error:r.statusText})); return r.json(); }
async function render(md){ const r = await api('/api/render',{method:'POST', body:JSON.stringify({markdown:md})}); return r.html; }
function setStatus(t){ status.textContent = isPersistent() ? t : `${t} · Ephemeral draft`; }
async function setMarkdown(md, html, { updatePretty = true } = {}){ markdown = md; raw.value = md; if (updatePretty && mode === 'pretty') pretty.innerHTML = html ?? await render(md); }
function scheduleSave(){ clearTimeout(saveTimer); if(!isPersistent()){ setStatus('Not saved yet'); return; } setStatus('Unsaved changes…'); saveTimer=setTimeout(saveNow, 600); }
async function saveNow(){
  if(suppress || !isPersistent()) return;
  try{
    const d=await api(`/api/document/${docId}`,{method:'PUT', body:JSON.stringify({title:title.value, markdown})});
    title.value = d.title; markdown = d.markdown; raw.value = d.markdown;
    if (mode !== 'pretty') pretty.innerHTML = d.html;
    setStatus('Saved');
  }catch(e){ setStatus(`Save failed: ${e.message||e.error}`); }
}
async function applyState(state, { save = true } = {}){ suppress = true; title.value = state.title; suppress = false; await setMarkdown(state.markdown, undefined, { updatePretty: true }); lastKnownState = { ...state }; if (save) scheduleSave(); }
function undo(){ const prev = undoStack.pop(); if (!prev) return; redoStack.push(currentState()); applyState(prev); setStatus(isPersistent() ? 'Undone — saving…' : 'Undone'); }
function redo(){ const next = redoStack.pop(); if (!next) return; undoStack.push(currentState()); applyState(next); setStatus(isPersistent() ? 'Redone — saving…' : 'Redone'); }
function switchMode(next){
  if (mode === next) return;
  const rawOffset = mode === 'pretty' && next === 'raw' ? prettySelectionMarkdownOffset() : null;
  if(mode === 'pretty') markdown = htmlToMarkdown(pretty); else markdown = raw.value;
  mode = next;
  $('prettyPane').classList.toggle('hidden', mode!=='pretty');
  $('rawPane').classList.toggle('hidden', mode!=='raw');
  $('prettyBtn').classList.toggle('active', mode==='pretty');
  $('rawBtn').classList.toggle('active', mode==='raw');
  setMarkdown(markdown).then(() => {
    if (mode === 'raw' && rawOffset !== null) requestAnimationFrame(() => focusRawAtOffset(rawOffset));
  });
}

async function createPersistentFile(){
  if (mode === 'pretty') markdown = htmlToMarkdown(pretty); else markdown = raw.value;
  setStatus('Creating file…');
  const d = await api('/api/document', { method:'POST', body: JSON.stringify({ title:title.value, markdown }) });
  docId = d.id;
  history.pushState({}, '', d.url);
  await setMarkdown(d.markdown, d.html);
  title.value = d.title;
  lastKnownState = currentState();
  updateCreateButton();
  setStatus('Saved');
}

pretty.addEventListener('focusin', ()=>{ if(!suppress && mode==='pretty') pushUndo(); });
raw.addEventListener('focusin', ()=>{ if(!suppress && mode==='raw') pushUndo(); });
title.addEventListener('focusin', ()=>{ if(!suppress) pushUndo(); });
pretty.addEventListener('beforeinput', (e)=>{ rememberPageScroll(); if(!suppress && e.inputType?.startsWith('history')) e.preventDefault(); else if(!suppress && mode==='pretty') pushUndo(); });
raw.addEventListener('beforeinput', (e)=>{ rememberPageScroll(); if(!suppress && e.inputType?.startsWith('history')) e.preventDefault(); else if(!suppress && mode==='raw') pushUndo(); });
title.addEventListener('beforeinput', ()=>{ rememberPageScroll(); if(!suppress) pushUndo(); });
pretty.addEventListener('input',()=>{ if(mode==='pretty'){ markdown = htmlToMarkdown(pretty); raw.value = markdown; noteChanged(); scheduleSave(); requestAnimationFrame(restorePageScroll); }});
pretty.addEventListener('copy', (e)=>{
  const copiedMarkdown = selectionToMarkdown();
  if (copiedMarkdown === null) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', copiedMarkdown);
  e.clipboardData.setData('text/markdown', copiedMarkdown);
});
raw.addEventListener('input',()=>{ markdown=raw.value; noteChanged(); scheduleSave(); requestAnimationFrame(restorePageScroll); });
title.addEventListener('input', ()=>{ noteChanged(); scheduleSave(); requestAnimationFrame(restorePageScroll); });
document.addEventListener('keydown', (e)=>{ const mod = e.metaKey || e.ctrlKey; if (!mod || e.altKey) return; const key = e.key.toLowerCase(); if (key === 'z' && !e.shiftKey){ e.preventDefault(); undo(); } if ((key === 'z' && e.shiftKey) || key === 'y'){ e.preventDefault(); redo(); } });
$('prettyBtn').onclick=()=>switchMode('pretty'); $('rawBtn').onclick=()=>switchMode('raw');
styleSelect.addEventListener('change', () => applyStyle(styleSelect.value));
createFileBtn.onclick=()=>createPersistentFile().catch(e=>setStatus(`Create failed: ${e.message||e.error}`));
$('promptBar').addEventListener('submit', async (e)=>{ e.preventDefault(); const text=prompt.value.trim(); if(!text) return; pushUndo(); prompt.value=''; chat.innerHTML = `<b>You:</b> ${text}<br><b>AI:</b> editing…`; setStatus('AI editing…'); try{ const endpoint = isPersistent() ? `/api/document/${docId}/prompt` : '/api/prompt'; const body = isPersistent() ? {prompt:text} : {prompt:text,title:title.value,markdown}; const d=await api(endpoint,{method:'POST', body:JSON.stringify(body)}); suppress=true; title.value=d.title; suppress=false; await setMarkdown(d.markdown,d.html); lastKnownState = currentState(); chat.innerHTML = `<b>You:</b> ${text}<br><b>AI:</b> ${d.message}`; setStatus(isPersistent() ? 'Saved' : 'Updated draft'); }catch(e){ undoStack.pop(); chat.innerHTML = `<b>Prompt failed:</b> ${e.message||e.error}`; setStatus('Prompt failed'); }});
prompt.addEventListener('keydown', e=>{ if(e.key==='Enter' && (e.metaKey||e.ctrlKey)) $('promptBar').requestSubmit(); });

const d = await api(isPersistent() ? `/api/document/${docId}` : '/api/ephemeral'); title.value=d.title; await setMarkdown(d.markdown,d.html); lastKnownState = currentState(); updateCreateButton(); setStatus(isPersistent() ? 'Saved' : 'Ready');

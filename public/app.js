const docId = 'default';
const $ = (id) => document.getElementById(id);
const title = $('title'), status = $('status'), pretty = $('prettyEditor'), raw = $('rawEditor'), chat = $('chatLog'), prompt = $('prompt');
let markdown = '', saveTimer = null, mode = 'pretty', suppress = false;

function htmlToMarkdown(root){
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const c = [...node.childNodes].map(walk).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'h1') return `# ${c.trim()}\n\n`;
    if (tag === 'h2') return `## ${c.trim()}\n\n`;
    if (tag === 'h3') return `### ${c.trim()}\n\n`;
    if (tag === 'p' || tag === 'div') return `${c.trim()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${c}**`;
    if (tag === 'em' || tag === 'i') return `*${c}*`;
    if (tag === 'code') return node.parentElement?.tagName.toLowerCase()==='pre' ? c : `\`${c}\``;
    if (tag === 'pre') return `\n\`\`\`\n${c.trim()}\n\`\`\`\n\n`;
    if (tag === 'li') return `- ${c.trim()}\n`;
    if (tag === 'ul' || tag === 'ol') return `${c}\n`;
    if (tag === 'a') return `[${c}](${node.getAttribute('href') || ''})`;
    return c;
  };
  return [...root.childNodes].map(walk).join('').replace(/\n{3,}/g,'\n\n').trim() + '\n';
}
async function api(path, opts={}){ const r = await fetch(path, {headers:{'content-type':'application/json'}, ...opts}); if(!r.ok) throw await r.json().catch(()=>({error:r.statusText})); return r.json(); }
async function render(md){ const r = await api('/api/render',{method:'POST', body:JSON.stringify({markdown:md})}); return r.html; }
function setStatus(t){ status.textContent = t; }
async function setMarkdown(md, html){ markdown = md; raw.value = md; if (mode === 'pretty') pretty.innerHTML = html ?? await render(md); }
function scheduleSave(){ clearTimeout(saveTimer); setStatus('Unsaved changes…'); saveTimer=setTimeout(saveNow, 600); }
async function saveNow(){ if(suppress) return; try{ const d=await api(`/api/document/${docId}`,{method:'PUT', body:JSON.stringify({title:title.value, markdown})}); await setMarkdown(d.markdown, d.html); setStatus('Saved'); }catch(e){ setStatus(`Save failed: ${e.message||e.error}`); }}
function switchMode(next){ if(mode === 'pretty') markdown = htmlToMarkdown(pretty); else markdown = raw.value; mode = next; $('prettyPane').classList.toggle('hidden', mode!=='pretty'); $('rawPane').classList.toggle('hidden', mode!=='raw'); $('prettyBtn').classList.toggle('active', mode==='pretty'); $('rawBtn').classList.toggle('active', mode==='raw'); setMarkdown(markdown); }

pretty.addEventListener('input',()=>{ if(mode==='pretty'){ markdown = htmlToMarkdown(pretty); raw.value = markdown; scheduleSave(); }});
raw.addEventListener('input',()=>{ markdown=raw.value; scheduleSave(); });
title.addEventListener('input', scheduleSave);
$('prettyBtn').onclick=()=>switchMode('pretty'); $('rawBtn').onclick=()=>switchMode('raw');
$('promptBar').addEventListener('submit', async (e)=>{ e.preventDefault(); const text=prompt.value.trim(); if(!text) return; prompt.value=''; chat.innerHTML = `<b>You:</b> ${text}<br><b>Codex:</b> editing…`; setStatus('Codex editing…'); try{ const d=await api(`/api/document/${docId}/prompt`,{method:'POST', body:JSON.stringify({prompt:text})}); suppress=true; title.value=d.title; suppress=false; await setMarkdown(d.markdown,d.html); chat.innerHTML = `<b>You:</b> ${text}<br><b>Codex:</b> ${d.message}`; setStatus('Saved'); }catch(e){ chat.innerHTML = `<b>Prompt failed:</b> ${e.message||e.error}`; setStatus('Prompt failed'); }});
prompt.addEventListener('keydown', e=>{ if(e.key==='Enter' && (e.metaKey||e.ctrlKey)) $('promptBar').requestSubmit(); });

const d = await api(`/api/document/${docId}`); title.value=d.title; await setMarkdown(d.markdown,d.html); setStatus('Saved');

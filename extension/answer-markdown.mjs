/*
 * Copyright 2026 Lara Srinath
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// A deliberately small Markdown renderer for business answers. All content is
// built as text nodes: raw HTML, images and executable URLs are never rendered.
function inline(document, parent, text, depth = 0) {
  if (depth > 4) { parent.append(document.createTextNode(text)); return; }
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const token = match[0];
    let node;
    if (token.startsWith('`')) { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (token.startsWith('[')) {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      let url; try { url = new URL(parts[2]); } catch {}
      if (url && ['https:', 'http:'].includes(url.protocol)) {
        node = document.createElement('a'); node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.textContent = parts[1];
      } else { node = document.createTextNode(token); }
    } else {
      const strong = token.startsWith('**') || token.startsWith('__');
      node = document.createElement(strong ? 'strong' : 'em');
      inline(document, node, token.slice(strong ? 2 : 1, strong ? -2 : -1), depth + 1);
    }
    parent.append(node); end = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
const listItem = line => line.match(/^\s{0,3}([-*+] |\d+[.)] )(.+)$/);
const tableStart = (lines, index) => lines[index]?.includes('|') && lines[index + 1]?.includes('|') && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell));
const blockStart = (lines, index) => /^(#{1,6}\s|```|>\s|\s*$)/.test(lines[index]) || listItem(lines[index]) || tableStart(lines, index);

export function renderAnswer(document, text) {
  const result = document.createDocumentFragment(), lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith('```')) {
      const code = document.createElement('code'), pre = document.createElement('pre'), contents = [];
      index++; while (index < lines.length && !lines[index].startsWith('```')) contents.push(lines[index++]);
      if (index < lines.length) index++;
      code.textContent = contents.join('\n'); pre.append(code); result.append(pre); continue;
    }
    if (tableStart(lines, index)) {
      const wrapper = document.createElement('div'); wrapper.className = 'answer-table'; wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Answer table');
      const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody'), row = document.createElement('tr');
      for (const label of cells(line)) { const cell = document.createElement('th'); cell.scope = 'col'; inline(document, cell, label); row.append(cell); }
      head.append(row); index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = document.createElement('tr');
        for (const label of cells(lines[index++])) { const cell = document.createElement('td'); inline(document, cell, label); row.append(cell); }
        body.append(row);
      }
      table.append(head, body); wrapper.append(table); result.append(wrapper); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const node = document.createElement(`h${Math.min(6, heading[1].length + 2)}`); inline(document, node, heading[2]); result.append(node); index++; continue; }
    const item = listItem(line);
    if (item) {
      const ordered = /^\d/.test(item[1]), list = document.createElement(ordered ? 'ol' : 'ul');
      if (ordered) list.start = Number.parseInt(item[1], 10);
      let next;
      while (index < lines.length && (next = listItem(lines[index])) && /^\d/.test(next[1]) === ordered) {
        const node = document.createElement('li'); inline(document, node, next[2]); list.append(node); index++;
      }
      result.append(list); continue;
    }
    if (line.startsWith('> ')) {
      const quote = document.createElement('blockquote'), content = [];
      while (index < lines.length && lines[index].startsWith('> ')) content.push(lines[index++].slice(2));
      inline(document, quote, content.join('\n')); result.append(quote); continue;
    }
    const paragraph = document.createElement('p'), content = [line]; index++;
    while (index < lines.length && !blockStart(lines, index)) content.push(lines[index++]);
    inline(document, paragraph, content.join('\n')); result.append(paragraph);
  }
  return result;
}

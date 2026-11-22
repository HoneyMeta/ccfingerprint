// Self-contained, shareable HTML rendering of the Markdown that ccfp writes (verdicts, comparisons,
// history). It only has to understand the small Markdown subset ccfp itself produces: headings,
// tables, bullet lists, block quotes, fenced code and **bold** / `code` inline.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(body.join('\n'))}</pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line) && /^\|[\s|:-]+\|?\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<div class="table"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^> ?/.test(line)) {
      const body = [];
      while (i < lines.length && /^> ?/.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |> |```)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const LEVEL_TEXT = {
  trustworthy: '可信 · trustworthy',
  questionable: '存疑 · questionable',
  untrustworthy: '不可信 · not trustworthy'
};

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b6862;--line:#e3e0d8;--card:#ffffff;--code:#f2efe8;
--ok:#1f7a4d;--ok-bg:#e3f3ea;--warn:#8a5a00;--warn-bg:#fbefd5;--bad:#a32121;--bad-bg:#f9e1e1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171614;--fg:#ece9e2;--muted:#a19d94;--line:#34322d;
--card:#201f1c;--code:#2a2925;--ok:#6fd39f;--ok-bg:#16301f;--warn:#f0c060;--warn-bg:#3a2d10;--bad:#f08a8a;--bad-bg:#3d1a1a}}
:root[data-theme="dark"]{--bg:#171614;--fg:#ece9e2;--muted:#a19d94;--line:#34322d;--card:#201f1c;--code:#2a2925;
--ok:#6fd39f;--ok-bg:#16301f;--warn:#f0c060;--warn-bg:#3a2d10;--bad:#f08a8a;--bad-bg:#3d1a1a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 16px 48px}
h1{font-size:1.55rem;margin:0 0 12px}h2{font-size:1.15rem;margin:28px 0 10px;padding-top:12px;border-top:1px solid var(--line)}
blockquote{margin:0 0 16px;color:var(--muted);font-size:.9rem}
.table{overflow-x:auto;margin:8px 0 12px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);background:var(--code)}tr:last-child td{border-bottom:0}
code,pre{font-family:ui-monospace,Consolas,monospace;background:var(--code);border-radius:4px}
code{padding:1px 4px}pre{padding:10px 12px;overflow-x:auto}
ul{padding-left:20px}li{margin:4px 0}
.badge{display:inline-flex;gap:10px;align-items:baseline;padding:8px 14px;border-radius:999px;font-weight:600;margin:4px 0 14px}
.badge b{font-size:1.4rem}
.trustworthy{color:var(--ok);background:var(--ok-bg)}.questionable{color:var(--warn);background:var(--warn-bg)}
.untrustworthy{color:var(--bad);background:var(--bad-bg)}
footer{margin-top:32px;color:var(--muted);font-size:.85rem}
footer a{color:inherit}
`;

// `badge`: optional { level, confidence } shown under the title.
export function renderHtml(md, { title = 'ccfingerprint report', badge, generatedAt = new Date().toISOString() } = {}) {
  let body = markdownToHtml(md);
  if (badge && LEVEL_TEXT[badge.level]) {
    const pill = `<div class="badge ${badge.level}"><b>${esc(badge.confidence)}/100</b><span>${esc(LEVEL_TEXT[badge.level])}</span></div>`;
    body = body.replace(/(<\/h1>)/, `$1\n${pill}`);
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
<footer>ccfingerprint · ${esc(generatedAt)} · <a href="https://github.com/HoneyMeta/ccfingerprint">github.com/HoneyMeta/ccfingerprint</a> · 本报告由本地确定性评分生成 / scored locally, deterministically</footer>
</main>
</body>
</html>
`;
}

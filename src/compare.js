import fs from 'fs';
import path from 'path';
import { loadDataset } from './init.js';
import { verifyReport, verdictJson, readJsonFile } from './verify.js';

// `ccfp compare`: score several reports (e.g. one per relay) and put them side by side.

function name(file, report) {
  if (report.api?.endpoint) {
    try {
      return `${new URL(report.api.endpoint).host} · ${report.api.model}`;
    } catch { /* fall through */ }
  }
  return path.basename(file);
}

export function compareReports(entries, dataset, { baseline } = {}) {
  const rows = entries.map(({ file, report }) => {
    const v = verifyReport(report, dataset, { baseline });
    return {
      name: name(file, report),
      file,
      verdict: v,
      canary: v.api?.canaryTokens ?? null,
      protocol: report.api?.protocol || null
    };
  });
  // endpoints on the same protocol that report the same canary token count probably share a tokenizer
  const groups = new Map();
  for (const r of rows) {
    if (r.canary == null) continue;
    const key = `${r.protocol}:${r.canary}`;
    groups.set(key, [...(groups.get(key) || []), r.name]);
  }
  return { rows, tokenGroups: [...groups.entries()].map(([key, names]) => ({ key, names })) };
}

export function renderCompare(result, dataset) {
  const lines = [];
  lines.push('# 多端点对比 / Endpoint comparison');
  lines.push('');
  lines.push(`> dataset ${dataset.version} · 每行都由本地确定性评分得出 / every row is scored locally`);
  lines.push('');
  lines.push('| 端点 / endpoint | 自称 / claims | 返回 model / returned | 能力 / capability | 推断截止 / cutoff | canary tokens | 可信度 / score | 结论 / verdict | 疑点 / flags |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of result.rows) {
    const v = r.verdict;
    const returned = v.api ? v.api.returnedModels.map((m) => m.value).join(', ') || '-' : '-';
    lines.push(`| ${r.name} | ${v.claimed?.model_id || '-'} | ${returned} | ${Math.round(v.capRatio * 100)}% | ${v.cutoff.latestKnown || '-'} | ${r.canary ?? '-'} | ${v.confidence} | ${v.conclusion} | ${v.flags.length} |`);
  }
  lines.push('');
  const shared = result.tokenGroups.filter((g) => g.names.length > 1);
  if (shared.length) {
    lines.push('相同协议下 canary 输入 token 数相同的端点（分词器可能相同）/ endpoints with the same canary prompt-token count (likely the same tokenizer):');
    for (const g of shared) lines.push(`- ${g.key.split(':')[1]} tokens: ${g.names.join(', ')}`);
    lines.push('');
  }
  for (const r of result.rows) {
    if (!r.verdict.flags.length) continue;
    lines.push(`## ${r.name}`);
    for (const f of r.verdict.flags) lines.push(`- ${f}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function compare(files, options = {}) {
  const lang = options.lang || 'zh';
  if (!files || files.length < 1) {
    console.error(lang === 'en' ? 'Error: give at least one report file' : '错误: 至少提供一个报告文件');
    process.exit(1);
  }
  const dataset = loadDataset();
  const baseline = options.baseline ? readJsonFile(options.baseline, lang) : null;
  const entries = files.map((file) => ({ file, report: readJsonFile(file, lang) }));
  const result = compareReports(entries, dataset, { baseline });
  const md = renderCompare(result, dataset);
  const outPath = options.output || 'ccfp-compare.md';
  fs.writeFileSync(outPath, md, 'utf-8');
  if (options.json) {
    console.log(JSON.stringify({
      tool: 'ccfingerprint',
      dataset: dataset.version,
      endpoints: result.rows.map((r) => ({ name: r.name, file: r.file, ...verdictJson(r.verdict, dataset) })),
      token_groups: result.tokenGroups
    }, null, 2));
  } else {
    console.log(md);
    console.log('\n' + (lang === 'en' ? `Saved comparison to ${outPath}` : `已保存对比报告: ${outPath}`));
  }
  const threshold = options.failUnder == null ? NaN : Number(options.failUnder);
  if (Number.isFinite(threshold) && result.rows.some((r) => r.verdict.confidence < threshold)) process.exitCode = 2;
  return result;
}

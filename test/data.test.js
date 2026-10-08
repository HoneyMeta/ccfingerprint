import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadDataset, buildPrompt, SUPPORTED_AI } from '../src/init.js';
import { monthValue } from '../src/verify.js';

const dataset = loadDataset();

describe('dataset integrity', () => {
  it('has all probe categories populated', () => {
    for (const cat of ['self_declare', 'knowledge', 'capability', 'behavior', 'identities']) {
      assert.ok(Array.isArray(dataset[cat]) && dataset[cat].length > 0, `missing ${cat}`);
    }
  });

  it('every probe has an id and bilingual prompts', () => {
    const all = [...dataset.self_declare, ...dataset.knowledge, ...dataset.capability, ...dataset.behavior];
    for (const q of all) {
      assert.ok(q.id, 'probe missing id');
      assert.ok(q.prompt_zh, `${q.id} missing prompt_zh`);
      assert.ok(q.prompt_en, `${q.id} missing prompt_en`);
    }
  });

  it('probe ids are unique', () => {
    const ids = [...dataset.knowledge, ...dataset.capability, ...dataset.behavior].map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate probe ids');
  });

  it('knowledge probes carry a date anchor and a check spec, sorted by date', () => {
    for (const q of dataset.knowledge) {
      assert.ok(/^\d{4}-\d{2}$/.test(q.date), `${q.id} bad date`);
      assert.ok(q.check, `${q.id} missing check`);
      if (q.check.month) assert.strictEqual(q.check.month, q.date, `${q.id}: month check should equal its date`);
    }
    const dates = dataset.knowledge.map((q) => q.date);
    assert.deepStrictEqual(dates, [...dates].sort());
  });

  it('capability probes carry tier, weight and a checkable answer key', () => {
    for (const q of dataset.capability) {
      assert.ok(Number.isInteger(q.tier), `${q.id} missing tier`);
      assert.ok(q.weight > 0, `${q.id} missing weight`);
      assert.ok(q.check, `${q.id} missing check`);
    }
  });

  it('identity patterns compile and carry release/cutoff months', () => {
    for (const it of dataset.identities) {
      assert.doesNotThrow(() => new RegExp(it.pattern, 'i'), it.label);
      assert.ok(monthValue(it.released) != null, `${it.label} released`);
      if (it.cutoff) assert.ok(monthValue(it.cutoff) <= monthValue(it.released), `${it.label} cutoff after release`);
    }
  });

  it('the generated prompt never leaks answer keys', () => {
    // capability `any` lists are the answer options the prompt itself offers (knight/knave), so only
    // knowledge keywords, longer exact answers and multi-digit numbers count as secrets
    const secrets = [];
    for (const q of dataset.knowledge) {
      for (const k of q.check.any || []) if (k.length >= 4) secrets.push(k);
    }
    for (const q of dataset.capability) {
      const c = q.check;
      if (c.numeric !== undefined && String(c.numeric).length >= 3) secrets.push(String(c.numeric));
      if (c.exact && c.exact.length >= 5) secrets.push(c.exact);
    }
    secrets.push('identities', 'opus[');
    for (const ai of SUPPORTED_AI) {
      for (const lang of ['zh', 'en']) {
        const prompt = buildPrompt(ai, lang, dataset);
        for (const s of secrets) assert.ok(!prompt.includes(s), `${ai}/${lang} prompt leaks "${s}"`);
      }
    }
  });
});

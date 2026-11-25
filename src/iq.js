import fs from 'fs';
import path from 'path';
import { endpointUrl, callModel, probeParams } from './probe.js';
import { readHistory } from './history.js';
import { renderHtml } from './html.js';

// `ccfp iq`: is the model behind this endpoint as capable as it should be right now?
// "降智" (silent downgrade) usually means one of: a smaller model served under the same name,
// reasoning effort turned down (or off), the prompt silently truncated, or the output capped.
// Each has its own measurable signal:
//   1. freshly generated reasoning tasks at three difficulty levels (new numbers every run, so they
//      cannot be memorised or answered from a relay's response cache), graded exactly;
//   2. the reasoning-token count the API reports for the hard tasks (reasoning models only);
//   3. a needle-in-a-haystack prompt of a known size (front / middle / end) + the prompt-token count;
//   4. optionally, a long output that must not be cut short;
//   5. output speed, compared with an official baseline.
// Strongest when compared with the official API (same seed) or with the endpoint's own history.

export const IQ_VERSION = 1;

// ---------- deterministic generators ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const digits = (r, n) => String(randInt(r, 1, 9)) + Array.from({ length: n - 1 }, () => randInt(r, 0, 9)).join('');
function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomSeed() {
  return randInt(Math.random, 1, 2 ** 31 - 2);
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const DAY_MS = 86400000;
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function modPow(base, exp, mod) {
  let result = 1n;
  let b = BigInt(base) % BigInt(mod);
  let e = BigInt(exp);
  const m = BigInt(mod);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'so', 'ta', 'vi', 'ze', 'po', 'qu', 'da', 'fe', 'gi', 'ho', 'bu', 'xe', 'wo', 'ly', 'ce'];
function pseudoWords(r, n, { minSyl = 1, maxSyl = 4 } = {}) {
  const set = new Set();
  while (set.size < n) set.add(Array.from({ length: randInt(r, minSyl, maxSyl) }, () => pick(r, SYLLABLES)).join(''));
  return [...set];
}

const NAMES = ['Ann', 'Ben', 'Cyd', 'Dee', 'Eli', 'Fay'];

// Each generator: (r, level) -> { zh, en, answer, grade } where `answer` is the canonical answer string.
const GENERATORS = {
  mul: {
    levels: [1, 2, 3],
    gen(r, level) {
      const [da, db] = { 1: [3, 3], 2: [5, 4], 3: [9, 8] }[level];
      const a = digits(r, da);
      const b = digits(r, db);
      const answer = (BigInt(a) * BigInt(b)).toString();
      return { zh: `计算 ${a} × ${b} 的精确值。`, en: `Compute the exact value of ${a} × ${b}.`, answer, grade: 'int' };
    }
  },
  letters: {
    levels: [1, 2, 3],
    gen(r, level) {
      const len = { 1: 30, 2: 70, 3: 150 }[level];
      const alphabet = 'aeorstln';
      const s = Array.from({ length: len }, () => pick(r, alphabet)).join('');
      const target = pick(r, 'eorst');
      const shown = level === 1 ? s.match(/.{1,5}/g).join(' ') : s;
      const answer = String([...s].filter((c) => c === target).length);
      return {
        zh: `下面这串字符里，字母 "${target}" 一共出现了多少次？\n${shown}`,
        en: `How many times does the letter "${target}" occur in the following string?\n${shown}`,
        answer,
        grade: 'int'
      };
    }
  },
  listops: {
    levels: [1, 2, 3],
    gen(r, level) {
      const steps = { 1: 5, 2: 12, 3: 25 }[level];
      let list = Array.from({ length: 6 }, () => randInt(r, 1, 99));
      const start = [...list];
      const ops = [];
      for (let i = 0; i < steps; i++) {
        const kind = pick(r, list.length > 3 ? ['append', 'popfirst', 'poplast', 'swap', 'reverse', 'insert', 'rotate'] : ['append', 'insert', 'reverse', 'swap']);
        if (kind === 'append') {
          const x = randInt(r, 1, 99);
          list.push(x);
          ops.push({ zh: `在末尾追加 ${x}`, en: `append ${x} at the end` });
        } else if (kind === 'popfirst') {
          list.shift();
          ops.push({ zh: '删除第一个元素', en: 'remove the first element' });
        } else if (kind === 'poplast') {
          list.pop();
          ops.push({ zh: '删除最后一个元素', en: 'remove the last element' });
        } else if (kind === 'swap') {
          const i1 = randInt(r, 1, list.length);
          let i2 = randInt(r, 1, list.length);
          if (i2 === i1) i2 = (i1 % list.length) + 1;
          [list[i1 - 1], list[i2 - 1]] = [list[i2 - 1], list[i1 - 1]];
          ops.push({ zh: `交换第 ${i1} 个和第 ${i2} 个元素`, en: `swap the elements at positions ${i1} and ${i2}` });
        } else if (kind === 'reverse') {
          list.reverse();
          ops.push({ zh: '把整个列表反转', en: 'reverse the whole list' });
        } else if (kind === 'insert') {
          const x = randInt(r, 1, 99);
          const p = randInt(r, 1, list.length + 1);
          list.splice(p - 1, 0, x);
          ops.push({ zh: `在第 ${p} 个位置插入 ${x}（原来该位置及之后的元素后移）`, en: `insert ${x} at position ${p} (shifting later elements right)` });
        } else {
          const k = randInt(r, 1, Math.max(1, list.length - 1));
          list = [...list.slice(k), ...list.slice(0, k)];
          ops.push({ zh: `整体向左循环移动 ${k} 位（前 ${k} 个元素移到末尾）`, en: `rotate left by ${k} (the first ${k} elements move to the end)` });
        }
      }
      const zhOps = ops.map((o, i) => `${i + 1}. ${o.zh}`).join('\n');
      const enOps = ops.map((o, i) => `${i + 1}. ${o.en}`).join('\n');
      return {
        zh: `列表初始为 [${start.join(', ')}]，位置从 1 开始计数。依次执行下列操作后，列表是什么？答案按 [a, b, c] 的格式写。\n${zhOps}`,
        en: `A list starts as [${start.join(', ')}]; positions are 1-based. After applying these operations in order, what is the list? Write it as [a, b, c].\n${enOps}`,
        answer: `[${list.join(', ')}]`,
        grade: 'list'
      };
    }
  },
  modpow: {
    levels: [2],
    gen(r) {
      const a = randInt(r, 3, 47);
      const b = randInt(r, 25, 90);
      const m = pick(r, [97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157]);
      return {
        zh: `计算 ${a}^${b} mod ${m}（即 ${a} 的 ${b} 次方除以 ${m} 的余数）。`,
        en: `Compute ${a}^${b} mod ${m} (the remainder of ${a} to the power ${b} divided by ${m}).`,
        answer: modPow(a, b, m).toString(),
        grade: 'int'
      };
    }
  },
  crt: {
    levels: [3],
    gen(r) {
      let mods;
      do mods = [randInt(r, 7, 23), randInt(r, 7, 23), randInt(r, 7, 23)];
      while (gcd(mods[0], mods[1]) !== 1 || gcd(mods[0], mods[2]) !== 1 || gcd(mods[1], mods[2]) !== 1);
      const res = mods.map((m) => randInt(r, 1, m - 1));
      const M = mods[0] * mods[1] * mods[2];
      let n = 1;
      while (n <= M && !mods.every((m, i) => n % m === res[i])) n++;
      return {
        zh: `求最小的正整数 n，使 n 除以 ${mods[0]} 余 ${res[0]}、除以 ${mods[1]} 余 ${res[1]}、除以 ${mods[2]} 余 ${res[2]}。`,
        en: `Find the smallest positive integer n with n mod ${mods[0]} = ${res[0]}, n mod ${mods[1]} = ${res[1]} and n mod ${mods[2]} = ${res[2]}.`,
        answer: String(n),
        grade: 'int'
      };
    }
  },
  code: {
    levels: [1, 2, 3],
    gen(r, level) {
      const n = { 1: 4, 2: 9, 3: 20 }[level];
      const x0 = randInt(r, 2, 60);
      const y0 = randInt(r, 1, 30);
      const m = randInt(r, 500, 1999);
      const c = randInt(r, 11, 97);
      let x = x0;
      let y = y0;
      for (let i = 0; i < n; i++) {
        if (x % 3 === 0) x = Math.floor(x / 3) + y;
        else x = (x * 2 + i) % m;
        y = (y + x) % c;
      }
      const code = `x, y = ${x0}, ${y0}\nfor i in range(${n}):\n    if x % 3 == 0:\n        x = x // 3 + y\n    else:\n        x = (x * 2 + i) % ${m}\n    y = (y + x) % ${c}\nprint(x * 1000 + y)`;
      return {
        zh: `不运行代码，推算下面这段 Python 输出的数字。\n\`\`\`python\n${code}\n\`\`\``,
        en: `Without running it, work out the number this Python prints.\n\`\`\`python\n${code}\n\`\`\``,
        answer: String(x * 1000 + y),
        grade: 'int'
      };
    }
  },
  knights: {
    levels: [2, 3],
    gen(r, level) {
      const n = level === 2 ? 3 : 5;
      const names = NAMES.slice(0, n);
      const solve = (stmts) => {
        const sols = [];
        for (let mask = 0; mask < 1 << n; mask++) {
          const knight = (i) => !!(mask & (1 << i));
          if (stmts.every((s, i) => s.eval(knight) === knight(i))) sols.push(mask);
        }
        return sols;
      };
      for (let attempt = 0; attempt < 2000; attempt++) {
        const stmts = names.map((_, speaker) => {
          const others = names.map((__, i) => i).filter((i) => i !== speaker);
          const a = pick(r, others);
          let b = pick(r, others);
          if (b === a) b = others.find((i) => i !== a);
          switch (randInt(r, 0, 4)) {
            case 0: return { eval: (k) => k(a), zh: `${names[a]} 是骑士。`, en: `${names[a]} is a knight.` };
            case 1: return { eval: (k) => !k(a), zh: `${names[a]} 是无赖。`, en: `${names[a]} is a knave.` };
            case 2: return { eval: (k) => k(a) === k(b), zh: `${names[a]} 和 ${names[b]} 是同一类人。`, en: `${names[a]} and ${names[b]} are the same type.` };
            case 3: return { eval: (k) => !k(a) || !k(b), zh: `${names[a]} 和 ${names[b]} 之中至少有一个是无赖。`, en: `At least one of ${names[a]} and ${names[b]} is a knave.` };
            default: {
              const cnt = randInt(r, 1, n - 1);
              return { eval: (k) => names.filter((__, i) => k(i)).length === cnt, zh: `我们 ${n} 人中恰好有 ${cnt} 个骑士。`, en: `Exactly ${cnt} of the ${n} of us are knights.` };
            }
          }
        });
        const sols = solve(stmts);
        if (sols.length !== 1) continue;
        const knights = names.filter((__, i) => sols[0] & (1 << i));
        const zhLines = stmts.map((s, i) => `${names[i]} 说："${s.zh}"`).join('\n');
        const enLines = stmts.map((s, i) => `${names[i]} says: "${s.en}"`).join('\n');
        return {
          zh: `岛上每个人要么是骑士（只说真话），要么是无赖（只说假话）。有 ${n} 个人：${names.join('、')}。\n${zhLines}\n谁是骑士？列出所有骑士的名字，用逗号分隔；如果没有骑士，写 none。`,
          en: `On an island everyone is a knight (always truthful) or a knave (always lies). There are ${n} people: ${names.join(', ')}.\n${enLines}\nWho are the knights? List every knight's name separated by commas, or write none if there are none.`,
          answer: knights.length ? knights.join(', ') : 'none',
          grade: 'set'
        };
      }
      throw new Error('knights: no unique puzzle found'); // practically unreachable
    }
  },
  dates: {
    levels: [1, 2],
    gen(r, level) {
      const base = Date.UTC(2024, 0, 1) + randInt(r, 0, 1500) * DAY_MS;
      if (level === 1) {
        const target = base + randInt(r, 20, 220) * DAY_MS * (r() < 0.5 ? -1 : 1);
        const w = new Date(base).getUTCDay();
        const tw = new Date(target).getUTCDay();
        return {
          zh: `已知 ${isoDate(base)} 是${WEEKDAYS_ZH[w]}，那么 ${isoDate(target)} 是星期几？`,
          en: `Given that ${isoDate(base)} is a ${WEEKDAYS_EN[w]}, what day of the week is ${isoDate(target)}?`,
          answer: WEEKDAYS_EN[tw],
          grade: 'weekday'
        };
      }
      const target = base + randInt(r, 700, 2600) * DAY_MS;
      return {
        zh: `${isoDate(target)} 比 ${isoDate(base)} 晚多少天？（即两个日期相减的天数，按公历，含闰年）`,
        en: `How many days after ${isoDate(base)} is ${isoDate(target)}? (The difference between the two dates in days; Gregorian calendar, leap years included.)`,
        answer: String(Math.round((target - base) / DAY_MS)),
        grade: 'int'
      };
    }
  },
  inclusion: {
    levels: [2],
    gen(r) {
      const N = randInt(r, 2000, 9999);
      const [a, b, c] = shuffle(r, [3, 4, 5, 6, 7, 9, 11, 13]).slice(0, 3);
      let count = 0;
      for (let i = 1; i <= N; i++) if ((i % a === 0 || i % b === 0) && i % c !== 0) count++;
      return {
        zh: `在 1 到 ${N}（含）之间，能被 ${a} 或 ${b} 整除、但不能被 ${c} 整除的整数有多少个？`,
        en: `How many integers from 1 to ${N} inclusive are divisible by ${a} or ${b} but not by ${c}?`,
        answer: String(count),
        grade: 'int'
      };
    }
  },
  sorting: {
    levels: [2, 3],
    gen(r, level) {
      if (level === 2) {
        const words = pseudoWords(r, 12);
        const k = randInt(r, 3, 10);
        const sorted = [...words].sort();
        return {
          zh: `把下面这些词按字母顺序（a→z）排序，排在第 ${k} 位的是哪个词？\n${words.join(' ')}`,
          en: `Sort these words alphabetically (a→z). Which word is in position ${k}?\n${words.join(' ')}`,
          answer: sorted[k - 1],
          grade: 'exact'
        };
      }
      const words = pseudoWords(r, 20, { minSyl: 1, maxSyl: 5 });
      const k = randInt(r, 4, 17);
      const sorted = [...words].sort((x, y) => x.length - y.length || (x < y ? 1 : x > y ? -1 : 0));
      return {
        zh: `把下面这些词先按长度从短到长排序，长度相同的按字母倒序（z→a）排。排在第 ${k} 位的是哪个词？\n${words.join(' ')}`,
        en: `Sort these words by length, shortest first; words of equal length go in reverse alphabetical order (z→a). Which word is in position ${k}?\n${words.join(' ')}`,
        answer: sorted[k - 1],
        grade: 'exact'
      };
    }
  },
  base: {
    levels: [2, 3],
    gen(r, level) {
      if (level === 2) {
        const n = randInt(r, 20000, 999999);
        return { zh: `把十进制数 ${n} 转换成七进制。`, en: `Convert the decimal number ${n} to base 7.`, answer: n.toString(7), grade: 'exact' };
      }
      const n = randInt(r, 300000, 2900000);
      const b12 = n.toString(12).toUpperCase();
      return {
        zh: `把十二进制数 ${b12}（A=10，B=11）转换成五进制。`,
        en: `Convert the base-12 number ${b12} (A = 10, B = 11) to base 5.`,
        answer: n.toString(5),
        grade: 'exact'
      };
    }
  }
};

const QUICK = [['mul', 2], ['mul', 3], ['letters', 3], ['listops', 3], ['modpow', 2], ['crt', 3], ['code', 3], ['knights', 3], ['inclusion', 2], ['sorting', 3], ['base', 3], ['dates', 2]];

export const IQ_LEVELS = ['quick', 'standard', 'full'];

export function buildTasks(seed, level = 'standard') {
  const all = Object.entries(GENERATORS).flatMap(([kind, g]) => g.levels.map((l) => [kind, l]));
  const specs = level === 'quick' ? QUICK : all;
  const copies = level === 'full' ? 2 : 1;
  const tasks = [];
  for (let copy = 0; copy < copies; copy++) {
    for (const [kind, lvl] of specs) {
      const id = `${kind}-L${lvl}${copies > 1 ? `-${copy + 1}` : ''}`;
      const t = GENERATORS[kind].gen(mulberry32(hashSeed(seed, id)), lvl);
      tasks.push({ id, kind, level: lvl, ...t });
    }
  }
  return tasks;
}

// ---------- answer extraction and grading ----------

const ANSWER_RE = /(?:^|\n)\s*[*_#>\s]*(?:final\s+answer|answer|答案|最终答案)\s*[*_]*\s*[:：]\s*(.+)/gi;

export function extractAnswer(text) {
  const raw = String(text ?? '').trim();
  const all = [...raw.matchAll(ANSWER_RE)];
  let ans = all.length ? all[all.length - 1][1] : raw.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  ans = ans.replace(/[*`$]/g, '').replace(/\\boxed\{([^}]*)\}/g, '$1').trim().replace(/[。.]+$/, '');
  return ans;
}

const normInt = (s) => {
  const m = String(s).replace(/(\d)[,\s_'’](?=\d)/g, '$1').match(/-?\d+/);
  return m ? m[0].replace(/^(-?)0+(?=\d)/, '$1') : null;
};
const normWord = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function weekdayIndex(s) {
  const t = String(s).toLowerCase();
  const en = WEEKDAYS_EN.findIndex((w) => t.includes(w.toLowerCase()));
  if (en >= 0) return en;
  const m = t.match(/(?:星期|周|礼拜)([日天一二三四五六])/);
  return m ? '日一二三四五六'.indexOf(m[1] === '天' ? '日' : m[1]) : -1;
}

export function gradeAnswer(task, text) {
  const ans = extractAnswer(text);
  switch (task.grade) {
    case 'int': return normInt(ans) === normInt(task.answer);
    case 'list': {
      const got = (ans.match(/-?\d+/g) || []).join(',');
      return got === (task.answer.match(/-?\d+/g) || []).join(',');
    }
    case 'exact': return normWord(ans) === normWord(task.answer);
    case 'set': {
      const want = task.answer === 'none' ? [] : task.answer.split(/,\s*/);
      const low = ans.toLowerCase();
      const got = NAMES.filter((n) => new RegExp(`\\b${n.toLowerCase()}\\b`).test(low));
      if (!want.length) return !got.length && /none|没有|无/.test(low);
      return got.length === want.length && want.every((n) => got.includes(n));
    }
    case 'weekday': return weekdayIndex(ans) === weekdayIndex(task.answer);
    default: return false;
  }
}

// ---------- prompts ----------

const SYSTEM = {
  zh: '这是一次模型能力检测。不要使用任何工具、代码执行或搜索，只靠你自己的推理。可以写出推理过程，但最后必须单独一行写 "ANSWER: <答案>"。',
  en: 'This is a model capability check. Do not use tools, code execution or search; rely on your own reasoning. You may show your work, but the last line must be "ANSWER: <answer>".'
};
const TAIL = { zh: '\n\n最后单独一行写 ANSWER: <答案>', en: '\n\nEnd with a single line ANSWER: <answer>' };
export const taskPrompt = (t, lang) => (lang === 'zh' ? t.zh : t.en) + (TAIL[lang] || TAIL.en);

const CHARS_PER_TOKEN = 3;

// Needle in a haystack: three codes at the front, middle and end of a prompt of about `tokens` tokens.
const COLORS = ['amber', 'cobalt', 'crimson', 'olive', 'silver', 'teal', 'violet', 'ochre'];
const ANIMALS = ['heron', 'otter', 'lynx', 'falcon', 'badger', 'marten', 'ibis', 'gecko'];
export function buildHaystack(seed, tokens) {
  const r = mulberry32(hashSeed(seed, 'haystack'));
  const code = () => `${pick(r, 'BCDFGHJKLMNPQRSTVWXZ')}${pick(r, 'BCDFGHJKLMNPQRSTVWXZ')}${randInt(r, 100, 999)}-${randInt(r, 1000, 9999)}`;
  const codes = { A: code(), B: code(), C: code() };
  // this filler is ~3.0 characters per token (measured with o200k_base; other tokenizers are similar)
  const targetChars = Math.max(1500, tokens * CHARS_PER_TOKEN);
  const sentences = [];
  let chars = 0;
  for (let i = 1; chars < targetChars; i++) {
    const s = `Log ${i}: the ${pick(r, COLORS)} ${pick(r, ANIMALS)} in sector ${randInt(r, 1, 400)} recorded ${randInt(r, 10, 9999)} units at ${String(randInt(r, 0, 23)).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}.`;
    sentences.push(s);
    chars += s.length + 1;
  }
  const needle = (k) => `IMPORTANT: the access code for vault ${k} is ${codes[k]}.`;
  const at = (f) => Math.min(sentences.length, Math.max(1, Math.round(sentences.length * f)));
  const positions = [['A', 0.03], ['B', 0.5], ['C', 0.97]];
  for (const [k, f] of [...positions].reverse()) sentences.splice(at(f), 0, needle(k));
  const text = sentences.join('\n');
  const question = 'Above is a long log. Three lines in it give access codes for vaults A, B and C. Report all three codes exactly.\n\nEnd with a single line ANSWER: A=<code>, B=<code>, C=<code>';
  return { prompt: `${text}\n\n${question}`, codes, chars: text.length, approxTokens: Math.round(text.length / CHARS_PER_TOKEN) };
}

const LONG_N = 1500;
const LONG_PROMPT = `This is an output-length test, so the full list is required. Output every integer from 1 to ${LONG_N} in increasing order, separated by single spaces. Output nothing else: no introduction, no ellipsis, no "...", no skipping, no summary.`;

export function gradeLongOutput(text) {
  const nums = (String(text).match(/\d+/g) || []).map(Number);
  let reached = 0;
  for (const n of nums) {
    if (n === reached + 1) reached = n;
    else if (n > reached + 1) break;
  }
  return { reached, complete: reached >= LONG_N };
}

// ---------- calling the endpoint ----------

function requestExtras(protocol, { reasoningEffort, thinkingBudget }) {
  if (protocol === 'anthropic' && thinkingBudget) return { thinking: { type: 'enabled', budget_tokens: thinkingBudget } };
  if (protocol !== 'anthropic' && reasoningEffort) return { reasoning_effort: reasoningEffort };
  return undefined;
}

async function pool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}

const trimMeta = (m) => ({
  model: m.model ?? null,
  prompt_tokens: m.prompt_tokens ?? null,
  completion_tokens: m.completion_tokens ?? null,
  reasoning_tokens: m.reasoning_tokens ?? null,
  reasoning_chars: m.reasoning_chars ?? null,
  finish_reason: m.finish_reason ?? null,
  latency_ms: m.latency_ms ?? null,
  error: m.error || undefined
});

export async function runIq(options) {
  const {
    baseUrl, model, apiKey, protocol = 'openai', lang = 'zh', level = 'standard', seed = randomSeed(), rounds = 1,
    context, longOutput = false, reasoningEffort, thinkingBudget, concurrency = 4, maxTokens, timeoutMs = 300000,
    retries, fetchImpl, onProgress
  } = options;
  const url = endpointUrl(protocol, baseUrl);
  const system = SYSTEM[lang] || SYSTEM.en;
  const extra = requestExtras(protocol, { reasoningEffort, thinkingBudget });
  const tokensFor = protocol === 'anthropic' ? maxTokens || (thinkingBudget ? thinkingBudget + 8000 : 8000) : maxTokens;
  const call = (prompt, overrides = {}) => callModel({ protocol, url, apiKey, model, system, prompt, maxTokens: tokensFor, timeoutMs, retries, fetchImpl, extra, ...overrides });

  const tasks = buildTasks(seed, level);
  const ctxTokens = context == null ? { quick: 8000, standard: 32000, full: 100000 }[level] ?? 32000 : context;
  const total = tasks.length * rounds + (ctxTokens > 0 ? 1 : 0) + (longOutput ? 1 : 0);
  let done = 0;
  const tick = () => onProgress && onProgress(++done, total);

  const roundResults = [];
  for (let round = 0; round < rounds; round++) {
    const results = await pool(tasks.map((t) => async () => {
      const prompt = taskPrompt(t, lang);
      const { answer, meta } = await call(prompt);
      tick();
      return { id: t.id, answer: answer.slice(-4000), extracted: extractAnswer(answer), pass: !meta.error && gradeAnswer(t, answer), meta: { ...trimMeta(meta), prompt_chars: system.length + prompt.length } };
    }), concurrency);
    roundResults.push({ results });
  }

  let contextResult = null;
  if (ctxTokens > 0) {
    const hay = buildHaystack(seed, ctxTokens);
    const { answer, meta } = await call(hay.prompt);
    tick();
    const found = Object.fromEntries(Object.entries(hay.codes).map(([k, c]) => [k, answer.includes(c)]));
    contextResult = { tokens: ctxTokens, approx_tokens: hay.approxTokens, codes: hay.codes, found, answer: answer.slice(-1000), meta: { ...trimMeta(meta), prompt_chars: system.length + hay.prompt.length } };
  }

  let longResult = null;
  if (longOutput) {
    const { answer, meta } = await call(LONG_PROMPT, { maxTokens: protocol === 'anthropic' ? Math.max(tokensFor || 0, 16000) : maxTokens || 16000 });
    tick();
    longResult = { n: LONG_N, ...gradeLongOutput(answer), head: answer.slice(0, 200), meta: { ...trimMeta(meta), prompt_chars: system.length + LONG_PROMPT.length } };
  }

  let host = baseUrl;
  try {
    const u = new URL(url);
    host = `${u.origin}${u.pathname}`;
  } catch { /* keep as given */ }

  return {
    tool: 'ccfingerprint',
    kind: 'iq',
    iq_version: IQ_VERSION,
    generated_at: new Date().toISOString(),
    seed,
    level,
    lang,
    api: { protocol, endpoint: host, model, reasoning_effort: reasoningEffort || null, thinking_budget: thinkingBudget || null },
    tasks: tasks.map(({ id, kind, level: l, answer, grade }) => ({ id, kind, level: l, expected: answer, grade })),
    rounds: roundResults,
    context: contextResult,
    long_output: longResult
  };
}

// ---------- scoring ----------

const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// What the claimed model should manage. Light models (mini, nano, flash, haiku …) get no absolute
// expectation: only a baseline or the endpoint's own history can show that they were downgraded.
const LIGHT = /(mini|nano|lite|flash|haiku|small|tiny|instant|\b\d{1,2}b\b)/i;
const FRONTIER = /(gpt-?[5-9]|\bo[134]\b|o[134]-|claude|opus|sonnet|fable|mythos|gemini-?(2\.5-pro|[3-9])|grok-?[4-9]|deepseek|qwen-?[3-9]|kimi-?k[2-9]|glm-?[4-9])/i;
const REASONING = /(gpt-?[5-9](?!.*(chat|instant))|\bo[134]\b|o[134]-|thinking|reasoner|-r1\b|deepseek-r)/i;

export function modelClass(model) {
  const m = String(model || '');
  return {
    frontier: FRONTIER.test(m) && !LIGHT.test(m),
    reasoning: REASONING.test(m) && !/(chat-latest|-chat\b|instant)/i.test(m)
  };
}

function scoreRound(round, tasks) {
  const byLevel = { 1: { n: 0, pass: 0 }, 2: { n: 0, pass: 0 }, 3: { n: 0, pass: 0 } };
  let got = 0;
  let max = 0;
  let errors = 0;
  for (const res of round.results) {
    const t = tasks.find((x) => x.id === res.id);
    if (!t) continue;
    if (res.meta?.error) {
      errors++;
      continue;
    }
    byLevel[t.level].n++;
    max += t.level;
    if (res.pass) {
      byLevel[t.level].pass++;
      got += t.level;
    }
  }
  const rate = (l) => (byLevel[l].n ? byLevel[l].pass / byLevel[l].n : null);
  return { score: max ? Math.round((got / max) * 100) : null, l1: rate(1), l2: rate(2), l3: rate(3), byLevel, errors, n: round.results.length };
}

function reasoningStats(report) {
  const hardIds = new Set(report.tasks.filter((t) => t.level >= 2).map((t) => t.id));
  const metas = report.rounds.flatMap((r) => r.results.filter((x) => hardIds.has(x.id) && !x.meta?.error).map((x) => x.meta));
  const withField = metas.filter((m) => Number.isFinite(m.reasoning_tokens));
  const tokens = withField.map((m) => m.reasoning_tokens);
  const chars = metas.map((m) => m.reasoning_chars).filter((c) => Number.isFinite(c) && c > 0);
  return {
    reported: withField.length > 0,
    reportedShare: metas.length ? withField.length / metas.length : 0,
    median: tokens.length ? Math.round(median(tokens)) : null,
    zeroShare: tokens.length ? tokens.filter((t) => t === 0).length / tokens.length : null,
    reasoningTextSeen: chars.length > 0,
    medianCompletion: metas.length ? Math.round(median(metas.map((m) => m.completion_tokens)) ?? 0) || null : null
  };
}

function speedStats(report) {
  const metas = report.rounds.flatMap((r) => r.results.map((x) => x.meta)).filter((m) => !m?.error && m.completion_tokens >= 50 && m.latency_ms > 0);
  return { tokensPerSecond: median(metas.map((m) => m.completion_tokens / (m.latency_ms / 1000))), samples: metas.length };
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);

export function scoreIq(report, { baseline } = {}) {
  const tasks = report.tasks;
  const rounds = report.rounds.map((r) => scoreRound(r, tasks));
  const valid = rounds.filter((r) => r.score != null);
  const avg = (f) => {
    const xs = valid.map(f).filter((x) => x != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const score = valid.length ? Math.round(avg((r) => r.score)) : null;
  const l1 = avg((r) => r.l1);
  const l2 = avg((r) => r.l2);
  const l3 = avg((r) => r.l3);
  const errors = rounds.reduce((a, r) => a + r.errors, 0);
  const calls = rounds.reduce((a, r) => a + r.n, 0);
  const cls = modelClass(report.api?.model);
  const reasoning = reasoningStats(report);
  const speed = speedStats(report);
  const flags = [];
  const flag = (kind, strong, message) => flags.push({ kind, strong, message });
  // notes are shown but do not change the verdict
  const note = (kind, message) => flags.push({ kind, strong: false, note: true, message });

  const inconclusive = !valid.length || errors / Math.max(1, calls) > 0.3;
  if (inconclusive) {
    flag('errors', false, `${errors}/${calls} 个请求出错，结果不足以下结论 / ${errors} of ${calls} requests failed; not enough data for a verdict`);
  }

  // 1. absolute expectations for the claimed model
  if (!inconclusive && cls.frontier) {
    if (l1 != null && l1 < 0.75) flag('easy', true, `连简单题都只做对 ${pct(l1)}：前沿模型不该这样，像被换成了小模型 / only ${pct(l1)} of the easy tasks: not what a frontier model does, looks like a much smaller model`);
    if (l3 != null && l3 < 0.3) flag('hard', true, `难题只做对 ${pct(l3)}（${report.api?.model} 这一级别通常在 60% 以上）/ only ${pct(l3)} of the hard tasks (models of this class usually pass 60%+)`);
    else if (l3 != null && l3 < 0.6) flag('hard', false, `难题做对 ${pct(l3)}，低于此级别模型的常见水平（60%+）/ ${pct(l3)} of the hard tasks, below the usual 60%+ for this class`);
  }

  // 2. reasoning effort
  if (!inconclusive && cls.reasoning && report.source !== 'sheet') { // a pasted chat reply has no usage data
    if (reasoning.reported && reasoning.zeroShare != null && reasoning.zeroShare >= 0.8) {
      flag('reasoning', true, `自称推理模型，但 ${pct(reasoning.zeroShare)} 的难题 reasoning_tokens 为 0：推理被关闭或换成了非推理模型 / claims a reasoning model, yet ${pct(reasoning.zeroShare)} of hard tasks report 0 reasoning tokens: reasoning is off or the model is not a reasoning model`);
    } else if (reasoning.reported && reasoning.median != null && reasoning.median < 64) {
      flag('reasoning', false, `难题的推理 token 中位数只有 ${reasoning.median}，推理强度可能被调到最低 / median reasoning tokens on hard tasks is only ${reasoning.median}: reasoning effort may be set to minimal`);
    } else if (reasoning.reported && reasoning.reportedShare < 1) {
      flag('reasoning-mixed', false, `只有 ${pct(reasoning.reportedShare)} 的难题请求返回了 reasoning_tokens：请求可能走了不同的后端 / only ${pct(reasoning.reportedShare)} of hard-task requests report reasoning_tokens: requests may be served by different backends`);
    } else if (!reasoning.reported && !reasoning.reasoningTextSeen) {
      flag('reasoning-hidden', false, '接口没有返回 reasoning_tokens，无法核实推理强度（官方 API 会返回；中转站去掉这个字段本身值得注意）/ the API does not report reasoning_tokens, so reasoning effort cannot be checked (the official API reports it; a relay stripping it is itself worth noting)');
    }
  }

  // 3. context
  const ctx = report.context;
  let contextLost = null;
  if (ctx && !ctx.meta?.error) {
    contextLost = Object.entries(ctx.found).filter(([, ok]) => !ok).map(([k]) => k);
    const where = { A: '开头 / start', B: '中间 / middle', C: '末尾 / end' };
    if (contextLost.length) {
      const strong = contextLost.includes('A') || contextLost.length >= 2;
      flag('context', strong, `约 ${ctx.approx_tokens} token 的长文中漏掉了 ${contextLost.map((k) => where[k]).join('、')} 的信息${contextLost.includes('A') ? '：开头丢失通常是上下文被截断' : ''} / missed the needle(s) at the ${contextLost.map((k) => where[k].split(' / ')[1]).join(', ')} of a ~${ctx.approx_tokens}-token prompt${contextLost.includes('A') ? ': losing the start usually means the prompt was truncated' : ''}`);
    }
    const pt = ctx.meta?.prompt_tokens;
    if (Number.isFinite(pt) && pt < ctx.approx_tokens * 0.5) {
      flag('context-tokens', true, `发送约 ${ctx.approx_tokens} token，接口只计了 ${pt} 个输入 token：提示词被截断或压缩 / sent ~${ctx.approx_tokens} tokens but the API counted only ${pt} prompt tokens: the prompt was truncated or compressed`);
    }
  } else if (ctx?.meta?.error) {
    flag('context-error', false, `长上下文请求失败：${String(ctx.meta.error).slice(0, 120)} / the long-context request failed`);
  }

  // 4. long output
  const lo = report.long_output;
  if (lo && !lo.meta?.error && !lo.complete) {
    const capped = ['length', 'max_tokens'].includes(lo.meta?.finish_reason);
    if (capped) {
      flag('output', true, `要求输出 1..${lo.n}，在 ${lo.reached} 处因长度上限被截断（finish_reason=${lo.meta.finish_reason}，输出 ${lo.meta?.completion_tokens ?? '?'} token）：输出长度被限制 / asked for 1..${lo.n}, cut off at ${lo.reached} by a length limit (finish_reason=${lo.meta.finish_reason}, ${lo.meta?.completion_tokens ?? '?'} tokens): output length is capped`);
    } else {
      note('output-abbreviated', `要求输出 1..${lo.n}，模型只写到 ${lo.reached} 就主动结束（finish_reason=${lo.meta?.finish_reason || '-'}）：是模型没照做，不是长度上限 / asked for 1..${lo.n}, the model stopped by itself at ${lo.reached} (finish_reason=${lo.meta?.finish_reason || '-'}): it did not follow the instruction; this is not a length cap`);
    }
  }

  // 4b. hidden prompt tokens: no text tokenizes to more than ~1.2 tokens per character, so a request
  // billed far above that carries a hidden prompt the relay added. Some requests with and some without
  // means requests are split between different channels (a common source of "降智").
  const sized = [
    ...report.rounds.flatMap((r) => r.results.map((x) => ({ id: x.id, m: x.meta }))),
    ...(ctx ? [{ id: 'context', m: ctx.meta }] : []),
    ...(lo ? [{ id: 'long-output', m: lo.meta }] : [])
  ].filter(({ m }) => m && !m.error && Number.isFinite(m.prompt_tokens) && m.prompt_chars > 0);
  const hidden = sized
    .filter(({ m }) => m.prompt_tokens > m.prompt_chars * 1.2 + 300)
    .map(({ id, m }) => ({ id, extra: Math.round(m.prompt_tokens - m.prompt_chars * 0.6) }));
  let channels = null;
  if (hidden.length && sized.length >= 3) {
    const extra = Math.round(median(hidden.map((h) => h.extra)));
    const ids = [...new Set(hidden.map((h) => h.id))];
    const list = `${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''}`;
    if (hidden.length < sized.length) {
      // pass rate of the graded tasks on each channel
      const hiddenIds = new Set(hidden.map((h) => h.id));
      const graded = report.rounds.flatMap((r) => r.results).filter((x) => !x.meta?.error && Number.isFinite(x.meta?.prompt_tokens) && x.meta?.prompt_chars > 0);
      const rate = (xs) => (xs.length ? xs.filter((x) => x.pass).length / xs.length : null);
      const onHidden = graded.filter((x) => hiddenIds.has(x.id) && x.meta.prompt_tokens > x.meta.prompt_chars * 1.2 + 300);
      const onPlain = graded.filter((x) => !(x.meta.prompt_tokens > x.meta.prompt_chars * 1.2 + 300));
      channels = { hidden: { n: onHidden.length, pass: rate(onHidden) }, plain: { n: onPlain.length, pass: rate(onPlain) }, extra };
      const rates = onHidden.length && onPlain.length ? `；两组正确率 ${pct(channels.hidden.pass)}（注入）/ ${pct(channels.plain.pass)}（未注入）` : '';
      const ratesEn = onHidden.length && onPlain.length ? `; pass rate ${pct(channels.hidden.pass)} with the hidden prompt vs ${pct(channels.plain.pass)} without` : '';
      // a split alone proves mixed channels; it proves a downgrade when the hidden-prompt channel does worse
      const worse = channels.hidden.n >= 3 && channels.plain.n >= 3 && channels.plain.pass - channels.hidden.pass >= 0.2;
      flag('hidden-prompt-mixed', worse, `${hidden.length}/${sized.length} 个请求的输入 token 比文本本身多出约 ${extra}（${list}），其余请求没有：请求被分流到不同渠道，其中一部分被注入了隐藏提示词${rates} / ${hidden.length} of ${sized.length} requests were billed ~${extra} more prompt tokens than their text (${list}) and the rest were not: requests are split between channels, some of which add a hidden prompt${ratesEn}`);
    } else {
      flag('hidden-prompt', false, `每个请求的输入 token 都比文本多出约 ${extra}：中转站注入了隐藏提示词，会占用上下文并可能影响回答 / every request was billed ~${extra} more prompt tokens than its text: the relay adds a hidden prompt, which takes up context and can change the answers`);
    }
  }
  if (ctx && !ctx.meta?.error && Number.isFinite(ctx.meta?.prompt_tokens) && ctx.approx_tokens > 0) {
    const pt = ctx.meta.prompt_tokens;
    const hiddenExtra = hidden.length ? median(hidden.map((h) => h.extra)) : 0;
    if (pt > (ctx.approx_tokens + hiddenExtra) * 1.8 + 1000) {
      flag('context-billing', false, `约 ${ctx.approx_tokens} token 的长文被计为 ${pt} 个输入 token（${(pt / ctx.approx_tokens).toFixed(1)} 倍）：计费 token 虚高，或提示词被重复/改写后转发 / a ~${ctx.approx_tokens}-token prompt was billed as ${pt} prompt tokens (${(pt / ctx.approx_tokens).toFixed(1)}×): inflated billing, or the prompt was duplicated or rewritten on the way`);
    }
  }

  // 5. consistency between rounds (intermittent downgrades)
  if (valid.length >= 2) {
    const scores = valid.map((r) => r.score);
    const spread = Math.max(...scores) - Math.min(...scores);
    if (spread >= 25) flag('rounds', true, `各轮得分 ${scores.join(' / ')}，相差 ${spread} 分：间歇性降智（部分请求被路由到更弱的模型）/ round scores ${scores.join(' / ')} differ by ${spread}: intermittent downgrade (some requests routed to a weaker model)`);
    else if (spread >= 15) flag('rounds', false, `各轮得分 ${scores.join(' / ')}，波动偏大 / round scores ${scores.join(' / ')} vary more than usual`);
  }

  // 6. official baseline
  let base = null;
  if (baseline) {
    const b = scoreIq(baseline);
    base = { score: b.score, l3: b.l3, reasoningMedian: b.reasoning.median, tps: b.speed.tokensPerSecond, sameSeed: baseline.seed === report.seed && baseline.level === report.level, model: baseline.api?.model };
    if (!base.sameSeed) flag('baseline-seed', false, `基准报告的题目不同（seed/level 不一致），只能粗略比较；建议用 --seed ${baseline.seed} --level ${baseline.level} 重测 / the baseline used other tasks (seed/level differ), so the comparison is rough; re-run with --seed ${baseline.seed} --level ${baseline.level}`);
    if (score != null && b.score != null) {
      const drop = b.score - score;
      if (drop >= 20) flag('baseline-score', true, `得分 ${score}，比官方基准 ${b.score} 低 ${drop} 分 / score ${score} is ${drop} points below the official baseline ${b.score}`);
      else if (drop >= 10) flag('baseline-score', false, `得分 ${score}，比官方基准 ${b.score} 低 ${drop} 分 / score ${score} is ${drop} points below the official baseline ${b.score}`);
    }
    if (l3 != null && b.l3 != null && b.l3 - l3 >= 0.3) flag('baseline-hard', true, `难题正确率 ${pct(l3)}，官方 ${pct(b.l3)} / hard tasks ${pct(l3)} vs ${pct(b.l3)} on the official API`);
    if (reasoning.median != null && b.reasoning.median != null && b.reasoning.median >= 200) {
      const ratio = reasoning.median / b.reasoning.median;
      if (ratio < 0.35) flag('baseline-reasoning', true, `难题推理 token 中位数 ${reasoning.median}，官方 ${b.reasoning.median}（${pct(ratio)}）：推理强度被调低 / median reasoning tokens ${reasoning.median} vs ${b.reasoning.median} officially (${pct(ratio)}): reasoning effort was turned down`);
      else if (ratio < 0.6) flag('baseline-reasoning', false, `难题推理 token 中位数 ${reasoning.median}，官方 ${b.reasoning.median}（${pct(ratio)}）/ median reasoning tokens ${reasoning.median} vs ${b.reasoning.median} officially (${pct(ratio)})`);
    }
    if (b.reasoning.reported && !reasoning.reported && cls.reasoning) flag('baseline-reasoning-hidden', false, '官方接口返回 reasoning_tokens，这个接口不返回 / the official API reports reasoning_tokens, this endpoint does not');
    const bctx = baseline.context;
    if (bctx && ctx && !bctx.meta?.error && !ctx.meta?.error) {
      const lostHere = Object.keys(bctx.found).filter((k) => bctx.found[k] && !ctx.found[k]);
      if (lostHere.length) flag('baseline-context', true, `官方接口找到了、这个接口漏掉的长文信息：${lostHere.join(', ')} / needles the official API found but this endpoint missed: ${lostHere.join(', ')}`);
    }
    const blo = baseline.long_output;
    if (blo?.complete && lo && !lo.complete) flag('baseline-output', true, `官方接口能完整输出 1..${blo.n}，这个接口只到 ${lo.reached} / the official API completes 1..${blo.n}, this endpoint stops at ${lo.reached}`);
    if (speed.tokensPerSecond && b.speed.tokensPerSecond && speed.tokensPerSecond / b.speed.tokensPerSecond >= 2.5 && score != null && b.score != null && score < b.score) {
      flag('baseline-speed', false, `输出速度 ${Math.round(speed.tokensPerSecond)} token/s，是官方的 ${(speed.tokensPerSecond / b.speed.tokensPerSecond).toFixed(1)} 倍且得分更低：像更小的模型 / ${Math.round(speed.tokensPerSecond)} tokens/s, ${(speed.tokensPerSecond / b.speed.tokensPerSecond).toFixed(1)}× the official speed with a lower score: looks like a smaller model`);
    }
  }

  const strong = flags.filter((f) => f.strong && f.kind !== 'errors');
  const soft = flags.filter((f) => !f.strong && !f.note && !['baseline-seed', 'errors'].includes(f.kind));
  let level;
  if (inconclusive) level = 'questionable';
  else if (strong.length) level = 'untrustworthy';
  else if (soft.length) level = 'questionable';
  else level = 'trustworthy';
  const LABEL = {
    trustworthy: '未见降智 / no sign of downgrade',
    questionable: inconclusive ? '无法判断 / inconclusive' : '疑似降智 / possible downgrade',
    untrustworthy: '降智 / downgraded'
  };
  return {
    model: report.api?.model || null,
    endpoint: report.api?.endpoint || null,
    seed: report.seed,
    level_set: report.level,
    score,
    l1,
    l2,
    l3,
    rounds,
    errors,
    calls,
    modelClass: cls,
    reasoning,
    speed,
    channels,
    context: ctx ? { tokens: ctx.approx_tokens, found: ctx.found, prompt_tokens: ctx.meta?.prompt_tokens ?? null, error: ctx.meta?.error || null } : null,
    longOutput: lo ? { n: lo.n, reached: lo.reached, complete: lo.complete, finish_reason: lo.meta?.finish_reason ?? null, error: lo.meta?.error || null } : null,
    baseline: base,
    flags,
    level,
    label: LABEL[level],
    inconclusive
  };
}

// ---------- rendering ----------

export function renderIq(v, report) {
  const L = [];
  L.push('# 降智检测 / Downgrade check');
  L.push('');
  L.push(`> ${v.model || '-'} · ${v.endpoint || '-'} · seed ${v.seed} · ${v.level_set}${report.api?.reasoning_effort ? ` · reasoning_effort=${report.api.reasoning_effort}` : ''}`);
  L.push('');
  L.push(`**结论 / Verdict: ${v.label}** · 得分 / score **${v.score ?? '-'}**/100`);
  L.push('');
  if (v.flags.length) {
    L.push('## 发现 / Findings');
    for (const f of v.flags) L.push(`- ${f.strong ? '**[强 / strong]** ' : f.note ? '[备注 / note] ' : ''}${f.message}`);
    L.push('');
  }
  L.push('## 推理题 / Reasoning tasks');
  L.push('| 难度 / level | 正确率 / pass rate |');
  L.push('|---|---|');
  L.push(`| 简单 / easy (L1) | ${pct(v.l1)} |`);
  L.push(`| 中等 / medium (L2) | ${pct(v.l2)} |`);
  L.push(`| 困难 / hard (L3) | ${pct(v.l3)} |`);
  if (v.rounds.length > 1) L.push(`| 各轮得分 / round scores | ${v.rounds.map((r) => r.score ?? '-').join(' / ')} |`);
  L.push('');
  L.push('| 题目 / task | 期望 / expected | 作答 / answered | |');
  L.push('|---|---|---|---|');
  const last = report.rounds[report.rounds.length - 1];
  for (const t of report.tasks) {
    const res = last.results.find((x) => x.id === t.id);
    const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 60);
    L.push(`| ${t.id} | ${cell(t.expected)} | ${res?.meta?.error ? `error: ${cell(res.meta.error)}` : cell(res?.extracted)} | ${res?.pass ? '✓' : '✗'} |`);
  }
  L.push('');
  L.push('## 接口信号 / API signals');
  L.push('| 项目 / item | 值 / value |');
  L.push('|---|---|');
  L.push(`| 推理 token（难题中位数）/ reasoning tokens (median, hard) | ${v.reasoning.reported ? v.reasoning.median : v.reasoning.reasoningTextSeen ? '未计数，但有推理文本 / not counted, reasoning text present' : '未返回 / not reported'} |`);
  L.push(`| 输出 token（难题中位数）/ completion tokens (median, hard) | ${v.reasoning.medianCompletion ?? '-'} |`);
  L.push(`| 输出速度 / output speed | ${v.speed.tokensPerSecond ? `${Math.round(v.speed.tokensPerSecond)} token/s` : '-'} |`);
  if (v.context) {
    const f = v.context.found;
    L.push(`| 长上下文 / long context (~${v.context.tokens} tokens) | ${v.context.error ? `error: ${String(v.context.error).slice(0, 80)}` : `开头 / start ${f.A ? '✓' : '✗'} · 中间 / middle ${f.B ? '✓' : '✗'} · 末尾 / end ${f.C ? '✓' : '✗'} · 计费输入 / billed prompt ${v.context.prompt_tokens ?? '-'}`} |`);
  }
  if (v.longOutput) L.push(`| 长输出 / long output (1..${v.longOutput.n}) | ${v.longOutput.error ? `error: ${String(v.longOutput.error).slice(0, 80)}` : `${v.longOutput.complete ? '完整 / complete' : `到 ${v.longOutput.reached} 截止 / stopped at ${v.longOutput.reached}`} · finish_reason=${v.longOutput.finish_reason || '-'}`} |`);
  L.push(`| 出错请求 / failed requests | ${v.errors}/${v.calls} |`);
  L.push('');
  if (v.baseline) {
    L.push('## 官方基准 / Official baseline');
    L.push('| 项目 / item | 本接口 / this endpoint | 官方 / official |');
    L.push('|---|---|---|');
    L.push(`| 得分 / score | ${v.score ?? '-'} | ${v.baseline.score ?? '-'} |`);
    L.push(`| 难题 / hard | ${pct(v.l3)} | ${pct(v.baseline.l3)} |`);
    L.push(`| 推理 token / reasoning tokens | ${v.reasoning.median ?? '-'} | ${v.baseline.reasoningMedian ?? '-'} |`);
    L.push(`| 速度 / speed | ${v.speed.tokensPerSecond ? Math.round(v.speed.tokensPerSecond) : '-'} | ${v.baseline.tps ? Math.round(v.baseline.tps) : '-'} |`);
    L.push(`| 同一套题 / same tasks | ${v.baseline.sameSeed ? '是 / yes' : '否 / no'} | |`);
    L.push('');
  }
  if (!v.modelClass.frontier && !v.baseline) {
    L.push('> 这个模型名不属于前沿大模型，没有绝对标准可比；请用官方接口跑一份基准（同一个 `--seed`）再用 `--baseline` 对比，或用 `--history` 跟踪它自己的变化。/ No absolute expectation for this model name: compare with an official baseline (same `--seed`) via `--baseline`, or track it over time with `--history`.');
    L.push('');
  }
  L.push('> 题目每次随机生成（记录了 seed，可复现），无法背题，也无法用缓存答案应付。单次结果有抽样误差；间歇性降智请用 `--rounds` 多轮或 `--history` 定时跟踪。/ Tasks are generated per run (seed recorded for reproducibility), so they cannot be memorised or served from a cache. Single runs carry sampling noise; use `--rounds` or `--history` for intermittent downgrades.');
  return L.join('\n') + '\n';
}

export function iqJson(v) {
  return {
    tool: 'ccfingerprint',
    kind: 'iq',
    model: v.model,
    endpoint: v.endpoint,
    seed: v.seed,
    level: v.level_set,
    verdict: v.level,
    label: v.label,
    score: v.score,
    pass_rate: { easy: v.l1, medium: v.l2, hard: v.l3 },
    rounds: v.rounds.map((r) => r.score),
    reasoning: { reported: v.reasoning.reported, median_hard: v.reasoning.median, zero_share: v.reasoning.zeroShare },
    tokens_per_second: v.speed.tokensPerSecond,
    context: v.context,
    long_output: v.longOutput,
    baseline: v.baseline,
    flags: v.flags
  };
}

// ---------- history (separate file from probe history: different record shape) ----------

export function iqHistoryRecord(report, v, { name, reportPath } = {}) {
  return {
    kind: 'iq',
    at: report.generated_at,
    name: name || null,
    endpoint: report.api?.endpoint || null,
    model: report.api?.model || null,
    protocol: report.api?.protocol || null,
    level: report.level,
    verdict: v.level,
    score: v.score,
    hard: v.l3 == null ? null : Number(v.l3.toFixed(3)),
    reasoning_median: v.reasoning.median,
    context_found: v.context?.found ? Object.values(v.context.found).filter(Boolean).length : null,
    long_complete: v.longOutput ? v.longOutput.complete : null,
    tps: v.speed.tokensPerSecond == null ? null : Math.round(v.speed.tokensPerSecond),
    flags: v.flags.length,
    report: reportPath || null
  };
}

const iqKey = (r) => `${r.name || r.endpoint || '-'} | ${r.model || '-'} | ${r.protocol || '-'}`;

export function detectIqDrift(prev, cur) {
  if (!prev || !cur) return [];
  const out = [];
  const add = (kind, strong, message) => out.push({ kind, strong, message });
  if (prev.level === cur.level && prev.score != null && cur.score != null && prev.score - cur.score >= 15) {
    add('iq-score', prev.score - cur.score >= 25, `降智检测得分 ${prev.score} → ${cur.score} / downgrade-check score ${prev.score} → ${cur.score}`);
  }
  if (prev.reasoning_median >= 200 && cur.reasoning_median != null && cur.reasoning_median / prev.reasoning_median < 0.4) {
    add('iq-reasoning', true, `难题推理 token 中位数 ${prev.reasoning_median} → ${cur.reasoning_median}：推理强度被调低 / median reasoning tokens ${prev.reasoning_median} → ${cur.reasoning_median}: reasoning effort turned down`);
  }
  if (prev.context_found != null && cur.context_found != null && cur.context_found < prev.context_found) {
    add('iq-context', true, `长上下文找到的信息 ${prev.context_found}/3 → ${cur.context_found}/3 / long-context needles found ${prev.context_found}/3 → ${cur.context_found}/3`);
  }
  if (prev.long_complete === true && cur.long_complete === false) add('iq-output', true, '长输出上次完整、这次被截断 / long output was complete last time, cut short now');
  const rank = { trustworthy: 2, questionable: 1, untrustworthy: 0 };
  if ((rank[cur.verdict] ?? 2) < (rank[prev.verdict] ?? 2)) add('iq-verdict', true, `降智检测结论 ${prev.verdict} → ${cur.verdict} / downgrade verdict ${prev.verdict} → ${cur.verdict}`);
  return out;
}

export function appendIqHistory(file, record) {
  const records = readHistory(file).filter((r) => r.kind === 'iq');
  let prev = null;
  for (let i = records.length - 1; i >= 0; i--) if (iqKey(records[i]) === iqKey(record)) { prev = records[i]; break; }
  const dir = path.dirname(file);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
  return { previous: prev, drift: detectIqDrift(prev, record) };
}

// ---------- paste-in sheet for chat apps without an API (e.g. the ChatGPT web app) ----------

export function buildSheet(seed, level = 'quick', lang = 'zh') {
  const tasks = buildTasks(seed, level);
  const zh = lang === 'zh';
  const head = zh
    ? `下面是 ${tasks.length} 道推理题，用来检测你的推理能力。规则：不要使用代码执行、Python、计算器、搜索或任何工具；可以写推理过程。全部做完后，最后输出一个 ANSWERS 段落，每题一行，格式为 "题号: 答案"。`
    : `Below are ${tasks.length} reasoning tasks used to check your reasoning ability. Rules: do not use code execution, Python, a calculator, search or any tool; you may show your work. When done, finish with an ANSWERS section, one line per task in the form "number: answer".`;
  const body = tasks.map((t, i) => `### ${i + 1}\n${zh ? t.zh : t.en}`).join('\n\n');
  return { text: `${head}\n\n${body}\n\nANSWERS\n${tasks.map((_, i) => `${i + 1}: `).join('\n')}\n`, tasks };
}

// Parse "3: answer" lines (the last occurrence of each number wins) and score them like an API run.
export function gradeSheet(text, seed, level = 'quick', model = null) {
  const tasks = buildTasks(seed, level);
  const src = String(text);
  const idx = src.search(/\bANSWERS\b|答案汇总/i);
  const tail = idx >= 0 ? src.slice(idx) : src;
  const answers = {};
  for (const m of tail.matchAll(/^\s*\**\s*(\d{1,3})\s*\**\s*[:：.)、]\s*(.+?)\s*$/gm)) answers[Number(m[1])] = m[2];
  const results = tasks.map((t, i) => {
    const a = answers[i + 1] ?? '';
    return { id: t.id, answer: a, extracted: extractAnswer(`ANSWER: ${a}`), pass: a ? gradeAnswer(t, `ANSWER: ${a}`) : false, meta: {} };
  });
  return {
    tool: 'ccfingerprint',
    kind: 'iq',
    source: 'sheet',
    iq_version: IQ_VERSION,
    generated_at: new Date().toISOString(),
    seed,
    level,
    lang: null,
    api: { protocol: null, endpoint: 'chat app (pasted)', model },
    tasks: tasks.map(({ id, kind, level: l, answer, grade }) => ({ id, kind, level: l, expected: answer, grade })),
    rounds: [{ results }],
    context: null,
    long_output: null
  };
}

// ---------- CLI ----------

function readJson(file, en) {
  if (!fs.existsSync(file)) {
    console.error(en ? `Error: file not found "${file}"` : `错误: 找不到文件 "${file}"`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(en ? `Error: "${file}" is not valid JSON. ${e.message}` : `错误: "${file}" 不是合法 JSON。${e.message}`);
    process.exit(1);
  }
}

function parseTokens(s) {
  if (s == null) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(k|m)?$/i.exec(String(s).trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]) * ({ k: 1000, m: 1000000 }[(m[2] || '').toLowerCase()] || 1));
}

export function iqParams(options, env = process.env) {
  const en = (options.lang || 'zh') === 'en';
  const level = options.level || 'standard';
  if (!IQ_LEVELS.includes(level)) return { error: en ? 'Error: --level must be quick, standard or full' : '错误: --level 只能是 quick、standard 或 full' };
  const { error, params } = probeParams({ ...options, timeout: options.timeout ?? 300 }, env);
  if (error) return { error };
  const seed = options.seed != null ? parseInt(options.seed, 10) : undefined;
  return {
    params: {
      ...params,
      level,
      seed: Number.isFinite(seed) ? seed : randomSeed(),
      rounds: Math.max(1, parseInt(options.rounds ?? 1, 10) || 1),
      context: options.context != null ? parseTokens(options.context) ?? 0 : undefined,
      longOutput: !!options.longOutput,
      reasoningEffort: options.reasoningEffort || undefined,
      thinkingBudget: options.thinkingBudget ? parseInt(options.thinkingBudget, 10) : undefined
    }
  };
}

export function emitIq(v, report, options = {}) {
  const lang = options.lang || 'zh';
  const en = lang === 'en';
  const md = renderIq(v, report);
  const outPath = options.output || 'ccfp-iq.md';
  fs.writeFileSync(outPath, md, 'utf-8');
  if (options.html) {
    fs.writeFileSync(options.html, renderHtml(md, { title: `ccfp iq · ${v.model || ''} · ${v.score ?? '-'}/100`, badge: { level: v.level, confidence: v.score ?? 0 } }), 'utf-8');
    console.error(en ? `Saved HTML report to ${options.html}` : `已保存 HTML 报告: ${options.html}`);
  }
  if (options.json) console.log(JSON.stringify(iqJson(v), null, 2));
  else {
    console.log(md);
    console.log(en ? `Saved to ${outPath}` : `已保存: ${outPath}`);
  }
  const threshold = options.failUnder == null ? NaN : Number(options.failUnder);
  if ((Number.isFinite(threshold) && (v.score ?? 0) < threshold) || (options.failOnDowngrade && v.level === 'untrustworthy')) process.exitCode = 2;
}

export async function iq(options) {
  const lang = options.lang || 'zh';
  const en = lang === 'en';
  const level = options.level || (options.sheet || options.grade ? 'quick' : 'standard');

  if (options.sheet) {
    const seed = options.seed != null ? parseInt(options.seed, 10) : randomSeed();
    const { text } = buildSheet(seed, level, lang);
    const file = typeof options.sheet === 'string' ? options.sheet : 'ccfp-iq-sheet.md';
    fs.writeFileSync(file, text, 'utf-8');
    console.log(text);
    console.error(en
      ? `Saved to ${file}. Paste it into the chat app, save the whole reply to a file, then run:\n  ccfp iq --grade <reply.txt> --seed ${seed} --level ${level} [--model <claimed model>]`
      : `已保存到 ${file}。把它整段粘贴给聊天应用，把完整回复存成文件，然后运行：\n  ccfp iq --grade <回复.txt> --seed ${seed} --level ${level} [--model <所选模型>]`);
    return null;
  }

  let report;
  if (options.grade) {
    if (options.seed == null) {
      console.error(en ? 'Error: --grade needs the --seed printed with the sheet' : '错误: --grade 需要生成题单时给出的 --seed');
      process.exit(1);
    }
    if (!fs.existsSync(options.grade)) {
      console.error(en ? `Error: file not found "${options.grade}"` : `错误: 找不到文件 "${options.grade}"`);
      process.exit(1);
    }
    report = gradeSheet(fs.readFileSync(options.grade, 'utf-8'), parseInt(options.seed, 10), level, options.model || null);
  } else if (options.from) {
    report = readJson(options.from, en);
  } else {
    const { error, params } = iqParams({ ...options, level });
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.error(en ? `seed ${params.seed} · ${params.level}` : `seed ${params.seed} · ${params.level}（用同一个 --seed 在官方接口上跑可得到可比基准）`);
    report = await runIq({ ...params, onProgress: (d, t) => process.stderr.write(`\r${en ? 'testing' : '检测中'} ${d}/${t}`) });
    process.stderr.write('\n');
  }

  const reportPath = options.report || 'ccfp-iq.json';
  if (!options.from) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.error(en ? `Saved raw report to ${reportPath}` : `已保存原始报告: ${reportPath}`);
  }
  const baseline = options.baseline ? readJson(options.baseline, en) : null;
  const v = scoreIq(report, { baseline });
  if (options.history) {
    const { drift } = appendIqHistory(options.history, iqHistoryRecord(report, v, { reportPath }));
    v.drift = drift;
    if (drift.length) {
      v.flags.push(...drift.map((d) => ({ ...d, message: `${en ? 'since the previous run' : '与上次相比'}: ${d.message}` })));
      if (drift.some((d) => d.strong)) {
        v.level = 'untrustworthy';
        v.label = '降智 / downgraded';
      } else if (v.level === 'trustworthy') {
        v.level = 'questionable';
        v.label = '疑似降智 / possible downgrade';
      }
    }
    if (options.failOnDrift && drift.length) process.exitCode = 2;
  }
  emitIq(v, report, options);
  return v;
}

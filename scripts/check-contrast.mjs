#!/usr/bin/env node
/**
 * WCAG 对比度校验器 · mermaid-palette
 *
 * 用法：
 *   node check-contrast.mjs "#228be6" "#ffffff"      校验一对颜色
 *   node check-contrast.mjs "#228be6 #ffffff"        同上（空格分隔）
 *   node check-contrast.mjs diagram.md              扫描文件里所有 style/classDef 着色
 *   node check-contrast.mjs --palette               输出四档色板实测值
 *   node check-contrast.mjs --fill-only             只校验 fill/color，不查 fill/stroke
 *
 * 门禁（WCAG 2.1）：
 *   图形/大字（≥18pt 或 ≥14pt 粗体）  ≥ 3.0  AA
 *   正文标签                          ≥ 4.5  AA
 *   AAA                               ≥ 7.0
 *
 * 退出码：0 全过 / 1 有低于门禁 / 2 用法错误
 */

import { readFileSync, existsSync } from 'node:fs';

// ---------- 颜色解析 ----------

/** 解析 #rgb / #rrggbb / rgb(r,g,b)，返回 {r,g,b} 0-255 */
function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();

  const hex = s.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };

  return null;
}

/** sRGB 分量线性化（WCAG 2.1 相对亮度定义） */
function toLinear(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度 L = 0.2126R + 0.7152G + 0.0722B */
function luminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** 对比度 (L1+0.05)/(L2+0.05)，L1 为较亮者 */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function grade(ratio, needAA = 4.5) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= needAA) return 'AA';
  if (ratio >= 3.0) return 'AA-large';
  return 'FAIL';
}

// ---------- 门禁常量 ----------

const GATE_GRAPHIC = 3.0; // 图形/大字
const GATE_TEXT = 4.5; // 正文标签
const GATE_BORDER = 3.0; // 容器描边 vs 底色

// ---------- 四档色板 ----------

const PALETTE = {
  'B 色相下沉（默认）': [
    ['stepB', '#228be6', '#ffffff', '#1864ab'],
    ['okB', '#2f9e44', '#ffffff', '#1b6b2f'],
    ['failB', '#f03e3e', '#ffffff', '#c92a2a'],
    ['warnB', '#e8590c', '#ffffff', '#b23c0c'],
    ['rollB', '#845ef7', '#ffffff', '#6741d9'],
    ['dataB', '#099268', '#ffffff', '#087f5b'],
    ['muteB', '#868e96', '#ffffff', '#495057'],
  ],
  'A 稳重（退让档）': [
    ['stepA', '#1864ab', '#ffffff', '#0b4f8a'],
    ['okA', '#1b6b2f', '#ffffff', '#124d21'],
    ['failA', '#e03131', '#ffffff', '#a61e1e'],
    ['warnA', '#b23c0c', '#ffffff', '#8a2d09'],
    ['rollA', '#7950f2', '#ffffff', '#5f3dc4'],
    ['dataA', '#087f5b', '#ffffff', '#066a4c'],
    ['muteA', '#495057', '#ffffff', '#343a40'],
  ],
  'C 容器（仅超大 subgraph）': [
    ['grpBlue', '#E3F2FD', '#0b4f8a', '#1864ab'],
    ['grpGreen', '#E8F5E9', '#124d21', '#1b6b2f'],
    ['grpWarn', '#FFF3E0', '#8a2d09', '#b23c0c'],
    ['grpRoll', '#F3E5F5', '#4a2a9e', '#7950f2'],
    ['grpFail', '#FFEBEE', '#a61e1e', '#e03131'],
  ],
  'D 亮底（⚠ 非常规，禁白字）': [
    ['stepD', '#4dabf7', '#1a1b1e', '#1c7ed6'],
    ['okD', '#51cf66', '#1a1b1e', '#2f9e44'],
    ['failD', '#ff6b6b', '#1a1b1e', '#e03131'],
    ['warnD', '#ff922b', '#1a1b1e', '#e8590c'],
    ['rollD', '#9775fa', '#1a1b1e', '#6741d9'],
    ['dataD', '#20c997', '#1a1b1e', '#087f5b'],
    ['muteD', '#adb5bd', '#1a1b1e', '#868e96'],
  ],
};

const BAD_DEFAULT_COLORS = ['#4dabf7', '#51cf66', '#ff6b6b', '#ff922b'];

// ---------- 文件扫描 ----------

/**
 * 从一行 style/classDef 里抠出 fill / color / stroke。
 * 支持 `style N1 fill:#228be6,color:#ffffff,stroke:#1864ab,stroke-width:2px`
 * 与   `classDef step fill:#228be6,color:#ffffff,stroke:#1864ab`
 */
function extractPaint(line) {
  const fill = line.match(/fill\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  const color = line.match(/(?:^|[,\s])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  const stroke = line.match(/stroke\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  if (!fill) return null;
  return {
    fill: fill[1],
    color: color ? color[1] : null,
    stroke: stroke ? stroke[1] : null,
  };
}

function scanFile(path, fillOnly) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const issues = [];
  let checked = 0;
  let inMermaid = false;

  lines.forEach((line, i) => {
    if (/^\s*```mermaid/.test(line)) { inMermaid = true; return; }
    if (inMermaid && /^\s*```\s*$/.test(line)) { inMermaid = false; return; }
    if (!inMermaid) return;

    const isPaintLine = /^\s*(style|classDef)\s/.test(line);
    if (!isPaintLine) return;

    const paint = extractPaint(line);
    if (!paint) return;

    const fill = parseColor(paint.fill);
    const color = paint.color ? parseColor(paint.color) : null;
    const stroke = paint.stroke ? parseColor(paint.stroke) : null;
    if (!fill) return;

    checked++;
    const tag = line.trim().slice(0, 60);

    if (color) {
      const ratio = contrast(fill, color);
      const isWhite = paint.color.toLowerCase() === '#ffffff' || paint.color.toLowerCase() === '#fff';
      // 白字视为"图形/大字"场景按 3.0；深字承载正文按 4.5
      const need = isWhite ? GATE_GRAPHIC : GATE_TEXT;
      if (ratio < need) {
        issues.push({
          line: i + 1,
          kind: 'text',
          ratio,
          need,
          msg: `fill ${paint.fill} + color ${paint.color} = ${ratio.toFixed(2)} < ${need}`,
          tag,
        });
      }
    }

    // 只有「浅底容器」才要求 stroke vs fill ≥ 3.0（C 档：靠描边划边界）。
    // 实心色块（B/A/D 档）的 stroke 是同色系加深装饰，对比度天然低，套 3.0 门禁会误报。
    if (!fillOnly && stroke && luminance(fill) > 0.5) {
      const ratio = contrast(fill, stroke);
      if (ratio < GATE_BORDER) {
        issues.push({
          line: i + 1,
          kind: 'border',
          ratio,
          need: GATE_BORDER,
          msg: `容器 fill ${paint.fill} + stroke ${paint.stroke} = ${ratio.toFixed(2)} < ${GATE_BORDER}（浅底边界会糊）`,
          tag,
        });
      }
    }
  });

  return { checked, issues };
}

// ---------- 输出 ----------

function printPair(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) {
    console.error(`✗ 无法解析颜色：${!ca ? a : b}`);
    process.exit(2);
  }
  const ratio = contrast(ca, cb);
  const g = grade(ratio, 4.5);
  const pass = ratio >= GATE_GRAPHIC;
  console.log(`${pass ? '✅' : '❌'}  ${a}  vs  ${b}  =  ${ratio.toFixed(2)}:1   ${g}`);
  if (!pass) {
    console.log(`    门禁：图形/大字 ≥ ${GATE_GRAPHIC}，正文标签 ≥ ${GATE_TEXT}`);
    console.log('    解法：色相不动，只把 fill 亮度压一档（见 refs/palette.md 色相下沉对照表）');
  }
  return pass;
}

function printPalette() {
  console.log('四档色板实测对比度\n');
  let bad = 0;
  for (const [tier, rows] of Object.entries(PALETTE)) {
    console.log(`── ${tier} ──`);
    console.log('  名称        fill      文字色     对比度   等级      容器描边');
    for (const [name, fill, color, stroke] of rows) {
      const r = contrast(parseColor(fill), parseColor(color));
      // 只有浅底容器才需要 stroke 划边界；实心块的 stroke 是同色系加深，不套门禁
      const isContainer = luminance(parseColor(fill)) > 0.5;
      const rs = contrast(parseColor(fill), parseColor(stroke));
      const g = grade(r, 4.5);
      const ok = r >= GATE_GRAPHIC && (!isContainer || rs >= GATE_BORDER);
      if (!ok) bad++;
      const strokeCell = isContainer ? `${rs.toFixed(2)}` : '—（实心）';
      console.log(
        `  ${ok ? '✅' : '❌'} ${name.padEnd(9)} ${fill.padEnd(9)} ${color.padEnd(10)} ` +
        `${r.toFixed(2).padStart(6)}   ${g.padEnd(9)} ${strokeCell}`
      );
    }
    console.log('');
  }

  console.log('── 已知不达标的亮色（反面教材，勿用于白字）──');
  for (const c of BAD_DEFAULT_COLORS) {
    const r = contrast(parseColor(c), parseColor('#ffffff'));
    console.log(`  ❌ ${c} + #ffffff = ${r.toFixed(2)}  → 需要色相下沉`);
  }
  console.log('');
  console.log(bad === 0 ? '✅ 全部色板达标' : `❌ 有 ${bad} 项不达标`);
  return bad === 0;
}

function printFileResult(path, fillOnly) {
  if (!existsSync(path)) {
    console.error(`✗ 文件不存在：${path}`);
    process.exit(2);
  }
  const { checked, issues } = scanFile(path, fillOnly);
  if (checked === 0) {
    console.log(`ℹ ${path}：未找到 mermaid 里的 style/classDef 着色语句`);
    return true;
  }
  if (issues.length === 0) {
    console.log(`✅ ${path}：${checked} 处着色全部达标`);
    return true;
  }
  console.log(`❌ ${path}：${checked} 处着色中 ${issues.length} 处不达标\n`);
  for (const it of issues) {
    console.log(`  第 ${it.line} 行 [${it.kind}] ${it.msg}`);
    console.log(`      ${it.tag}`);
  }
  return false;
}

// ---------- 入口 ----------

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`WCAG 对比度校验器 · mermaid-palette

用法：
  node check-contrast.mjs "#228be6" "#ffffff"     校验一对颜色
  node check-contrast.mjs "#228be6 #ffffff"       同上
  node check-contrast.mjs diagram.md             扫描文件里所有 style/classDef
  node check-contrast.mjs --palette              输出四档色板实测值
  node check-contrast.mjs --fill-only <file>     只查 fill/color，不查 fill/stroke

门禁：图形/大字 ≥ 3.0 · 正文标签 ≥ 4.5 · 容器描边 ≥ 3.0
退出码：0 全过 / 1 有不达标 / 2 用法错误`);
  process.exit(args.length === 0 ? 2 : 0);
}

const fillOnly = args.includes('--fill-only');
const rest = args.filter((a) => !a.startsWith('--'));

if (args.includes('--palette')) {
  process.exit(printPalette() ? 0 : 1);
}

let allPass = true;

if (rest.length === 1 && !existsSync(rest[0]) && !/^\s*#[0-9a-fA-F]{3,8}/.test(rest[0])) {
  console.error(`✗ 不认识参数：${rest[0]}`);
  process.exit(2);
}

if (rest.length >= 2) {
  allPass = printPair(rest[0], rest[1]) && allPass;
} else if (rest.length === 1) {
  const isColor = /^\s*#?[0-9a-fA-F]{3,8}/.test(rest[0]) && rest[0].trim().includes('#');
  if (rest[0].trim().split(/\s+/).length === 2) {
    const [a, b] = rest[0].trim().split(/\s+/);
    allPass = printPair(a, b) && allPass;
  } else if (existsSync(rest[0])) {
    allPass = printFileResult(rest[0], fillOnly) && allPass;
  } else if (isColor) {
    console.error('✗ 只给了一个颜色，需要成对：node check-contrast.mjs "#fill" "#color"');
    process.exit(2);
  } else {
    console.error(`✗ 文件不存在，也不是颜色：${rest[0]}`);
    process.exit(2);
  }
}

process.exit(allPass ? 0 : 1);

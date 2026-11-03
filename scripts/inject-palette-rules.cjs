#!/usr/bin/env node
/**
 * mermaid-palette 规则注入 hook
 *
 * 作用：把「配色强制规则」在每轮会话开头注入模型上下文。
 *       装一次，之后所有工作区、所有会话自动生效——不依赖模型记得去读 SKILL.md。
 *
 * 用法：由 hook 配置调用（见 refs/deploy-global.md），不手动运行。
 *
 * 为什么一个脚本能同时服务两种 harness：
 *   - Copilot harness 读顶层 additionalContext
 *   - Local harness   读 hookSpecificOutput.additionalContext（PascalCase 事件名）
 *   两者都会忽略自己不认识的字段，所以同一份输出可双吃，不会重复注入。
 *
 * 契约：
 *   stdin  —— 事件 JSON（仅用于区分主会话 / 子 agent）
 *   stdout —— 单个 JSON 对象；禁用时输出 {}
 *   退出码 —— 恒为 0（fail-open）。hook 报错绝不能卡住用户会话。
 *
 * 禁用：环境变量 MERMAID_PALETTE_HOOK_DISABLE=1 → 输出 {}，交给默认行为。
 *
 * 复用：本文件同时是模块。被 require 时只导出 RULES / detectEvent，不接管 stdin。
 *       其它绘图类 hook 可以 require 本文件取规则正文，避免同一份配色规范存两处。
 *       例：require('~/.claude/skills/mermaid-palette/scripts/inject-palette-rules.cjs').RULES
 */

'use strict';

const os = require('node:os');
const path = require('node:path');

/** 权威文件绝对路径：脚本所在的 skill 目录 */
const SKILL_DIR = path.resolve(__dirname, '..');
const CANON = path.join(SKILL_DIR, 'SKILL.md');
const REFS = path.join(SKILL_DIR, 'refs', 'palette.md');
const CHECKER = path.join(SKILL_DIR, 'scripts', 'check-contrast.mjs');

const RULES = `【mermaid 配色强制规则 · 画图前必读】
权威：${CANON}（四档完整色值）、${REFS}（语义映射与混档例外）。校验脚本：node "${CHECKER}" <文件或色值>

1 默认 B 档 = 色相下沉 + 白字 #ffffff：蓝 #228be6 主流程/入口、绿 #2f9e44 成功/完成、红 #f03e3e 失败/阻断、橙 #e8590c 警告/待确认、紫 #845ef7 纠偏/回退、青 #099268 数据/存储、灰 #868e96 中性/旁路。
2 对比度门禁：fill 上承载文字 color ≥3.0，正文标签 ≥4.5。#4dabf7/#51cf66/#ff6b6b/#ff922b 配白字仅 2.48/2.01/2.78/1.90，不达标；压暗一档为 #228be6/#2f9e44/#f03e3e/#e8590c——色相不换、白字不换，过了 3.0 就停，别一步压到 #1864ab 那种 AAA 深色。
3 同一张图 ≤5 色、强调色 ≤1；同一色相在整份文档里永远同义；容器 fill 与 stroke 对比度同样 ≥3.0；同图不混档（唯一例外：时序图 rect 走 C 档浅底 + actor 走 B 档实心）。
4 白字是默认字色。用户指定了色相或字色就照做，最多附一句实测值；AI 想改必须先问，不许默默"优化"。
5 颜色不够用不许换图型：有时序用 sequenceDiagram、有分支用 flowchart、有状态用 stateDiagram-v2。上色是第二层，图型由要表达的信息决定。
6 交付前跑校验脚本。门禁只输出实测数字、不裁决审美；低于门线由用户决定用不用。`;

let emitted = false;
let eventName = 'SessionStart';

/** 两个 harness 的字段名都认，判断是主会话还是子 agent */
function detectEvent(raw) {
  if (!raw) return 'SessionStart';
  const text = String(raw);
  if (/"hook_event_name"\s*:\s*"SubagentStart"/.test(text)) return 'SubagentStart';
  if (/"(agentName|agent_name|agentType|agent_type)"/.test(text)) return 'SubagentStart';
  return 'SessionStart';
}

// 被 require 时到此为止：只导出规则正文，不注册 hook 事件监听
module.exports = { RULES, detectEvent };

function emit() {
  if (emitted) return;
  emitted = true;
  clearTimeout(timer);
  try {
    process.stdin.pause();
    process.stdin.destroy();
  } catch {
    /* stdin 已关闭 */
  }
  try {
    if (process.env.MERMAID_PALETTE_HOOK_DISABLE === '1') {
      process.stdout.write('{}');
      return;
    }
    process.stdout.write(
      JSON.stringify({
        additionalContext: RULES,                                        // Copilot harness
        hookSpecificOutput: {                                            // Local harness
          hookEventName: eventName,
          additionalContext: RULES,
        },
      })
    );
  } catch {
    /* 输出失败也不能非零退出 */
  }
}

// 仅当直接执行（被 hook 调用）时才接管 stdin
if (require.main === module) {
  // 宿主通常会关 stdin；1.5s 兜底防某些宿主不关管道，把会话卡到 timeoutSec
  var timer = setTimeout(emit, 1500);

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.on('end', () => {
    eventName = detectEvent(buffer);
    emit();
  });
  process.stdin.on('error', emit);
  process.stdin.resume();
  process.on('uncaughtException', emit);
}

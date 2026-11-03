# 全局部署协议（面向 AI）

> **这份文档是写给 AI 读的。** 目标是：读完之后你能独立完成「让 mermaid-palette 在所有工作区自动生效」的部署，不需要人类补充上下文。
>
> 人类用户请读 [README 的安装章节](../README.md#安装)。

---

## 0. 先决策：要部署到哪一层

配色规则"不生效"有三种成因，对应三种不同程度的处置。**不要跳过诊断直接上 hook。**

| 现象 | 根因 | 该做哪一步 |
|---|---|---|
| 模型根本不知道有这个 skill | skill 不在发现目录里，或 description 没有绘图触发词 | **Step 1**（skill 层） |
| 知道有 skill，但画图时想不起来去读 | 靠模型自觉，长会话里被稀释 | **Step 2**（hook 层） |
| 读过也遵守过，但后面又忘 | 618 行正文根本不会被完整加载 | **Step 1 + Step 3**（内联硬清单） |

**Step 2（hook）会往每一轮上下文注入约 1.2KB 规则，是所有工作区的持续成本。**
它是修改用户环境的行为——**动手前必须先征得用户同意**，并说明成本。
（与本 skill 的立场一致：AI 不得擅自改用户的选择。）

---

## 1. 三层模型

```text
①  skill 层   ~/.claude/skills/mermaid-palette/           ← 可被"发现"
        ↓ 但 discovery 靠 description 匹配，会漏
②  hook 层    ~/.copilot/hooks/*.json → 每轮注入规则       ← 不会漏，但有成本
        ↓ 两者都可能被长上下文稀释
③  冗余层     AGENTS.md / CLAUDE.md 里一行硬清单 + 绝对路径  ← 人写在项目侧，最硬
```

**三层不互斥。** 推荐组合：① + ②，重要项目再加 ③。

---

## 2. 前置检查（先跑，全过再往下）

| # | 检查项 | 怎么查 | 不满足怎么办 |
|---|---|---|---|
| 1 | 有 `node` | `node -v` 输出 `v16` 以上 | 装 Node；脚本是纯 ESM/CJS，无第三方依赖 |
| 2 | skill 已落地 | 存在 `<skill>/scripts/inject-palette-rules.cjs` | 先做 Step 1 |
| 3 | 宿主是 VS Code 且开了 hooks | 用户设置里有 `"chat.useHooks": true` | 提醒用户开启（这是 Preview 功能，需手动开） |
| 4 | 工作区已信任 | 标题栏无"受限模式" | 受限模式下 hook 不执行，需用户信任 |
| 5 | 确认用户确实要装 | —— | **问。** 见 §0 末段 |

> `"chat.useClaudeHooks"` **不需要**开。它只影响 `~/.claude/settings.json` 里的 hook，
> 而本协议部署在 `~/.copilot/hooks/`，两条通路互不相干。

---

## 3. Step 1：skill 层（必做）

把仓库放在**四选一**的位置。选择依据是「谁该共享」。

| 目标 | 路径 | 谁生效 |
|---|---|---|
| ⭐ 只给自己、所有项目 | `~/.claude/skills/mermaid-palette/` | Claude Code + VS Code Copilot（两者都读这里） |
| 只给自己、所有项目（Copilot 专属目录） | `~/.copilot/skills/mermaid-palette/` | VS Code Copilot |
| 团队共享 | `<repo>/.github/skills/mermaid-palette/` | 克隆该仓库的所有人，跟随版本走 |
| 单项目、不想入库 | `<repo>/.claude/skills/mermaid-palette/` | 仅该项目 |

```bash
git clone https://github.com/rj-v-shengsongtao/mermaid-palette.git <目标路径>
```

Windows 下 `~` 即 `%USERPROFILE%`。

**验收**（必须看到 `全部色板达标`）：

```bash
node ~/.claude/skills/mermaid-palette/scripts/check-contrast.mjs --palette
```

---

## 4. Step 2：hook 层（可选，需用户同意）

### 4.1 放哪：`~/.copilot/hooks/`

**不要问用户"你用 Copilot harness 还是 Local harness"。** 答案是同一个目录：

| harness | 自己的事件名风格 | 是否读 `~/.copilot/hooks/` | 输出读哪个字段 |
|---|---|---|---|
| Copilot | camelCase（`sessionStart`） | ✅ 是（默认来源之一） | 顶层 `additionalContext` |
| Local | PascalCase（`SessionStart`） | ✅ 是（来源标为 `copilot-personal`） | `hookSpecificOutput.additionalContext` |

**配置里统一写 PascalCase 就行**（§4.3），两套 harness 都能识别。

依据：VS Code 打包产物里 `chat.hookFilesLocations` 的默认值就是这五个来源
（`k2e("hook") → y_t`）：

```text
.github/hooks                       工作区
.claude/settings.local.json         工作区
.claude/settings.json               工作区
~/.copilot/hooks                    ★ 用户级（全局）
~/.claude/settings.json             用户级，但需 chat.useClaudeHooks
```

`~/.copilot/hooks` 本来就是默认值 → **不需要改任何设置**，放进去就被两套 harness 都扫到。

### 4.2 写配置：任意 `.json`，一个 JSON 服务两套 harness

新建 `~/.copilot/hooks/mermaid-palette.json`（文件名随意，必须 `.json` 结尾）：

```json
{
  "version": 1,
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node \"C:/Users/<你的用户名>/.claude/skills/mermaid-palette/scripts/inject-palette-rules.cjs\"",
        "timeoutSec": 10
      }
    ],
    "SubagentStart": [
      {
        "type": "command",
        "command": "node \"C:/Users/<你的用户名>/.claude/skills/mermaid-palette/scripts/inject-palette-rules.cjs\"",
        "timeoutSec": 10
      }
    ]
  }
}
```

关键点，逐条都不能省：

| 要点 | 说明 |
|---|---|
| **事件名写 PascalCase** | 见 §4.3，`subagentStart` 小驼峰会被静默丢弃 |
| **绝对路径** | hook 执行时 cwd 是**工作区根目录**，不是 hook 目录。相对路径必挂。 |
| **Windows 路径两种写法都行** | JSON 里反斜杠要双写 `C:\\Users\\...`；或整条改用正斜杠 `C:/Users/...`（Node 在 Windows 上照样认，且免去转义） |
| **`SessionStart` 与 `SubagentStart` 各配一条** | 只配主会话的话，子 agent 拿不到规则，独立画图时会退化 |
| **`timeoutSec: 10`** | 脚本自带 1.5s 兜底 emit，正常 ~100ms 返回，不会触顶 |
| **同一目录只放一份** | 见 §7 排障第 1 行 |

> **跨平台更好写法**：`P0r` 解析器支持按平台选命令，可以一条配置跑三系统：
> `{"type":"command","windows":"node \"C:/...\"","linux":"node \"/home/you/...\"","osx":"node \"/Users/you/...\""}`。
> 单机自用不必麻烦，写 `command` 就够。

### 4.3 事件名：必须写 PascalCase

VS Code 解析 hook 配置时有一张归一化表 `M0r`，**表里没有的键会被 `continue` 直接丢弃**（`N0r`：`let u=M0r[l]; if(!u) continue;`）。

| 事件名 | PascalCase | camelCase |
|---|---|---|
| 会话开始 | ✅ `SessionStart` | ✅ `sessionStart` |
| 会话结束 | ✅ `SessionEnd` | ✅ `sessionEnd` |
| 用户提交 | ✅ `UserPromptSubmit` | ✅ `userPromptSubmitted` |
| 工具调用前 | ✅ `PreToolUse` | ✅ `preToolUse` |
| 工具调用后 | ✅ `PostToolUse` | ✅ `postToolUse` |
| 压缩前 | ✅ `PreCompact` | ❌ 无 |
| **子 agent 开始** | ✅ `SubagentStart` | ❌ **没有 `subagentStart`** |
| 子 agent 结束 | ✅ `SubagentStop` | ✅ `subagentStop` |
| 停止 | ✅ `Stop` | ✅ `agentStop` |
| 出错 | ✅ `ErrorOccurred` | ✅ `errorOccurred` |

**结论：全部写 PascalCase，10 个事件都支持，不需要记哪几个能用驼峰。**
写成 `subagentStart` 不会报错、不会警告，**只是那个 hook 永远不触发**——最难查的一类故障。

### 4.4 为什么脚本要"双格式输出"

一个脚本、一次执行、一份输出，同时满足两套 harness：

```js
process.stdout.write(JSON.stringify({
  additionalContext: RULES,                                        // Copilot 读这个
  hookSpecificOutput: {                                            // Local 读这个
    hookEventName: eventName,                                      // 必须是 PascalCase
    additionalContext: RULES,
  },
}));
```

两套 harness 都会忽略自己不认识的字段 → **不会重复注入**，也不用维护两份脚本。

事件名从 stdin 嗅探（不靠外部传参，因为两种 harness 的回调载荷字段名不一样）：

```js
if (/"hook_event_name"\s*:\s*"SubagentStart"/.test(text)) return 'SubagentStart';       // Local
if (/"(agentName|agent_name|agentType|agent_type)"/.test(text)) return 'SubagentStart'; // Copilot
return 'SessionStart';
```

### 4.5 不要用 `chat.hookFilesLocations` 做全局

这个设置**做不到**全局，不要浪费时间：

- 它是 `{路径: boolean}` 对象，**路径只能是工作区相对路径**；
- 解析器对 `~/` 开头的键**显式跳过**（源码里 `n.startsWith("~/") → continue`），
  对 `C:\` 盘符开头、`/` 开头、含 `\` 的值同样拒绝；
- 而 `~/.copilot/hooks` 已经是默认成员，你根本不需要配它。

**结论：全局部署靠"文件放到默认目录"，不靠改设置。**

---

## 5. Step 3：冗余层（重要项目再做）

在项目的 `AGENTS.md`（或 `CLAUDE.md`）里写一行硬约束，**路径必须绝对**：

```markdown
- 画任何 mermaid 图前先过 `~/.claude/skills/mermaid-palette/SKILL.md` 的硬规则：
  B 档色相下沉 + 白字、对比度 ≥3.0、同图 ≤5 色、不擅自改用户指定色相。
```

**不要写成 `.claude/skills/...` 相对路径** —— 多数工作区根下没有 `.claude` 目录，这句会 404 且静默失败。

理由：hook 注入的是上下文（模型可能忽略），文件里写的是项目规约（优先级更高、且人类可审计）。

---

## 6. 验证

### 6.1 脚本层（跨平台、无管道编码坑）

```bash
node -e "const{spawnSync}=require('child_process');const p=process.env.USERPROFILE||process.env.HOME;const s=p+'/.claude/skills/mermaid-palette/scripts/inject-palette-rules.cjs';[['SessionStart',{sessionId:'t',source:'startup'}],['SubagentStart',{hook_event_name:'SubagentStart'}]].forEach(([exp,inp])=>{const r=spawnSync(process.execPath,[s],{input:JSON.stringify(inp),encoding:'utf8'});const j=JSON.parse(r.stdout);console.log(exp,'| exit',r.status,'| top',!!j.additionalContext,'| nested',j.hookSpecificOutput&&j.hookSpecificOutput.hookEventName,'| len',(j.additionalContext||'').length)})"
```

期望两行都是：

```text
SessionStart  | exit 0 | top true | nested SessionStart  | len 800+
SubagentStart | exit 0 | top true | nested SubagentStart | len 800+
```

判据：**exit 0**、**两个字段都非空**、**`nested` 与 `exp` 一致**。

> ⚠️ **不要用 PowerShell 管道喂含中文的 JSON 给这个脚本**（`echo '{"..."}' | node x.cjs`）。
> PowerShell 管道会破坏 UTF-8 编码，`JSON.parse` 报错，看起来像脚本 bug。
> 用上面的 `spawnSync`（走 stdin 二进制），或先把输入写进文件再 `< file.json` 重定向。

### 6.2 fail-open 检查

```bash
node -e "console.log('bad json')" | node <skill>/scripts/inject-palette-rules.cjs
```

期望：仍输出合法 JSON、**exit 0**（hook 报错绝不能阻断用户会话）。

### 6.3 禁用开关检查

```bash
MERMAID_PALETTE_HOOK_DISABLE=1 node <skill>/scripts/inject-palette-rules.cjs
```

期望：输出 `{}`。

### 6.4 端到端（唯一真判据）

**重开一个新会话**（hook 只在会话启动时跑，当前会话不会重载），然后：

1. 随便让它画一张带分支的 mermaid 图，看是否**默认**用了 `#228be6 / #2f9e44 / #f03e3e` 且白字；
2. 故意给它一张 `fill:#4dabf7,color:#fff` 的图问"能读吗"，看是否答出 **2.48 低于 3.0**。

两条都对 → 部署成功。只对第一条 → 规则进去了但校验指令没落地，检查 §4.2 是否漏了 `SubagentStart`。

---

## 7. 排障

| 现象 | 原因 | 处置 |
|---|---|---|
| 规则被注入了两次 | 全局 + 工作区 `.github/hooks/` 各有一份 | 删工作区那份，只留全局。工作区副本可保留一个 `README.md` 说明迁移去向 |
| 新会话没反应 | 当前会话已启动，hook 不热重载 | 真的重开一个会话 / 重载窗口 |
| 完全没有注入 | `chat.useHooks` 没开，或工作区在受限模式 | 让用户开启 + 信任工作区 |
| 报 `Cannot find module` | JSON 里用了相对路径，或用户名写错 | 改成绝对路径，`node -v` 同机验证能跑到该文件 |
| 报 `Unexpected token` | JSON 里 `\` 没转义 | 双写反斜杠，或全改正斜杠 |
| Local harness 没生效 | 输出缺 `hookSpecificOutput` | 用 §6.1 验证 `nested` 列，不是 `undefined` |
| 子 agent 不受约束 | 只配了 `SessionStart`，或写成了 `subagentStart` | 改成 PascalCase `SubagentStart`，见 §4.3 |
| 某个 hook 怎么都不触发，也不报错 | 事件名不在归一化表里 → 静默丢弃 | 改成 §4.3 表中的 PascalCase |
| 会话启动变慢 | 脚本卡在等 stdin | 确认脚本含 `setTimeout(emit, 1500)` 兜底与 `process.stdin.resume()` |
| 中文规则变乱码 | 经过 PowerShell 管道测试 | 是测试手法的问题，不是脚本问题；用 §6.1 |

---

## 8. 卸载（按破坏性从小到大）

| 层级 | 操作 | 影响 |
|---|---|---|
| 临时静音 | 环境变量 `MERMAID_PALETTE_HOOK_DISABLE=1` | 脚本输出 `{}`，配置保留 |
| 全局停用 | 配置 JSON 里加 `"disableAllHooks": true` | 该文件内所有 hook 停用 |
| 移除本 skill 的 hook | 删 `~/.copilot/hooks/mermaid-palette.json` | 只影响本 skill，别家 hook 不动 |
| 彻底移除 | 再删 `<skill>` 目录 | skill 层一起消失 |

**不要**为了让本 skill 停用去删 `~/.copilot/hooks` 整个目录 —— 里面可能还有别人的 hook。

---

## 9. 边界：hook 做不到什么

诚实列出，避免部署完产生错误预期。

| 想做的事 | 能不能 | 说明 |
|---|---|---|
| 每轮把规则塞进上下文 | ✅ | 本协议的能力范围 |
| 强制模型"必须"遵守 | ❌ | hook 是注入上下文，不是强制校验。真正的强制是①交付前跑校验脚本 ②用户验收 |
| 改写用户输入的 prompt | ❌ | `userPromptSubmitted` 的 command 输出会被**丢弃** |
| 拦截"已经写进聊天的 mermaid" | ⚠️ | 聊天里直接画的图没有写盘动作，`preToolUse` 拦不到 |
| 硬性阻断不合规的图 | ⚠️ | 只能用 `agentStop`/`Stop` + `decision:"block"` 逼模型继续修；代价是可能连续 8 次才失效，且要读 `stop_hook_active` 防死循环。**不建议默认开** |
| 提示词注入绕过 | —— | 规则里有具体 hex 和数字，被无关长文冲淡的概率低于纯文字规约，但非零 |

---

## 10. 一页速查（给急着动手的 AI）

```text
1. 问用户：要不要装全局 hook？（每轮 ~1.2KB 成本）
2. git clone → ~/.claude/skills/mermaid-palette
3. node ~/.claude/skills/mermaid-palette/scripts/check-contrast.mjs --palette   # 见"全部色板达标"
4. 写 ~/.copilot/hooks/mermaid-palette.json（PascalCase 事件名 + 绝对路径）
5. 跑 §6.1 验证：两行都 exit 0 / top true / nested 正确
6. 让用户重开会话，按 §6.4 两条行为验收
```

**四个最常见的坑，按出现频率排序：**
1. 在 JSON 里写了相对路径 → hook 的 cwd 是工作区根目录，必挂。
2. 事件名写了 `subagentStart` → 不在归一化表里，**静默丢弃、永不触发、不报错**。用 `SubagentStart`。
3. 全局和工作区各放一份 → 双重注入。删工作区那份。
4. 试图用 `chat.hookFilesLocations` 配 `~/` 路径 → 解析器显式跳过，白费功夫。

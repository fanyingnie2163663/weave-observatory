# dsh-client-ui-weave

把 Weave 多智能体协作观测台做成 DSH Web 的**会话视图**（标签名「织造」）。

## 结构

```
package.json        # dsh.client / dsh.bundle 声明
cordis.patch.yml    # bundle patch：插入 ui-weave 加载项
lib/index.js        # host 半：空 apply（观测台是纯浏览器 UI）
lib/client.js       # 构建产物：window.__ModuleLoader__.load(...) 客户端包
src/mapping.mjs     # DSH 快照 -> WEAVE_DATA 映射（纯函数）
src/client.template.js  # 视图与 iframe 桥
build.mjs           # 内联 weave-embed/dist/weave-runtime.mjs 的 WEAVE_HTML，生成 lib/client.js
install.mjs         # 安装/启用辅助（默认 dry-run；--apply 才写 profile）
```

## 构建

```bash
# 1) 先构建 iframe 运行时（子代理产出）
node ../weave-embed/build.mjs
# 2) 再构建客户端包
node build.mjs
```

没有 `weave-embed/dist/weave-runtime.mjs` 时会内联一个 fallback 页面（只显示提示），方便先验证插件接线。

## 安装（需用户确认）

```bash
node install.mjs            # 只看计划
node install.mjs --apply    # 写入 desktop profile（会备份 package.json）
```

之后完全退出 DSH 再打开；在会话头部的视图标签选「织造」。卸载：删除 profile package.json 中的依赖与 bundles 条目，并删除 `node_modules/dsh-client-ui-weave` 链接。

## 当前状态（2026-11-26）

- **插件 v0.1 已构建并可静态验证**：`dsh-client-ui-weave/lib/client.js`（264 KB，内联真实 WEAVE_HTML 226 KB）。
- **两套离线夹具通过**：
  - `node dsh-client-ui-weave/test-smoke.mjs` → `ok: true`：注册 `conversation.view id=weave`（label 织造）、4 个事件 Definition、模拟会话事件 → WEAVE_DATA（agents/work、tasks、events、blocker、token），并通过 `validateWeaveData`（problems: []）。
  - `node tools/test-client-bundle.mjs --bundle dsh-client-ui-weave/lib/client.js --expect-id weave` → `ok: true`（materialize + apply + 注册形状；官方 stats 包对照通过）。
- **iframe 运行时可用**：`weave-embed/dist/preview.html` 在 ego 浏览器实测渲染 Silk UI，收发 `weave:ready/init/update/theme/event`（截图 `_shots/embed-preview.png`）。
- **契约文档**：`docs/dsh-weave-contract.md`（注册 props、ModuleLoader、dsh 字段、数据源、映射规则、激活方式与需实测清单）。
- **未做（需用户同意）**：写入 `~/.dsh/profiles/desktop`、重启 DSH、GUI 内验收。见 `ACTIVATE.md`。

### 已验证命令

```bash
node dsh-client-ui-weave/build.mjs
node dsh-client-ui-weave/test-smoke.mjs
node tools/test-client-bundle.mjs --bundle dsh-client-ui-weave/lib/client.js --expect-id weave
```

### v0.1.1（2026-11-26 09:40 CST）

- 修复「已结算工作捅出时间织带」：`subagentTiming.settledMs` 是累计时长而非时间点，现以子代理最后更新时间锚定并把所有工作段 clamp 在 `[0, timeline]`；泳道长名称改为单行省略。
- 修复「一直等待会话数据」：`weave:init` 改为 iframe onLoad + `weave:ready` + 600ms 重试（收到首个 `weave:event` 视为确认），连接中在 iframe 左下角显示状态提示；不再依赖 Ready 消息恰好晚于监听。
- 事件流过滤内部上下文消息（runtime-context / time-context），不再把 “Time sampled while preparing turn…” 这类文案当成用户事件。
- 重建：`node weave-embed/build.mjs`（25/25 校验）→ `node dsh-client-ui-weave/build.mjs`；离线夹具 `test-smoke` 与 `tools/test-client-bundle.mjs` 均通过。
- **生效方式：完全退出 DSH 再重开**（host 启动时固化 client bundle 的 rev，刷新页面不够）。

### v0.1.2（2026-11-26 10:05 CST）

- **等待页新增「读取本地历史数据」**：iframe 占位页内按钮 + 视图右上角 chip（已连接但数据稀疏时显示）；点击走官方 `session.loadOlder()` 分页补读当前会话历史，状态（已读取 N 页 / 还有更早 / 失败原因）回显到占位页与 chip。
- **织带改为活动压缩时间轴**：块由主代理 turn + 子代理工作区间合并（间隔 ≤12s 保留），大空闲间隔压缩到 3s；`meta.duration` = 压缩后活动时长。任务条按 owner 工作窗口切成相对「小格」，不再整条铺满。
- 兼容既有夹具：704s 墙钟样例被压缩为 24s 活动轴，所有工作段/任务/事件仍在轴内；历史分页夹具返回 2 页。
- 生效：**完全退出 DSH 再重开**（client bundle rev 在 host 启动时固化）。


### v0.1.3（2026-11-26 14:30 CST）

- 背景水印由单字「织」改为「织造」（v2/styles.css `.stage::after`：176px 宋体、右下角、纸/夜两主题沿用原透明度），视觉上填补主图右侧空白。
- 重新构建：weave-embed（25/25 校验）→ dsh-client-ui-weave/lib/client.js（280,940 B）；smoke 夹具 ok。
- 生效：**完全退出 DSH 再重开**（bundle rev 在 host 启动时固化）。


### v0.1.4（2026-11-26 15:05 CST）

- 时间显示修复：活动压缩时间轴此前以浮点秒输出（如 `183.59999999999999`），原型时钟格式化不取整 → 出现 `03:03.5999999999999943`。现所有时间字段（duration / work 段 / tasks / events）统一取整到**整秒**，夹具新增「必须为整数」断言。
- 嵌入模式隐藏原型左右栏拖拽手柄（`body.weave-embed .splitter { display:none }`）：DSH 视图内使用固定自适应布局，不再能拖动 Weave 内部栏宽（之前被误认为在拖「对话框」大小）。
- 重建：embed 运行时 19/19 校验、插件 `lib/client.js`（281,275 B）、smoke + 契约夹具通过。
- 生效：**完全退出 DSH 再重开**。


### v0.1.5（2026-11-26 18:20 CST）

- 智能体节点印章字符偏移：`buildNodes` 里 `icon(a.icon)` 直接作为按钮的第二个 grid 子项，占掉一行，导致 `::before` 印章字被推到上半格（高密度档尤其明显）。现按样式本意包进 `<span class="node-icon">`，由 `.node-icon{display:none}` 隐藏，按钮内只剩印章 → 字符居中。
- 选中朱环 is-tight 档位错位修正（见 v0.1.4 之后的补丁）：crowded/swarm/hive 各自覆盖 top/尺寸，不再沿用 5–7 位智能体的 29px。
- 验证：13 个智能体、stage 317px（is-tight）下，印章墨迹中心与按钮中心偏差 ≈1px（修复前纵向偏 ~7px）。


### v0.1.6（2026-11-26 18:35 CST）

- 修复「没有实时表现」：`weave:update` 原来是 180ms **可取消防抖**，每次快照变化都 `clearTimeout`。DSH 对每个事件（含流式增量）都会发布 Conversation 快照，往往快于 180ms，导致计时器几乎永远被重置，iframe 长时间停在上一次数据（会话仍在跑却显示已完结）。改为**单一 trailing 定时器**（不取消，触发时读 `latestRef.current`）→ 更新不再被饿死。
- 数据源侧增加 1.5s 轻量 tick（仅在视图订阅期间），让「已用时/当前动作」在安静阶段也持续前进。
- 用真实会话日志（2,901 事件）离线回放四个 Definition：得到 463 个节点（12 turns / 72 prompts / 184 calls / 195 assistant），确认事件折叠与目标注册逻辑本身正常，问题在视图→iframe 的更新泵。


### v0.1.7（2026-11-26 19:05 CST）— 根因清理 + 树状布局

**同一更新模型的根因修复（一批）**
- reload 保留 filter / feed 滚动 / inspector 滚动（恢复移到 rebuild 的 rAF 之后）/ 织带收起态 / 暂停态（非 live 时恢复 wasPlaying）；hydrateStatic 不再把 elapsed 归零。
- 适配层 no-op 数据签名跳过重建；重复 weave:init 不再 seek(0)。
- 直播回看：用户拖动后立即退出 live（child 置 liveMode=false + 发 mode），父视图只有 live-jump 才恢复 live；修复“拖回看被 150ms 弹回末尾”。
- 宿主主题变化转发 weave:theme；source 按 (weave 快照, list 快照, 秒桶) 记忆化，避免每个流式增量重算整份映射。
- Definition：turn 节点只匹配 turn/start|end（13 轮从 412 次匹配降到 25 次），显著降低目标 flush。
- 数据：任务 owner 计数按解析后 id；阻塞带只覆盖 blocked 任务；用 agent/team prompt 合成协作 messages；真实 token 用量经 meta.tokens 传入 edition（不再显示模拟 token）。
- 高密度节点：徽标随密度缩小、名字两行截断。

**树状布局（按 DSH 会话谱系）**
- mapping 读取 subagent summary.parentSessionId 解析 parent；app 新增 tidy 树布局：根在顶部，子代按行铺开、按宽自适应每行容量（窄屏 3 起），无谱系演示数据仍用菱形/环形。
- 边改为“子代理连父代理”，不再全部直连主智能体。


### v0.1.8（2026-11-26 19:20 CST）— 审计驱动的第二批根因修复

- **时间轴起点**：`SessionSummary` 没有 createdAt，旧代码用 updatedAt（≈ 最近一条人类 prompt）做原点，导致 263/278 事件 t=0、每来一条 prompt 时间轴重置。改为取已加载快照内最早的 turn.startTime / event.time。
- **子代理工作窗**：settledMs 是从创建时刻向前的累计时长，旧代码从 updatedAt 往回画，条带落在子代理创建之前。改为 `createdAt → createdAt + settledMs`。
- **子代理运行态**：catalog 没有 activity 字段；改读 `projectionsBySession[id].values.subagentTiming/tokenUsage` 与 `summary.running`。
- **消息/actor**：真实 relay 消息用 `source.senderSessionId`，旧解析只认文本前缀 → actor 永远主代理、协作 messages 恒空；已支持。
- **PTC 子工具**：新增 weave-ptc Definition，投影 `tool/ptc-dispatch(-start)`（真实 ops_bash/glob/... 不再只剩 run_code 一行）。
- **usage**：assistant 消息用 inputTokens（旧代码只认 uncachedInputTokens），并接受 totalTokens 兜底。
- **任务板**：deps 映射 blockedBy；blocker 覆盖非 completed 的未就绪任务，不再回退全任务跨度。
- **meta**：runId 去 session- 前缀、project 取 cwd basename、branch 留空、playbackSeconds = duration（1×，不再硬编码 80）。
- **事件上限** 600 行，避免整份快照无界增长。
- **插件生命周期**：source 随 binding generation 重新绑定 target；发送 update 不再依赖 acked；registration 拆分 try；主题 MutationObserver 去重；host style 去重；历史分页一次最多 16 页并检查 openState/loadingOlder、失败返回原因。
- **直播回看**：用户拖动即退出 live，livebar 在回放态保留「回到最新」入口，点击恢复直播。
- **矮视口布局**（932×353 停靠）：新增 max-height:560px embed 规则，隐藏 header/rails/footer，主图+折叠织带一屏内。
- **高密度视觉**：选中环按按钮尺寸留稳定间距（74/66/56/50）、徽标随密度缩小、节点名截断、历史 chip 下移避开 masthead、隐藏失效 tip/footer。
- **树状布局**：按 DSH 会话谱系（summary.parentSessionId）根在顶部、子代按行铺开、每行容量随宽度自适应；edge 改为子代理连父代理；无谱系原型数据仍用菱形/环形。
- 已知限制：任务窗口仍是按 owner 工作窗的近似（非真实 task 时间戳）；子代理历史仍依赖投影近似；`make-weave-app.mjs` 在源码丢失后改为维护 `src/weave-app.js` 的构建 shim。


### v0.1.9（2026-11-26 19:30 CST）

- 子智能体显示名改为甲乙丙丁…癸的顺序（第 11 个起 甲2/乙2…），不再显示内部会话名；原始名保留在 `agents[].title` 供后续 tooltip 使用。
- 节点朱印同步跟随命名：子代理印章取名字首字（甲/乙/丙…），主代理仍用「编」；热更新新增成员也遵循同一规则。
- 事件流 actor/tag 使用命名后的显示名。


### v0.2.0（2026-11-26 19:40 CST）

- 圆圈朱印改为按天罡三十六星字顺序：魁、罡、机、闲、勇、雄、猛、威、英、贵、富、满、孤、伤、立、捷、暗、佑、速、异、杀、微、究、退、寿、剑、平、罪、损、败、牢、慧、暴、哭、巧…；主代理保留「编」。
- 节点下方的白字恢复为**功能总结**：取子代理 catalog 的 name/label/displayTitle（如“检索规范/数据核对/界面走查”），不再用甲乙序号；原始长名保留在 `agents[].title`。
- 朱印由数据侧 `agents[].seal` 提供，edition 的首次渲染与热更新新增成员都优先使用该字段。
- 事件流 actor/tag 仍使用功能名。


### v0.2.1（2026-11-26 19:50 CST）

- 树状图默认收起闲置分支（类似 DSH 侧边栏会话树）：可见集 = 主代理 + 运行中的子代理及其祖先路径；闲置子代理隐藏。
- 每个有闲置子代理的节点右侧出现 `+N` 小徽标：点击展开一层（显示直接子代理），再点 `−` 收起；子节点各自继续逐层展开。
- `state.expanded` 随数据刷新保留；新增的闲置成员会跟随父级展开状态；隐藏节点同时隐藏其边，布局只对可见节点重新排布。
- 修复 `renderStage` 用 `className` 整体重写节点类导致 `is-tree-hidden` 被抹掉的问题。
- 运行态来自 mapping 的 `agents[].running`（summary.running / subagentTiming.active）；没有 running 字段的演示数据保持全展开。


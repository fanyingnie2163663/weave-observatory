/* Weave · 多智能体协作观测台 — 场景数据
 * 这是一个脚本化的演示运行（非实时遥测），用于展示多智能体协作的
 * 可观测信息：谁在做什么、工作如何流转、为什么得到这个结果。
 * 时间单位：虚拟秒（0–700），1x 播放约 80 秒放完。
 */
window.WEAVE_DATA = {
  meta: {
    runId: "A7F3",
    project: "pay-gateway",
    branch: "fix/idempotency-layer",
    goal: "重构支付网关幂等层，消除重复扣款",
    shortGoal: "支付网关 · 幂等层重构",
    startedAt: "09:14",
    duration: 700,
    playbackSeconds: 80,
    simulated: true
  },

  agents: [
    {
      id: "atlas", name: "Atlas", roleCn: "编排者", roleEn: "LEAD",
      icon: "compass", color: "#E7EFFA", model: "reasoner · 64k",
      work: [
        { s: 0,   e: 20,  label: "目标拆解", activity: "拆解目标与依赖", task: null },
        { s: 150, e: 240, label: "方案设计", activity: "设计幂等状态机", task: "T2" },
        { s: 240, e: 430, label: "协调实现", activity: "协调实现与答疑", task: null },
        { s: 430, e: 470, label: "阻塞研判", activity: "研判竞态与解阻方案", task: null },
        { s: 470, e: 600, label: "解阻与跟踪", activity: "裁决阻塞并跟踪修复", task: null },
        { s: 600, e: 690, label: "验收交付", activity: "验收与汇总交付", task: null }
      ]
    },
    {
      id: "scout", name: "Scout", roleCn: "研究员", roleEn: "RESEARCHER",
      icon: "search", color: "#64C4FF", model: "reasoner · 32k",
      work: [
        { s: 20,  e: 150, label: "事故取证", activity: "分析扣款工单与日志", task: "T1" },
        { s: 590, e: 650, label: "灰度回放", activity: "镜像回放生产流量", task: "T6" },
        { s: 650, e: 690, label: "指标汇总", activity: "汇总回放指标", task: null }
      ]
    },
    {
      id: "forge", name: "Forge", roleCn: "实现者", roleEn: "BUILDER",
      icon: "code", color: "#FFB45C", model: "coder · 128k",
      work: [
        { s: 205, e: 430, label: "幂等实现", activity: "编写占位表与请求指纹", task: "T3" },
        { s: 470, e: 560, label: "竞态修复", activity: "修复占位状态机竞态", task: "T5" },
        { s: 560, e: 600, label: "并发补强", activity: "补强并发测试用例", task: null }
      ]
    },
    {
      id: "lens", name: "Lens", roleCn: "审查者", roleEn: "REVIEWER",
      icon: "shield", color: "#B79CFF", model: "reviewer · 64k",
      work: [
        { s: 352, e: 470, label: "安全评审", activity: "评审并发窗口与迁移", task: "T4" },
        { s: 548, e: 600, label: "复核签字", activity: "复核修复与签署风险", task: null }
      ]
    },
    {
      id: "quill", name: "Quill", roleCn: "撰写者", roleEn: "WRITER",
      icon: "pen", color: "#5EE3B0", model: "writer · 32k",
      work: [
        { s: 240, e: 470, label: "报告初稿", activity: "撰写架构与风险章节", task: "T7" },
        { s: 470, e: 520, label: "补充风险", activity: "补充阻塞与风险章节", task: "T7" },
        { s: 520, e: 656, label: "报告定稿", activity: "定稿交付报告", task: "T7" }
      ]
    }
  ],

  tasks: [
    { id: "T1", title: "事故取证与日志分析", owner: "scout", start: 20,  end: 150, deps: [] },
    { id: "T2", title: "幂等方案设计",       owner: "atlas", start: 150, end: 240, deps: ["T1"] },
    { id: "T3", title: "幂等层实现",         owner: "forge", start: 205, end: 430, deps: ["T2"] },
    { id: "T4", title: "安全与并发评审",     owner: "lens",  start: 352, end: 470, deps: ["T3"] },
    { id: "T5", title: "竞态修复",           owner: "forge", start: 470, end: 560, deps: ["T4"] },
    { id: "T6", title: "灰度镜像回放",       owner: "scout", start: 590, end: 650, deps: ["T5"] },
    { id: "T7", title: "交付报告",           owner: "quill", start: 240, end: 656, deps: ["T1"] }
  ],

  blocker: {
    from: 430, to: 578,
    title: "并发竞态阻塞",
    detail: "Lens 发现幂等占位记录可被并发重试覆盖"
  },

  events: [
    { t: 0,   type: "decision", actor: "atlas", text: "接收目标并启动编排：重构支付网关幂等层，消除重复扣款", tag: "目标" },
    { t: 8,   type: "decision", actor: "atlas", text: "建立任务依赖图：取证 → 设计 → 实现 → 评审 → 验证 → 交付", tag: "计划" },
    { t: 20,  type: "delegate", actor: "atlas", target: "scout", text: "委派事故取证：近 30 天重复扣款工单与网关重试日志", tag: "T1" },
    { t: 62,  type: "tool",     actor: "scout", text: "logs.query(duplicate_charge, 30d) → 128 条工单", tag: "logs.query" },
    { t: 96,  type: "insight",  actor: "scout", text: "重试窗口内 idempotency-key 未落库，命中率 0.42%", tag: "关键发现" },
    { t: 132, type: "tool",     actor: "scout", text: "trace.replay(47 条样本) → 复现率 100%", tag: "trace.replay" },
    { t: 150, type: "message",  actor: "scout", target: "atlas", text: "取证完成：锁定 3 类触发路径，47 条样本已归档", tag: "T1", tone: "good" },
    { t: 176, type: "decision", actor: "atlas", text: "采用「写前占位 + 唯一索引」双重幂等方案", tag: "方案" },
    { t: 205, type: "delegate", actor: "atlas", target: "forge", text: "实现幂等占位表、请求指纹与重试保护", tag: "T3" },
    { t: 240, type: "delegate", actor: "atlas", target: "quill", text: "开始撰写交付报告：架构、风险与上线建议", tag: "T7" },
    { t: 268, type: "tool",     actor: "forge", text: "读取 pay-gateway/retry.ts（812 行）", tag: "read" },
    { t: 300, type: "tool",     actor: "forge", text: "生成迁移脚本 001_idempotency.sql", tag: "migrate" },
    { t: 336, type: "artifact", actor: "forge", text: "提交 idempotency.ts · 214 行", tag: "src" },
    { t: 352, type: "delegate", actor: "atlas", target: "lens", text: "评审幂等设计与迁移脚本，重点并发窗口", tag: "T4" },
    { t: 372, type: "tool",     actor: "lens",  text: "review(diff) → 4 处待确认", tag: "review" },
    { t: 390, type: "message",  actor: "lens",  target: "forge", text: "并发重试可能覆盖占位记录，请确认 CAS 语义", tag: "关注", tone: "warn" },
    { t: 411, type: "tool",     actor: "forge", text: "运行 thread-race.spec.ts → 2/28 失败", tag: "test" },
    { t: 430, type: "alert",    actor: "lens",  text: "确认竞态：并发重试可覆盖幂等占位", tag: "高风险", tone: "alert" },
    { t: 444, type: "message",  actor: "lens",  target: "atlas", text: "阻塞上报：建议改为原子 CAS 状态机", tag: "阻塞", tone: "alert" },
    { t: 458, type: "decision", actor: "atlas", text: "暂停灰度，进入修复；目标 10 分钟内解阻", tag: "决策" },
    { t: 470, type: "delegate", actor: "atlas", target: "forge", text: "修复竞态：占位状态机 + 并发测试", tag: "T5" },
    { t: 483, type: "message",  actor: "quill", target: "atlas", text: "报告初稿完成，等待修复结论合并", tag: "T7" },
    { t: 505, type: "tool",     actor: "forge", text: "生成迁移 002_idempotency_state.sql", tag: "migrate" },
    { t: 522, type: "artifact", actor: "forge", text: "提交 race-fix.patch · +96 −18", tag: "diff" },
    { t: 536, type: "tool",     actor: "forge", text: "test idempotency.concurrent → 28/28 通过", tag: "test" },
    { t: 548, type: "message",  actor: "forge", target: "lens", text: "修复完成，请复核并发窗口", tag: "复核", tone: "warn" },
    { t: 563, type: "tool",     actor: "lens",  text: "replay(2000 并发) → 0 覆盖", tag: "replay" },
    { t: 578, type: "message",  actor: "lens",  target: "atlas", text: "复核通过，风险降级为低", tag: "解阻", tone: "good" },
    { t: 590, type: "delegate", actor: "atlas", target: "scout", text: "执行 5% 灰度镜像回放", tag: "T6" },
    { t: 604, type: "tool",     actor: "scout", text: "shadow-replay → 45,120 请求", tag: "replay" },
    { t: 618, type: "insight",  actor: "scout", text: "重复扣款 0 命中；P99 +3ms", tag: "指标" },
    { t: 622, type: "message",  actor: "scout", target: "atlas", text: "灰度回放通过：0 重复扣款，P99 +3ms", tag: "T6", tone: "good" },
    { t: 640, type: "artifact", actor: "quill", text: "归档《幂等层重构交付报告》· 12 节", tag: "doc" },
    { t: 656, type: "message",  actor: "quill", target: "atlas", text: "报告定稿：含架构、风险与上线建议", tag: "T7", tone: "good" },
    { t: 672, type: "decision", actor: "atlas", text: "验收通过：建议下周一 10% 灰度 → 全量", tag: "验收" },
    { t: 690, type: "message",  actor: "atlas", target: "all", text: "交付完成：7 工作项 · 1 次阻塞解除 · 2 次复核", tag: "完成", tone: "good" }
  ],

  messages: [
    { t: 20,  from: "atlas", to: "scout", travel: 26, tone: "delegate" },
    { t: 150, from: "scout", to: "atlas", travel: 26, tone: "good" },
    { t: 205, from: "atlas", to: "forge", travel: 26, tone: "delegate" },
    { t: 240, from: "atlas", to: "quill", travel: 26, tone: "delegate" },
    { t: 352, from: "atlas", to: "lens",  travel: 26, tone: "delegate" },
    { t: 390, from: "lens",  to: "forge", travel: 26, tone: "warn" },
    { t: 444, from: "lens",  to: "atlas", travel: 26, tone: "alert" },
    { t: 470, from: "atlas", to: "forge", travel: 26, tone: "alert" },
    { t: 483, from: "quill", to: "atlas", travel: 26, tone: "info" },
    { t: 548, from: "forge", to: "lens",  travel: 26, tone: "warn" },
    { t: 578, from: "lens",  to: "atlas", travel: 26, tone: "good" },
    { t: 590, from: "atlas", to: "scout", travel: 26, tone: "delegate" },
    { t: 622, from: "scout", to: "atlas", travel: 26, tone: "good" },
    { t: 656, from: "quill", to: "atlas", travel: 26, tone: "good" },
    { t: 690, from: "atlas", to: "scout", travel: 7, tone: "good" },
    { t: 692, from: "atlas", to: "forge", travel: 7, tone: "good" },
    { t: 694, from: "atlas", to: "lens",  travel: 7, tone: "good" },
    { t: 696, from: "atlas", to: "quill", travel: 7, tone: "good" }
  ]
};

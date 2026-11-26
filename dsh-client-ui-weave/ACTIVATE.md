# 激活与验收（Weave 会话视图 v0.1）

> **状态：已安装到 desktop profile（2026-11-26 08:44 CST）。等待重启 DSH 验收。**
> 安装备份：`package.json.bak-weave-2026-11-26T00-44-36-233Z`。

## 已完成

1. `weave-embed/dist/weave-runtime.mjs` 已构建并验证（226,696 chars；预览页 0 运行错误）。
2. `dsh-client-ui-weave/lib/client.js` 已内联该运行时（264,587 chars），两套离线夹具通过。
3. 已写入 `%USERPROFILE%\.dsh\profiles\desktop`：
   - `package.json`：dependencies 增加 `"dsh-client-ui-weave": "file:<本仓库路径>/dsh-client-ui-weave"`；
   - `dsh.profile.bundles` 追加 `dsh-client-ui-weave`；
   - `node_modules/dsh-client-ui-weave` junction → 本仓库包；
   - 包内 `cordis.patch.yml`（`dsh.bundle.patch`）会插入 Loader 行 `ui-weave`。

## 下一步（需要你做）

**完全退出 DSH（含托盘图标）再重新打开**，然后：

1. 打开任意会话，在会话头部视图标签环选择「织造」。
2. 检查验收清单（下方）。会话空时是占位；有 Team/子代理/工具调用时会逐步出现节点、泳道、事件流。

## 验收清单

- [ ] 视图标签出现「织造」，点击后无白屏/无 console 错误；
- [ ] 主代理 + 子代理节点（有子代理时）；空会话显示占位；
- [ ] 泳道/时间轴可交互（播放、拖动、1/2/4 倍速、F 聚焦、T 折叠织带、滚轮缩放）；
- [ ] 明暗主题跟随 DSH；
- [ ] 事件流来自真实会话（用户消息、工具调用；团队消息带 sender）；
- [ ] Chat / 轨迹 / 统计视图切换正常，无回归；
- [ ] 页面布局在 DSH 视图区域内无溢出/遮挡（v0.1 首验重点）。

## 如果 DSH 启动失败或插件报错

优先回滚（重启前也可先备份当前 profile）：

```bat
copy "%USERPROFILE%\.dsh\profiles\desktop\package.json.bak-weave-2026-11-26T00-44-36-233Z" "%USERPROFILE%\.dsh\profiles\desktop\package.json"
rmdir "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-client-ui-weave"
```

然后重启 DSH；把启动日志/控制台报错发我，我按 `docs/dsh-weave-contract.md §5.4` 的风险清单排查。

## 已知边界（v0.1）

- `agentTeam` 投影没有任务时间戳：任务/阻塞的时间窗是插件侧近似，泳道以工作段与轮次为主。
- 消息边暂不绘制（等待真实 send_message 工具 args 结构确认）；事件流已包含团队消息 prompt。
- Token 为投影累计 + 原型侧线性近似；审批等待、compaction 事件暂未映射。
- iframe 内是完整 Weave Silk UI（独立主题/键盘），与 DSH 全局快捷键可能重叠（聚焦 iframe 时以 Weave 为准）。
- 更新 `lib/client.js` 后通常需刷新页面（HMR/重启策略待实测）。


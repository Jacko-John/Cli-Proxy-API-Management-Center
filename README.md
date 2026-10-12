# Cli-Proxy-API-Management-Center

> 本仓库为上游 Web UI 项目的二次开发版本。
>
> 原始/基础功能请参考上游仓库：https://github.com/router-for-me/Cli-Proxy-API-Management-Center

> [!IMPORTANT]
> 兼容说明：官方 CPA 已移除使用统计 API。
>
> 如需使用本 fork 的「监控中心」完整功能，必须搭配本 fork 适配的插件：
> https://github.com/Fwindy/cpa-usage-statistics

本 README 只记录 **本 fork 相对上游新增/增强的功能点**。

## 本 fork 新增/增强功能

### 新增监控中心页面

- 类似于使用统计界面，但界面美化&增强。
  - 新增「花费与Token」趋势图。
  - 新增「模型使用分布」统计。

- 增强凭证统计
  - 新增凭证花费统计
  - 对于Codex凭证：可一键刷新配额，并根据配额的截止时间往前倒推统计5h花费/周花费。

- 增强请求事件明细：
  - 支持自动刷新（15s/30s/1m/5m）
  - 新增Tokens per second (TPS) 统计
  - 新增首字延迟统计
  - 点击每行前方的减号图标可以删除记录
  - 新增缓存命中率统计
  - 当请求失败时，可点击“失败”查看失败日志（实际上是该凭证的最新状态日志，非精确的请求日志）。

- 一键导入模型价格
  - 从 https://models.dev/api.json 拉取最新价格并导入，对于多Provider的模型，可以手动指定优先用哪个Provider的价格
  - 仅对 **已有使用记录** 的模型进行匹配与同步
  - 支持CPA模型名称映射，例如把CPA中的coder-model先映射为qwen3.6-plus后再进行价格匹配

### 新增凭证中心页面

- Codex 凭证池统计
  - 支持「刷新全部」「刷新未获取」两个批量刷新入口，可设置刷新间隔秒数，并显示批量刷新进度。
  - 展示 7天预估总额度、7天预估剩余额度，以及 Codex 凭证数和未获取额度数量。
  - 按 Codex 类别展示凭证数、已获取额度数、7天预估总额度、7天预估剩余额度、单凭证7天平均额度。
  - 按固定百分比分档展示各凭证的 7 天配额剩余情况，适合大量凭证快速观察分布。

- Antigravity 凭证额度
  - 按 Claude / Gemini 模型分组展示 Antigravity 凭证的剩余额度百分比与配额重置时间。
  - 结合已导入的模型价格估算各分组的剩余可用花费。

## 自动同步与发布

- `.github/workflows/sync-upstream.yml` 每 6 小时检查一次上游最新的正式 Release，不跟随上游 `main` 的普通提交发布。
- 工作流合并对应的精确上游 Tag，执行完整测试、ESLint 和生产构建，成功后发布单文件 `management.html`。
- 路由、侧栏和翻译等 fork 扩展独立维护；`scripts/upstream/source-patches.ts` 定义源码接入补丁，按 TypeScript 语法节点重新应用到每次发布的上游源码，不依赖行号或相邻代码。上游新增语言、路由、菜单及导出会保留。
- `scripts/upstream/repository.ts` 声明 fork 专属命名空间，覆盖 `src/fork/`、通知功能目录及其 API、插件传输和翻译模块。同步前检查上游基线与目标 Release 的完整文件树；即使 Git 能自动合并，上游占用这些路径、在其中新增文件或用文件阻塞其父目录时，也会先退出并报告路径。归属无冲突后，专属源码按 fork 原样保留；其他上游源码继续正常合并。
- `.github/upstream-sync.json` 记录精确的上游基线；同步前校验接入文件的 fork 改动已完整纳入补丁，遗漏的改动会报错，避免被覆盖。维护新的接入点后，运行 `bun scripts/apply-fork-patches.ts` 重新生成接入文件。
- JSON 配置按键进行三方合并；Bun 锁文件采用上游更新与 fork 增量，再由 Bun 重新解析和校验。两边对同一个配置值的不同修改需要审查，不会盲目覆盖。
- fork 文案维护在 `forkTranslations.ts` 及功能自己的翻译模块；上游语言包每次采用精确 Tag 的原始内容，再统一补齐缺失或无效文案。上游补上正式翻译后自动替换回退内容，新增和删除语言也自动跟随。
- 测试使用 `bun test --isolate`，每个文件独立运行，避免语言状态和 mock 在文件之间泄漏；本地仍使用 `bun run verify` 完整校验。
- 补丁 Release 使用 `<上游Tag>-patch.N`，例如 `v1.22.12-patch.1`；同一上游版本默认只发布一次。
- 可通过 `workflow_dispatch` 指定正式上游 Tag；同步拒绝早于当前基线的版本。启用 `force_release` 时为相同上游版本发布下一个 patch 版本；重新执行源码同步不会重复叠加补丁。
- 验证通过后才提交和推送 `main` 并发布；接入接口变更、业务冲突或验证失败时，Action 保留日志、冲突路径和候选源码补丁供审查。

这些规则保证明确归属的源码保留，并拦截声明范围内的路径与接入冲突。上游共享组件、客户端或依赖库可能在接口类型不变时改变行为；这类语义兼容仍需围绕外部契约审查，不能仅凭构建或测试通过下结论。

## 使用方法

在CPA的配置面板中，设置面板仓库为本仓库地址后，强制刷新（Ctrl+F5）页面

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg)](https://linux.do/)

## License

MIT

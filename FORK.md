# 插件管理扩展

> 本仓库为上游 Web UI 项目的二次开发版本。
>
> 原始/基础功能请参考上游仓库：https://github.com/router-for-me/Cli-Proxy-API-Management-Center

> [!IMPORTANT]
> 兼容说明：官方 CPA 已移除使用统计 API。
>
> 如需使用本 fork 的「监控中心」完整功能，必须搭配本 fork 适配的插件：
> https://github.com/Jacko-John/cpa-usage-statistics
>
> 从 `v1.26.1-patch.2` 起，配套独立插件 ID 为 `jacko-usage-statistics`，后端版本从 `v0.5.0` 起。新面板使用该 ID 的接口；旧 `usage-statistics` 插件请按后端 README 迁移，继续使用原数据目录，并停用旧实例。

插件商店自有源：`https://raw.githubusercontent.com/Jacko-John/cpa-usage-statistics/main/registry.json`。宿主配置的 `remote-management.panel-github-repository` 请指向 `https://github.com/Jacko-John/Cli-Proxy-API-Management-Center`，自动更新将下载本仓库发布的 `management.html`。

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

本仓库以上游正式 Release 为基础，只维护自有插件的管理功能及必要接入。

- 公共面板源码、README、AGENTS、翻译目录、构建配置、测试脚本和工具链采用精确上游版本。
- 插件新增文件在 `scripts/upstream/repository.ts` 中显式登记；同步前检查上游是否占用这些路径，并拒绝未登记的 fork 改动。
- 路由、侧栏、翻译注册和 API/类型导出通过 `scripts/upstream/source-patches.ts` 的五处接入补丁生成；上游接入结构发生变化时停止同步并报告。
- `package.json` 仅增加插件图表所需依赖；上游已有同名依赖时采用上游版本。依赖锁文件由目标版本的 Bun 解析。
- 同步工作流分别按同步前、同步后的 `package.json.packageManager` 安装 Bun，验证完成后才推送源码和发布单文件 `management.html`。
- 默认每 6 小时检查正式 Release，发布版本为 `<上游Tag>-patch.N`；手动运行可指定正式 Tag，拒绝回退到当前基线之前。

### 手动审批发布

Actions 中的 **Manual Upstream Release** 与自动同步共用同一套同步、依赖安装、测试、lint 和构建流程。选择 `main` 后运行；`upstream_tag` 留空使用最新正式版，`force_release` 用于为已发布的上游版本创建下一个 patch。

- 测试与 lint 全部通过时，直接发布。
- 测试或 lint 失败、但类型检查与生产构建成功时，暂停在 `manual-release-override` 环境审批。先查看运行摘要、失败日志和候选产物，再由仓库维护者在 **Review deployments** 中选择 **Approve and deploy**。
- 同步、依赖安装、类型检查、构建或产物校验失败时停止，不能通过审批跳过。自动同步始终要求所有检查通过。

审批只针对该次运行生成的源码提交和 `management.html`，批准后使用已保存的产物，不重新同步或构建。等待期间 `main` 若有更新，则停止发布，请重新运行。候选产物保存 7 天。需要人工放行的失败版本只能通过新的 **Run workflow** 重新尝试，不支持 **Re-run jobs**，防止复用历史批准；旧产物不能跨运行次数复用。Release 说明会记录检查结果及人工放行情况。

环境必须预先配置唯一的 required reviewer，允许该维护者审批自己发起的运行，关闭管理员绕过，并限制到 `main` 分支；仅创建同名环境不构成审批保护。GitHub 的受保护 job 要求当前审批，工作流还会在打包和发布时检查配置与审批记录。迁移仓库或维护者时，同时更新环境和 `scripts/upstream/release-candidate.ts` 中的维护者 ID。

## 开发约定

上游公共文件遵循根目录的 `AGENTS.md`。插件功能保留在自己的模块中，接入文件由补丁生成；更新接入后运行 `bun scripts/apply-fork-patches.ts`。新增插件文件、测试或依赖时同步更新显式清单，避免扩大公共文件的定制范围。

插件 ID、导航及客户端统一使用 `src/fork/usagePlugin.ts`，插件文案维护在独立翻译模块中。修改 API 合约前核对配套插件与 CPA 后端，保留鉴权和会话隔离。按上游的 `bun run verify` 完整验证后再交付。

## 使用方法

在CPA的配置面板中，设置面板仓库为本仓库地址后，强制刷新（Ctrl+F5）页面

## License

MIT

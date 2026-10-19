# 实验记录

> 环境：Windows 11 · Node v24.14.1 · TencentDB-Agent-Memory（commit `e9a8293`）
> 部署：standalone（SQLite + 本地文件，**不需要 Docker**）· LLM：DeepSeek `deepseek-chat`

## 1. 能不能在 Windows 上跑？

**能。** `MemoryCore` 的 standalone 模式没有任何 POSIX 依赖：

```bash
cd MemoryCore && npm install
export TDAI_LLM_API_KEY=... TDAI_LLM_BASE_URL=https://api.deepseek.com/v1
npx tsx src/gateway/server.ts      # → http://127.0.0.1:8420
```

`GET /health` 确认：`ftsAvailable: true`（Node 自带 SQLite 有 FTS5，BM25 可用）、`embeddingService: false`（DeepSeek 无 embedding，召回退化为关键词）。

### 踩到的坑

1. **`npm install` 卡死 8 分钟** —— 是 `mongodb-memory-server` 的 postinstall 在下载 MongoDB 7.0（约 100MB，测试用）。
   → `npm install --ignore-scripts` 后 36 秒装完（542 包）。
2. **v3 数据面 401** —— 日志说"除 /health 外开放"，实际要两样：
   - `Authorization: Bearer <TDAI_GATEWAY_API_KEY>`（启动时设）
   - `x-tdai-service-id: default`（漏了也报 401，报错不直说）
3. **配置文件优先级**：`./tdai-gateway.yaml`（仓库自带）**优先于** `<dataDir>/tdai-gateway.yaml`。
   改配置要改仓库根目录那份，否则白写。

## 2. L1 提示词能不能换？

**能，而且效果显著。**

同一批 5 条对话（含"对香菜过敏""叫我阿鲸""最讨厌被说胖"）：

| 提示词 | 抽出条数 | 抽到了什么 |
|---|---|---|
| 腾讯内置 | **1 / 5** | 只有"在开发某插件" |
| 本仓库 `prompts/l1-persona.md` | **5 / 5** | 过敏、称呼、作息、雷区、项目 |

类型也对了：`persona` / `instruction` / `work_fact` 分别落地。

内置版为什么漏？它的提示词里明写着：

> 不应提取：… **与团队工作无关的个人偏好、私人生活或敏感信息**。

这是**设计取舍**，不是 bug。

### 挂载方式

```http
POST /v3/memory-prompt/create   { name, layer:"l1", prompt }
POST /v3/memory-prompt/set      { action:"apply", layer:"l1", memory_prompt_id, team_id:"default", agent_ids:["default"] }
```

`/v3/memory-prompt/get { layer, team_id, agent_id }` 可以确认生效的是不是自己那份（返回 `id: builtin:l1` 表示没挂上）。

## 3. L3 提示词能不能换？

**API 接受，生成器不照做。**

`/v3/memory-prompt/set` 对 `layer:"l3"` 返回 `affected: 1`，`/get` 也显示我们的 `memory_prompt_id` 已生效——
但生成的 `persona.md` 仍然是《Team Operating Doctrine》的骨架。

原因在 `src/core/persona/persona-generator.ts`：

```ts
const { systemPrompt: baseSystemPrompt, userPrompt } = buildPersonaPrompt({...});
const systemPrompt = composeMemorySystemPrompt(baseSystemPrompt, this.memoryPrompt);
```

L3 是**追加**到写死的 `baseSystemPrompt` 上；而 L1 是**整体替换**。所以：

- 改 L1 ⇒ 改的是"记什么"
- 改 L3 ⇒ 只能给"怎么写"加料，改不了骨架

### 触发条件

`persona.triggerEveryN` 默认 **50 条新记忆**才重新合成一次。测试时改 `tdai-gateway.yaml`：

```yaml
memory:
  persona:
    triggerEveryN: 1
  pipeline:
    l2DelayAfterL1Seconds: 2
    l2MinIntervalSeconds: 5
    l2MaxIntervalSeconds: 60
```

## 4. 结论

```
腾讯的 L0/L1/L2 + BM25 检索   → 直接复用（扎实、能跑、够快）
腾讯的 L3                     → 骨架写死，产出是团队规范，不适合个人人格
自己的 L3（本仓库）            → 30~100 行就能做出"主人档案"，质量明显更贴
```

于是本项目的定位：**别重写记忆系统，只换最后一层。**

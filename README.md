# whale-persona

> 给 [TencentDB Agent Memory](https://github.com/Tencent/TencentDB-Agent-Memory) 换一层**自己的 L3**：
> 底座用人家的存储和检索，人格用我们自己的提示词合成。

## 为什么会有这个

腾讯那套的记忆是四层的：

```
L0 对话原文 → L1 原子记忆 → L2 场景块 → L3 人格/规范
```

但它的 L3 是**给团队写的**——产出物固定叫《Team Operating Doctrine》，讲的是"归属先于细节""平台约束优先"这类协作规范。

实测结论（详见 [docs/findings.md](docs/findings.md)）：

| 环节 | 能不能改 | 实测结果 |
|---|---|---|
| **L1 抽取** | ✅ 整体替换 | 换提示词后，个人偏好抽取率 **1/5 → 5/5** |
| **L3 合成** | ⚠️ 只能追加 | 提示词"已生效"，但骨架写死，产出仍是团队规范 |

于是这个项目只做一件事：

> **用它的 L0/L1/L2 当记忆库，用我们自己的提示词合成"使用者画像"。**

## 架构

```
B站 / QQ / 微信 ──┐
                  ├─► POST /v3/conversation/add ──► L0 ──► L1（原子记忆）
DSH / agent ──────┘                                    │
                                                       ▼  POST /v3/atomic/query
                                             src/persona-synth.mjs
                                             （我们的 L3 · 自己的提示词）
                                                       │
                                                       ▼
                                        ~/.dsh/whale-persona/persona.md
                                                       │
                                                       ▼
                                                DSH / 各渠道读取
```

## 快速开始

前提：本机已经跑起腾讯的 MemoryCore Gateway（standalone 够用，不需要 Docker）。

```bash
# 1. 起 gateway（在腾讯仓库的 MemoryCore 目录）
export TDAI_LLM_API_KEY=sk-...
export TDAI_LLM_BASE_URL=https://api.deepseek.com/v1
export TDAI_LLM_MODEL=deepseek-chat
export TDAI_GATEWAY_API_KEY=local-dev-key
npx tsx src/gateway/server.ts

# 2. 换掉 L1 提示词（否则它不会抽个人偏好）
#    见 prompts/l1-persona.md，用 /v3/memory-prompt/create + /set 挂上去

# 3. 合成人格
node src/persona-synth.mjs           # 写入 ~/.dsh/whale-persona/persona.md
node src/persona-synth.mjs --dry     # 只看不写
node src/persona-synth.mjs --show    # 看现有画像
```

## 实际产物长什么样

同样 10 条记忆，腾讯的 L3 给出 1380 字的《Team Operating Doctrine》；
我们的 L3 给出 375 字：

```markdown
# 主人档案

## 怎么称呼他
叫他阿鲸，别叫全名。他自己认这个称呼。

## 雷区（踩了会很惨）
- 绝对不许说他胖。说一次他记一次。

## 喜欢什么 / 讨厌什么
- 讨厌别人半夜找他聊天——作息和联系时间上有边界，别越线。
- 对香菜过敏，吃了会难受，别给他安排带香菜的东西。
```

（它还会自己发现记忆里的身份冲突，比如"林浩"和"阿鲸"可能是两个人，然后标注出来，不瞎合并。）

## 配置

所有配置走环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `TDAI_GATEWAY_URL` | `http://127.0.0.1:8420` | MemoryCore 地址 |
| `TDAI_GATEWAY_API_KEY` | `local-dev-key` | gateway 的 Bearer key |
| `TDAI_SERVICE_ID` | `default` | 实例 ID（本地固定 default） |
| `DEEPSEEK_API_KEY` | 读 `~/.dsh/.credentials.yaml` | 合成用的 LLM key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 合成用的模型 |

## 已知限制

- **依赖腾讯的 type 体系**（`persona` / `instruction` / `work_fact` / `episodic`），L1 抽出来的类型决定画像质量。
- **embedding 默认关闭**，召回只有 BM25（关键词）。要语义检索得另配 embedding provider。
- **L3 生成器改不了骨架**——这也是本项目的存在理由。
- 只验证过 **Windows + Node 24 + standalone(SQLite)**，其他组合没测。

## 目录

```
src/persona-synth.mjs     合成脚本（100 行，零依赖）
prompts/l1-persona.md     会抽出个人偏好的 L1 提示词
prompts/l3-persona.md     合成画像用的 L3 提示词
docs/findings.md          实验记录：改了什么、数字变成什么样
```

## License

MIT

# CometBFT `flood` / `nop` / `app` 三种 mempool 模式说明

## 1. 文档目的

本文专门说明 CometBFT `config.toml` 里 `mempool.type` 的三种模式：

- `flood`
- `nop`
- `app`

重点回答下面几个问题：

- 三种模式分别由谁负责存交易、传播交易、给 proposer 提供交易
- 它们和当前仓库里的 `ExperimentalEVMMempool`、`KrakatoaMempool` 是什么关系
- `app` 模式下，交易到底是怎么广播的
- 为什么在 `app + exclusive` 模式下，从非验证人节点的 `8545` 提交交易可能永远打不了包

本文基于当前仓库的代码和配置语义整理。

## 2. 先给最短结论

三种模式最核心的区别，可以先记成一句话：

- `flood`
  - CometBFT 负责“存 + 传 + 供块”
- `nop`
  - 应用负责“存 + 传 + 供块”
- `app`
  - 应用负责“存 + 供块”，CometBFT 负责“传”

这里的“传”指的是节点之间的交易传播和广播语义。

这里的“供块”指的是 proposer 在组块时，从哪里拿到候选交易。

## 3. 三种模式分别是什么意思

### 3.1 `flood`

`flood` 是最传统、最常见的 CometBFT mempool 模式。

它的特点是：

- CometBFT 自己维护默认 mempool
- 节点收到交易后，会放进 CometBFT 自己的待处理交易集合
- CometBFT 会把交易 gossip 给其他节点
- proposer 出块时，主要从 CometBFT 默认 mempool 拿候选交易

你可以把它理解成：

- CometBFT 自己有一个“主交易池”
- 交易先进入这里
- 传播也由它负责
- 出块时也主要从这里取交易

这个模式适合：

- 传统 Cosmos/CometBFT 链
- 不需要应用自己完全接管交易池
- 不需要复杂的 EVM nonce gap 本地排队能力

### 3.2 `nop`

`nop` 是 no-op mempool。

它的含义最彻底：

- CometBFT 不维护默认 mempool
- CometBFT 不负责交易传播
- CometBFT 不负责给 proposer 准备交易
- 这些都要由应用自己负责

也就是说：

- CometBFT 只保留共识框架和 ABCI 通信
- 至于交易怎么收、怎么传、怎么存、怎么给 proposer，全由应用自己实现

这个模式适合：

- 应用已经自带完整的交易传播和交易池系统
- 不想依赖 CometBFT 默认 mempool 行为
- 希望应用完全控制交易生命周期

### 3.3 `app`

`app` 模式处在 `flood` 和 `nop` 之间。

它的核心含义是：

- CometBFT 不再维护传统默认 mempool 作为主交易池
- 但 CometBFT 仍然负责交易广播
- 真正的交易存储、排序、重检和供块，由应用侧 mempool 负责

所以最准确的理解是：

- `flood`
  - CometBFT 全包
- `nop`
  - 应用全包
- `app`
  - 广播归 CometBFT，交易池归应用

这也是配置注释里那句

- `the ABCI app is responsible for mempool, comet only broadcasts txs`

真正想表达的意思。

## 4. 三种模式的职责对照表

| 模式 | 谁存交易 | 谁广播交易 | proposer 从哪里拿交易 | 备注 |
| --- | --- | --- | --- | --- |
| `flood` | CometBFT 默认 mempool | CometBFT | CometBFT 默认 mempool | 传统模式 |
| `nop` | 应用 | 应用 | 应用 | 应用完全自管 |
| `app` | 应用侧 mempool | CometBFT | 应用侧 mempool | 广播和交易池分层 |

需要注意：

- 这里说的“谁存交易”，指的是谁维护“主交易池”
- 不是说另一边绝对不会有任何缓存、请求状态或临时结构

## 5. 它们和当前仓库的关系

在当前仓库里，CometBFT 的三种模式，并不是单独决定所有行为。

真正的运行方式，还会和下面两个应用侧开关组合：

- `mempool.max-txs`
- `evm.mempool.operate-exclusively`

这两个开关在 `evmd/mempool.go` 里决定：

1. app-side mempool 是否初始化
2. 初始化后走 `ExperimentalEVMMempool` 还是 `KrakatoaMempool`

### 5.1 `mempool.max-txs`

这个开关先决定 app-side mempool 是否启用：

- `< 0`
  - app-side mempool 不初始化
- `>= 0`
  - app-side mempool 初始化

所以：

- `mempool.max-txs = -1`
  - 不是“不做交易校验”
  - 而是“不启用 app-side mempool 这套逻辑”

### 5.2 `evm.mempool.operate-exclusively`

当 app-side mempool 已经启用时，这个开关决定走哪条实现路径：

- `false`
  - `ExperimentalEVMMempool`
- `true`
  - `KrakatoaMempool`

### 5.3 三者组合后的常见运行形态

当前项目里最常见的是下面几种组合。

#### 组合 A：`flood` + `mempool.max-txs = -1`

这最接近传统 Cosmos/CometBFT 模式：

- CometBFT 自己维护主 mempool
- 应用不启用 EVM app mempool

#### 组合 B：`flood` + `mempool.max-txs >= 0` + `operate-exclusively=false`

这会走 `ExperimentalEVMMempool`。

特点是：

- CometBFT 默认 mempool 还在
- 应用里也有一套 app-side mempool
- 两套系统并存

这是当前仓库里最复杂的模式，也是前面复现停出块问题时使用的模式。

#### 组合 C：`app` + `mempool.max-txs >= 0` + `operate-exclusively=true`

这会走 `KrakatoaMempool`。

特点是：

- 应用会注册 `InsertTxHandler`
- 应用会注册 `ReapTxsHandler`
- 应用侧 mempool 成为主交易池
- proposer 通过 app 侧接口向应用拿交易

这才是当前仓库里 `app` 模式的标准配套方式。

如果把 `mempool.type = "app"` 和 `operate-exclusively=false` 混在一起，就会出现：

- CometBFT 期望应用提供 `ReapTxs`
- 但应用实际上没有注册 `ReapTxsHandler`

最终报错：

```text
AppMempool.reapTxs: error reaping txs error="ReapTxs handler not set"
```

## 6. `app` 模式下，交易是怎么进应用的

在当前仓库里，`app` 模式下应用会注册两类关键 handler：

- `InsertTxHandler`
- `ReapTxsHandler`

这意味着：

- 新交易到达时，CometBFT 可以通过 `InsertTx` 把交易交给应用
- proposer 要打包交易时，CometBFT 可以通过 `ReapTxs` 向应用要候选交易

所以可以把 `app` 模式理解成：

- CometBFT 负责共识流程和网络广播
- 应用负责主交易池和供块结果

## 7. `8545` 在 `app + exclusive` 下到底怎么处理交易

这一点非常重要，因为它和很多人的直觉不一样。

如果是通过 `8545` 的：

- `eth_sendRawTransaction`
- `eth_sendTransaction`

提交交易，那么在当前仓库里，exclusive/app 模式下不会走：

- `BroadcastTx(txBytes)`

而是直接：

- `b.Mempool.Insert(...)`

也就是说：

- 交易会被直接插入本地 app-side mempool
- 会绕开传统的 `BroadcastTx` 到共识层那条路径

这在代码里的注释也写得很明确：

- `publish tx directly to app-side mempool, avoiding broadcasting to consensus layer`

所以在当前实现里，必须区分两件事：

1. CometBFT 网络层的广播职责
2. `8545` 本地提交时，应用是否显式调用 `BroadcastTx`

`app` 模式并不自动等于：

- 所有从本地 `8545` 提交的交易都会被全网传播

它只说明：

- 主交易池归应用
- CometBFT 仍保留网络广播职责

但具体 `8545` 路径是否使用 `BroadcastTx`，还要看应用代码怎么实现。

在当前仓库里，exclusive/app 模式的 `8545` 提交路径，选择的是：

- 直接本地入池
- 不调用 `BroadcastTx`

## 8. 为什么非验证人节点的 `8545` 提交可能永远打不了包

这个问题是 `app + exclusive` 模式下最需要警惕的地方。

假设当前是一个多节点网络：

- 节点 A：普通 full node，不是验证人
- 节点 B：验证人

如果用户把 `eth_sendRawTransaction` 发给节点 A，那么按当前实现：

1. 节点 A 会把交易直接插入自己的本地 app mempool
2. 这条路径不会调用 `BroadcastTx`
3. 我们在当前代码里也没有看到一条额外的“app mempool 之间同步/传播”机制
4. 于是这笔交易只存在于节点 A 的本地 app mempool
5. 验证人 B 看不到这笔交易
6. proposer 当然也就不可能把它打进块

所以结论就是：

- 如果节点不是验证人
- 又没有额外的 app mempool 传播机制
- 那么通过该节点 `8545` 直接插入本地 app mempool 的交易
- 可能永远不会被打包

这不是理论上的小概率问题，而是当前代码路径的直接推论。

## 9. 什么时候不会有这个问题

下面几种情况不会触发上面那个问题。

### 9.1 单节点本地链

如果本地只有一个节点，而且这个节点本身就是验证人，那么：

- `8545` 直接插入本地 app mempool
- proposer 就是它自己
- 所以交易仍然可以正常进块

这就是本地 `local_node.sh` 单节点调试时通常看不出问题的原因。

### 9.2 交易直接发给验证人节点

如果用户本来就是把 `8545` 请求直接打给验证人节点，那么：

- 交易进入验证人的本地 app mempool
- proposer 可以直接从本地取到
- 交易依然可以被打包

### 9.3 存在额外的应用侧传播机制

如果链自己实现了：

- full node 到 validator 的 app mempool 同步
- 专门的交易中继层
- 自定义 gossip 通道

那么即便 `8545` 本地只做 `Insert`，交易也可能最终传播到验证人。

但就当前仓库代码来看，这套额外机制并不在本文讨论的范围里，也没有在现有实现中直接看到。

## 10. 怎么判断当前链是否适合把 `8545` 暴露在非验证人节点上

可以按下面这个问题快速判断：

1. 当前是不是 `app + exclusive` 模式
2. `8545` 提交后，代码是不是直接 `Insert` 到本地 app mempool
3. 非验证人节点有没有额外传播机制，把本地 app mempool 里的交易送到验证人

如果前两项是“是”，第三项是“否”，那结论基本就是：

- 不应该把 `8545` 暴露在普通 full node 上作为正式入口

否则用户发到这些节点的交易，可能只是“本地被接受”，但不会真正上链。

## 11. 最后给一个最实用的记法

如果只记一个工程判断规则，可以记成下面这几句：

- `flood`
  - CometBFT 自己管交易池
- `nop`
  - 应用自己管交易池和传播
- `app`
  - 应用管交易池，CometBFT 管广播

但在当前仓库里还要再补一句：

- `app + exclusive` 下，`8545` 本地提交默认是“直接入本地 app mempool”
- 如果这个节点不是验证人，又没有额外传播机制，这笔交易可能永远不会上链

这就是为什么在设计多节点部署方案时，不能只看 `mempool.type = "app"` 的配置注释，还必须把：

- JSON-RPC 提交路径
- 验证人角色
- 节点间传播机制

一起看。

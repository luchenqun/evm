# `ExperimentalEVMMempool` 停出块问题的人话解释

## 1. 先讲结论

这个问题的根本原因不是：

- 交易太多
- 节点太慢
- RPC 被打挂了

而是：

- 一笔已经在系统内部的交易，在 `queued -> pending` 的关键时刻
- 又被同步从“入口”重新灌回同一个系统
- 于是内部处理路径和入口处理路径撞到了一起
- 最后把 proposer 继续拿交易出块这条路径卡住

所以现象才会是：

- `26657` 还活着
- `8545` 还活着
- 区块高度不再增长
- `num_unconfirmed_txs` 还不是 `0`

这更像“流程卡死”，不是“单纯太忙”。

## 2. 用仓库发货来理解

把整套 mempool / txpool 想成一个仓库。

仓库里有两块区域：

- `queued`
  - 货到了，但因为前面的流程还没补齐，暂时不能发
- `pending`
  - 货已经可以发，打包员随时可以拿去装车

同一个发送者的两笔交易：

- `n`
- `n + 1`

就像同一订单链路里的两件货，必须先处理 `n`，才能处理 `n + 1`。

### 2.1 正常情况

如果 `n + 1` 先到：

- 它不能直接发
- 所以先放进 `queued`

后来 `n` 到了：

- `n` 自己进入 `pending`
- 原来卡着的 `n + 1` 也可以从 `queued` 升到 `pending`
- 然后打包员从 `pending` 拿货发走

流程图是：

```text
n+1 先到 -> queued
n 后到  -> n 进入 pending
        -> n+1 promoted 到 pending
        -> proposer 取交易
        -> 正常出块
```

这条路没有问题。

### 2.2 出问题的情况

问题出在 `n + 1` 被 promoted 的那个瞬间。

按正常理解，它现在已经在仓库内部了，只需要：

- 从 `queued` 挪到 `pending`
- 等 proposer 来拿

但 `ExperimentalEVMMempool` 还额外做了一件事：

- 在 promoted 回调里同步执行 `BroadcastTxSync`

翻成人话就是：

- 仓库员工正在把一件货从“待处理区”搬到“可发货区”
- 结果系统要求他立刻打电话给前台
- 让前台把同一件货再从收货口重新登记一遍

于是流程变成：

```text
n+1 先到 -> queued
n 后到  -> n 进入 pending
        -> n+1 promoted
        -> 仓库内部本该继续往前走
        -> 但 promoted 回调同步要求“重新从入口登记”
        -> 同一件货又从入口回到仓库内部
        -> 内部路径和入口路径撞到一起
        -> proposer 卡住
        -> 不再出块
```

关键不是“无限循环灌回”，而是：

- 在一次敏感的内部处理过程中
- 又同步从入口重进自己一次

一次重入就可能已经足够把自己卡住。

## 3. 仓库例子和代码怎么对应

下面把生活例子和代码里的角色一一对应起来。

| 人话角色 | 代码里的东西 | 说明 |
| --- | --- | --- |
| 仓库 | `ExperimentalEVMMempool` | 非独占模式下使用的 mempool 实现 |
| 待处理区 | `queued` | nonce gap 交易先待在这里 |
| 可发货区 | `pending` | 已经可执行、可被 proposer 取走 |
| 仓库内部搬货 | `OnTxPromoted` | `queued -> pending` 时触发 |
| 前台重新登记 | `BroadcastTxSync` | 把交易重新送回本地入口 |
| 收货口 | `CheckTx -> Insert -> TxPool.Add` | 重新走一遍本地插入路径 |
| 打包员 | proposer / `PrepareProposal` | 负责拿交易准备新区块 |

## 4. 这条路径在代码里是怎么接起来的

### 4.1 为什么会走到 `ExperimentalEVMMempool`

在 [evmd/mempool.go](../evmd/mempool.go#L33) 到 [evmd/mempool.go](../evmd/mempool.go#L80)：

- `operate-exclusively=true`
  - 走 `KrakatoaMempool`
- `operate-exclusively=false`
  - 走 `ExperimentalEVMMempool`

也就是你现在复现问题的配置：

- `mempool.type = "flood"`
- `--mempool.max-txs=0`
- `--evm.mempool.operate-exclusively=false`

最终会在 [evmd/mempool.go](../evmd/mempool.go#L70) 创建 `ExperimentalEVMMempool`，并在 [evmd/mempool.go](../evmd/mempool.go#L80) 设置 `CheckTxHandler`。

这一步的人话是：

- 仓库采用了“默认仓库方案”
- 新货物还是会从 CometBFT 的老入口进来
- 不是完全改成 app-side 独占仓库

### 4.2 promoted 回调是在什么时候挂上的

在 [mempool/mempool.go](../mempool/mempool.go#L180) 到 [mempool/mempool.go](../mempool/mempool.go#L192)：

- `ExperimentalEVMMempool` 持有 `txPool`
- 其中的子池是 `LegacyPool`
- 然后把 `legacyPool.OnTxPromoted` 绑定成 `evmMempool.onEVMTxPromoted(...)`

人话就是：

- 只要有交易从 `queued` 升到 `pending`
- 就会立刻触发一段额外逻辑

### 4.3 本地入口重新插入是怎么发生的

在 [mempool/mempool.go](../mempool/mempool.go#L534) 到 [mempool/mempool.go](../mempool/mempool.go#L577)：

1. `onEVMTxPromoted(...)` 被触发
2. 如果没有自定义 `broadcastTxFn`
3. 它会调用 `broadcastEVMTransaction(...)`
4. 这个函数会把 EVM 交易转成 Cosmos tx bytes
5. 然后执行 `clientCtx.BroadcastTxSync(txBytes)`

最关键的一句就是 [mempool/mempool.go](../mempool/mempool.go#L570) 的：

```go
res, err := clientCtx.BroadcastTxSync(txBytes)
```

这一步的人话不是“通知一下外面”，而是：

- 把已经在仓库内部的一件货
- 又同步送回收货台重新登记

### 4.4 重新登记后为什么又会撞回同一套系统

在 [evmd/mempool.go](../evmd/mempool.go#L80) 已经设置了 `CheckTxHandler`。

而 `ExperimentalEVMMempool` 自己的插入逻辑在 [mempool/mempool.go](../mempool/mempool.go#L224) 到 [mempool/mempool.go](../mempool/mempool.go#L236)：

- 收到 EVM 交易
- 解出 `ethMsg`
- 调用 `m.txPool.Add(...)`

也就是说，promoted 后同步广播出去的那笔交易，会重新沿着：

```text
BroadcastTxSync
-> CheckTx
-> ExperimentalEVMMempool.Insert
-> txPool.Add
```

又撞回原来这套 `txPool / LegacyPool` 结构。

这就是“自己把自己又送回入口”的代码版定义。

## 5. 为什么 proposer 需要一套稳定的候选交易集

可以把 proposer 理解成“这一轮负责装车发货的人”。

它的工作不是随便拿几笔交易塞进区块，而是：

1. 从 mempool 里拿当前可执行的交易
2. 按顺序挑出一批可以放进新区块的交易
3. 生成这轮区块提案

在代码里，这条路径从 `PrepareProposal` 接到 mempool：

- `evmd/mempool.go`
  - `SetPrepareProposal(...)`

而 `ExperimentalEVMMempool` 提供候选交易的方式是：

- `mempool/mempool.go`
  - `Select()`
  - `buildIterator()`
  - `getIterators()`
  - `evmIterator()`

其中最关键的是：

- `evmIterator()` 最终从 `txPool.Pending(...)` 取当前可执行 EVM 交易

也就是说，proposer 依赖的是一套“此刻 pending 里有哪些交易、顺序是什么”的视图。

这里说的“稳定”，不是永远不变，而是说：

- proposer 开始挑交易的这段时间里
- 这套 pending 视图必须是自洽的
- 不应该一边挑，一边被另一条同步路径重新从入口灌回来

如果在 proposer 取交易时，底层 pending 结构被同步重入修改，就会出现三类风险：

1. proposer 看到的候选集在变
2. 同一账户的 nonce 顺序视图被打断
3. 更糟时，读候选集的路径和回灌入口的路径互相等待

翻成人话就是：

- 打包员正在货架边按顺序拿货
- 这时仓库员工又把一件刚上架的货同步送回收货口重新登记
- 收货口又把它重新送回仓库内部
- 打包员拿到的就不再是一套稳定、能连续装车的货架视图

所以这里的关键不是“proposer 想不想继续工作”，而是：

- 它依赖的那套候选交易视图，在关键时刻被回灌路径撞坏了

## 6. 为什么这会让 proposer 卡住

proposer 需要一套稳定的候选交易集来准备新区块。

在 `ExperimentalEVMMempool` 里，这条“拿交易出块”的路径最终还是依赖同一套 EVM txpool 状态，见 [mempool/mempool.go](../mempool/mempool.go#L295) 和 [mempool/mempool.go](../mempool/mempool.go#L530)。

所以如果此时发生：

1. 内部正在处理 `queued -> pending`
2. promoted 回调同步回灌本地入口
3. 新路径又要碰 `Insert -> txPool.Add`
4. proposer 同时还要从这套结构里取交易

那就可能出现：

- 某些锁或者内部状态边界互相等待
- 某些路径拿不到稳定候选集
- 共识还活着，但新的块准备不出来

人话就是：

- 前台电话还能打
- 仓库系统还能查
- 但打包员拿不到一套能继续装车的货

于是外部就看到：

- 查询接口活着
- mempool 还有交易
- 但区块高度停住

## 7. 为什么 `KrakatoaMempool` 不容易出这个问题

对照 [mempool/krakatoa_mempool.go](../mempool/krakatoa_mempool.go#L224) 到 [mempool/krakatoa_mempool.go](../mempool/krakatoa_mempool.go#L235)：

- `KrakatoaMempool` 的 `onEVMTxPromoted()`
- 不会调用 `BroadcastTxSync`
- 它只是把交易推进 `reapList`

人话就是：

- 货从“待处理区”变成“可发货”后
- 直接放进打包员待拿的货架
- 不会再跑去前台重新登记一次

所以它绕开了最危险的那条“同步回头路”。

## 8. 用一句话记住这个 bug

如果只记一句话，可以记成：

- 这个 bug 不是因为交易太多，而是因为 `ExperimentalEVMMempool` 在 promoted 时把已经在内部的交易又同步送回了本地入口，导致流程自己撞自己，最后把出块卡住。

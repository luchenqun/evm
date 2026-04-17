# `app + KrakatoaMempool` 模式下 RPC 观测口径说明

## 1. 文档目的

当链启用了：

- CometBFT `mempool.type = "app"`
- `evm.mempool.operate-exclusively=true`
- `KrakatoaMempool`

之后，很多常见 RPC 接口就不再共享同一套“待处理交易”视图。

最容易出现的现象是：

- 应用侧 mempool 明明已经有交易
- 但 `26657` 的 `num_unconfirmed_txs` 仍然是 `0`
- 某些带 `pending` 语义的 eth RPC 也可能查不到
- 同时 `txpool_status` 却能看到 pending/queued 数据

本文专门说明：

- 哪些接口读的是 app mempool
- 哪些接口仍然读的是 CometBFT unconfirmed txs
- 在 `app + Krakatoa` 模式下应该优先看哪些接口

## 2. 先给最短结论

如果只记一个结论，可以记成下面这几句：

- `26657/num_unconfirmed_txs`
  - 看的是 CometBFT 那边的未确认交易
  - 不是 `KrakatoaMempool` 的真实交易数
- `txpool_*`
  - 读的是 app mempool 里的 EVM `TxPool`
  - 在 `Krakatoa` 下更接近真实的 EVM pending/queued 视图
- 一部分 `eth_*` 的 `pending` 语义接口
  - 当前实现里仍然依赖 `PendingTransactions()`
  - 而 `PendingTransactions()` 又读的是 CometBFT `UnconfirmedTxs`
  - 所以在 `Krakatoa` 下不一定准确

## 3. 为什么会出现两套不同视图

在 `app + exclusive` 模式下：

- 主交易池在应用侧 `KrakatoaMempool`
- `8545` 提交 EVM 交易时，代码会直接 `Insert` 到 app mempool
- 不再走 `BroadcastTx`

所以：

- 交易已经进入了 app mempool
- 但不一定进入 CometBFT 默认的 unconfirmed tx 视图

这会直接导致：

- 应用侧相关接口能看到交易
- CometBFT 相关接口却看不到

## 4. `26657/num_unconfirmed_txs` 在这个模式下怎么看

这个接口反映的是：

- CometBFT 视角下的 unconfirmed txs

它不是：

- `KrakatoaMempool.CountTx()`
- `LegacyPool` 的 pending/queued 总数
- `ReapList` 中还未供块交易的数量

所以在 `app + Krakatoa` 模式下：

- 即使 app mempool 里已经有交易
- `http://127.0.0.1:26657/num_unconfirmed_txs`
 也完全可能还是 `0`

因此这个接口在该模式下不能作为“真实池子大小”的可靠指标。

## 5. 哪些接口是读 app mempool 的

### 5.1 `txpool_status`

这个接口直接读：

- `b.Mempool.GetTxPool().Stats()`

也就是读取应用侧 mempool 的底层 EVM `TxPool` 统计。

它返回：

- `pending`
- `queued`

在 `Krakatoa` 下，这两个值对 EVM 交易的观测是有意义的。

### 5.2 `txpool_content`

这个接口直接读：

- `b.Mempool.GetTxPool().Content()`

因此它看到的是：

- EVM pending 交易
- EVM queued 交易

它不会去依赖 CometBFT 的 `UnconfirmedTxs`。

### 5.3 `txpool_contentFrom`

这个接口直接读：

- `b.Mempool.GetTxPool().ContentFrom(addr)`

适合排查某个账户：

- 哪些交易已经在 pending
- 哪些交易还在 queued

### 5.4 `txpool_inspect`

这个接口同样是基于：

- `b.Mempool.GetTxPool().Content()`

只是把结果格式化成更便于阅读的字符串。

### 5.5 总结

所以 `txpool_*` 这组接口在 `Krakatoa` 下，核心特点是：

- 它们直接读 app mempool 的 EVM `TxPool`
- 不依赖 CometBFT `UnconfirmedTxs`

因此：

- 如果你想看 EVM pending/queued 的真实情况
- 这组接口通常比 `26657/num_unconfirmed_txs` 更可信

## 6. 哪些接口当前仍然依赖 CometBFT `UnconfirmedTxs`

当前仓库里有一组逻辑，会调用：

- `Backend.PendingTransactions(ctx)`

而这个函数内部实际做的是：

- `mc.UnconfirmedTxs(ctx, nil)`

也就是读 CometBFT 的 unconfirmed tx 集合。

在 `app + Krakatoa` 下，这就意味着：

- 如果一笔交易只是直接插入了 app mempool
- 没进入 CometBFT unconfirmed 视图
- 这些接口就可能看不到它

### 6.1 `eth_getTransactionCount(address, "pending")`

这个接口的 pending nonce 计算，最终会走：

- `getAccountNonce(..., pending=true, ...)`

而 `getAccountNonce(...)` 为了计算 pending nonce，会调用：

- `PendingTransactions()`

所以在 `Krakatoa` 下，如果 `PendingTransactions()` 看不到 app mempool 里的交易，那么：

- `eth_getTransactionCount(address, "pending")`
  可能会偏小
- 看起来像“pending nonce 没增长”

### 6.2 `GetTransactionByHashPending`

这个逻辑也会先调用：

- `PendingTransactions()`

然后在里面找目标交易 hash。

因此在 `Krakatoa` 下，如果交易只是存在于 app mempool 而不在 CometBFT `UnconfirmedTxs` 里，那么：

- 它可能查不到

### 6.3 一些 resend / 待处理交易辅助逻辑

当前仓库里还有一些逻辑，例如：

- resend 时扫描 pending 交易
- 计算 pending nonce

这些也都依赖：

- `PendingTransactions()`

所以它们在 `app + Krakatoa` 下同样存在口径不一致的问题。

## 7. 一张表看清楚当前口径

| 接口 | 当前数据来源 | 在 `app + Krakatoa` 下是否可靠 |
| --- | --- | --- |
| `26657/num_unconfirmed_txs` | CometBFT unconfirmed txs | 不可靠，可能是 `0` |
| `txpool_status` | app mempool 的 `GetTxPool().Stats()` | 对 EVM pending/queued 较可靠 |
| `txpool_content` | app mempool 的 `GetTxPool().Content()` | 对 EVM pending/queued 较可靠 |
| `txpool_contentFrom` | app mempool 的 `GetTxPool().ContentFrom()` | 对单账户 EVM 状态较可靠 |
| `txpool_inspect` | app mempool 的 `GetTxPool().Content()` | 对 EVM 状态较可靠 |
| `eth_getTransactionCount(..., "pending")` | 账户状态 + `PendingTransactions()` | 可能不可靠 |
| pending hash 查询类逻辑 | `PendingTransactions()` | 可能不可靠 |

## 8. 这里的“可靠”到底是什么意思

这里说 `txpool_*` “较可靠”，要再加一个限定：

- 它们主要反映的是 **EVM `TxPool`** 的视图

所以它们最适合回答的是：

- 某个 EVM 交易现在在 `pending` 还是 `queued`
- EVM pool 一共有多少 `pending` / `queued`

但它们不是：

- 整个 app mempool 的总视图
- Cosmos 交易和 EVM 交易混合之后的统一总数
- `ReapList` 的完整快照

所以如果你问的是“整个 app mempool 当前总共有多少交易”，那么：

- `txpool_status` 也不是完整答案

它只是当前最接近真实 EVM pending/queued 状态的一个对外可见接口。

## 9. 排查时应该优先看什么

如果你在 `app + Krakatoa` 模式下排查交易为什么没有进块，建议按下面顺序看。

### 9.1 先看 `txpool_status`

看：

- `pending`
- `queued`

这能快速告诉你：

- 交易是否已经进入 EVM `TxPool`
- 是已经可执行，还是仍然因为 nonce gap 等原因卡在 queued

### 9.2 再看 `txpool_contentFrom`

如果你关心某个地址的交易顺序问题，这个接口最直接。

它可以帮助你判断：

- nonce 是否断档
- 哪几笔已经 pending
- 哪几笔还在 queued

### 9.3 不要优先信 `26657/num_unconfirmed_txs`

在 `app + exclusive` 下，这个值即便是 `0`，也不代表：

- app mempool 里没有交易
- EVM `TxPool` 里没有交易

### 9.4 对 `eth_getTransactionCount(..., "pending")` 保持谨慎

如果你发现：

- `txpool_status` 明明显示 pending/queued 已经有交易
- 但 pending nonce 没增长

那就要优先怀疑：

- 当前 pending nonce 逻辑还在读 CometBFT `UnconfirmedTxs`
- 而不是 app mempool

## 10. 这意味着什么

这说明当前仓库在 `app + Krakatoa` 模式下，RPC 观测口径还没有完全统一。

更具体地说：

- 交易处理主路径已经下沉到 app mempool
- 但部分 RPC 仍然沿用 CometBFT unconfirmed tx 作为 pending 视图来源

于是就出现了：

- 提交路径已经是 app mempool
- 观测路径却还是 CometBFT mempool 视角

这两者之间的错位，是很多“明明池子里有交易，但接口看不到”的根因。

## 11. 最后给一个最实用的判断规则

如果当前链是：

- `mempool.type = "app"`
- `operate-exclusively=true`
- `KrakatoaMempool`

那么默认应该这样理解：

- 想看 EVM pending/queued：
  - 先看 `txpool_*`
- 想看 CometBFT 默认 mempool：
  - 看 `26657/num_unconfirmed_txs`
- 想看 pending nonce 或 pending hash 查询：
  - 先确认这个接口底层是不是还在读 `PendingTransactions()`

如果底层仍在读 `PendingTransactions()`，那在当前模式下就要默认认为：

- 它可能和真实 app mempool 视图不一致

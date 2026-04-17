# `ExperimentalEVMMempool` 停出块问题复现与分析

## 1. 文档目的

本文整理当前仓库中一个可复现的链活性问题。

问题表现为：

- 节点的读接口仍然可访问
- 区块高度停止增长
- mempool 中持续残留未确认交易

本文把下面三部分合并成一份纯技术说明：

- 当前仓库的 mempool 代码路径
- 外部压测脚本 `deadlock-transfer.ts`
- 之前的分析文档中与业务无关的技术结论

本文不再保留任何业务场景描述，只保留：

- 如何复现
- 为什么会触发
- 代码上大致发生了什么
- 为什么这个问题只会出现在非独占 `ExperimentalEVMMempool` 路径

## 2. 问题结论

在下面这组条件同时成立时，可以稳定复现停出块问题：

1. 节点运行的是非独占 app-side mempool
   - `mempool.max-txs >= 0`
   - `evm.mempool.operate-exclusively=false`
2. CometBFT mempool 仍保持 `flood`
3. 压测流量持续制造同一账户的 nonce gap
   - 先发 `n + 1`
   - 再发 `n`
4. promoted 交易在 `ExperimentalEVMMempool` 路径下同步执行 `BroadcastTxSync`

现场症状通常是：

- `26657` 仍可访问
- `8545` 仍可访问
- `eth_blockNumber` 停在固定高度
- `status` 里的 `latest_block_height` 不再增长
- `num_unconfirmed_txs` 保持非零

这不是普通的吞吐下降，而是链活性出现问题。

## 3. 复现环境

### 3.1 节点侧

节点使用当前仓库：

- 启动脚本：`local_node.sh`

为了进入问题路径，节点必须跑在非独占模式：

- CometBFT `mempool.type = "flood"`
- `--mempool.max-txs=0`
- `--evm.mempool.operate-exclusively=false`

也就是说：

- 要启用 app-side mempool
- 但不能切到 `KrakatoaMempool`

### 3.2 压测侧

压测使用外部脚本：

- `deadlock-transfer.ts`

这个脚本本身不依赖特定业务交易，它做的事情非常纯粹：

- 初始化一批钱包
- 必要时给它们注资
- 然后按轮次并发发送普通 EVM 转账
- 每轮都先发 `nonce = n + 1`
- 再发 `nonce = n`

也就是说，它在持续制造：

- 同一发送者的超前 nonce 交易
- queued -> pending -> promoted 的状态转换

这已经足够触发当前问题，不需要额外混入业务消息。

## 4. 压测脚本到底做了什么

脚本的核心参数大致如下：

- `WALLET_COUNT = 24`
- 固定使用 `8545`
- 每轮对每个钱包发送两笔转账
- 第一波发送 `n + 1`
- 短暂等待后再发送 `n`

它的主要流程可以概括成：

1. 创建 24 个确定性钱包
2. 用 faucet 给这些钱包补足余额
3. 读取每个钱包当前的 pending nonce
4. 每一轮先并发发送 `nonce = n + 1`
5. 等待很短时间
6. 再并发发送 `nonce = n`
7. 成功则把本地游标推进到 `n + 2`
8. 失败则重新查询 pending nonce

这个流量模型的重点不在“转账金额”，而在：

- 同一账户连续 nonce 交易被故意乱序送入节点

因此它非常适合验证：

- mempool 是否支持 nonce gap
- promoted 回调是否安全
- 非独占路径里同步广播是否会带来重入风险

### 4.1 压测脚本原文

下面是当前用于复现问题的脚本原文，便于直接对照理解其流量模式：

```ts
// @ts-nocheck
import { JsonRpcProvider, Wallet, ethers } from "ethers";

const RPC_URL = "http://127.0.0.1:8545";
const FAUCET_KEY = "0x88cbead91aee890d27bf06e003ade3d4e952427e88f88d31d61d3ef5e5d54305";
const RECEIVER_KEY = "0x741de4f8988ea941d3ff0287911ca4074e62b7d45c991a51186455366f10b544";
const WALLET_COUNT = 24;
const GAS_PRICE = 10_000_000_000n;
const FUND = ethers.parseEther("5");
const VALUE = ethers.parseEther("0.00000000000001");
const GAP_DELAY_MS = 80;
const ROUND_DELAY_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: any) => e?.shortMessage ?? e?.info?.error?.message ?? e?.message ?? String(e);

function derive(index: number, provider: JsonRpcProvider) {
  return new Wallet(ethers.keccak256(ethers.toUtf8Bytes(`deadlock:${index}`)), provider);
}

async function send(sender: Wallet, to: string, nonce: number) {
  try {
    const tx = await sender.sendTransaction({ to, nonce, value: VALUE, gasLimit: 21_000n, gasPrice: GAS_PRICE });
    console.log(` nonce=${nonce} from=${sender.address.slice(0, 10)} hash=${tx.hash}`);
    return true;
  } catch (e) {
    console.log(` nonce=${nonce} from=${sender.address.slice(0, 10)} error=${msg(e)}`);
    return false;
  }
}

async function fund(faucet: Wallet, wallets: Wallet[]) {
  let balances = await Promise.all(wallets.map((w) => faucet.provider.getBalance(w.address)));
  let missing = wallets.filter((_, i) => balances[i] < FUND / 2n);
  if (!missing.length) return;
  const base = await faucet.provider.getTransactionCount(faucet.address, "pending");
  for (let i = 0; i < missing.length; i += 1) {
    const w = missing[i];
    try {
      await faucet.sendTransaction({
        to: w.address,
        nonce: base + i,
        value: FUND,
        gasLimit: 21_000n,
        gasPrice: GAS_PRICE,
      });
    } catch (e) {
      console.log(` fundError=${msg(e)}`);
    }
  }
  for (let i = 0; i < 20; i += 1) {
    balances = await Promise.all(wallets.map((w) => faucet.provider.getBalance(w.address)));
    missing = wallets.filter((_, j) => balances[j] < FUND / 2n);
    if (!missing.length) return;
    await sleep(1000);
  }
}

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const faucet = new Wallet(FAUCET_KEY, provider);
  const receiver = new Wallet(RECEIVER_KEY, provider);
  const wallets = Array.from({ length: WALLET_COUNT }, (_, i) => derive(i, provider));
  const cursors = new Map<string, number>();

  await fund(faucet, wallets);
  for (const w of wallets) cursors.set(w.address, await provider.getTransactionCount(w.address, "pending"));

  console.log(`rpc=${RPC_URL} faucet=${faucet.address} receiver=${receiver.address} wallets=${WALLET_COUNT}`);

  let round = 0;
  for (;;) {
    round += 1;
    console.log(`round=${round}`);

    await Promise.all(
      wallets.map(async (w) => {
        const n = cursors.get(w.address) ?? 0;
        const ok = await send(w, receiver.address, n + 1);
        if (!ok) cursors.set(w.address, await provider.getTransactionCount(w.address, "pending"));
      }),
    );

    await sleep(GAP_DELAY_MS);

    await Promise.all(
      wallets.map(async (w) => {
        const n = cursors.get(w.address) ?? 0;
        const ok = await send(w, receiver.address, n);
        cursors.set(w.address, ok ? n + 2 : await provider.getTransactionCount(w.address, "pending"));
      }),
    );

    console.log("");
    await sleep(ROUND_DELAY_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

## 5. 为什么这个脚本能稳定触发问题

因为它持续制造了 `ExperimentalEVMMempool` 最敏感的一条路径：

1. 一笔 EVM 交易先因为 nonce gap 进入 `queued`
2. 较小 nonce 的交易后到
3. 原本 queued 的交易被 promoted 到 `pending`
4. promoted 回调被触发
5. `ExperimentalEVMMempool` 对 promoted 交易执行同步广播
6. 同步广播又重新回灌到本地节点的 `CheckTx -> Insert -> TxPool.Add`

这条路径不是偶发，而是脚本每一轮都在持续制造。

所以和之前那些混合业务流量相比，这个脚本更适合作为最小技术复现：

- 它足够简单
- 触发条件清楚
- 没有业务层噪音

## 6. 为什么只在 `ExperimentalEVMMempool` 下出现

当前应用在启动时会根据配置选择 mempool 实现：

- `mempool.max-txs < 0`
  - 不初始化 app-side mempool
- `mempool.max-txs >= 0` 且 `operate-exclusively=true`
  - 进入 `KrakatoaMempool`
- `mempool.max-txs >= 0` 且 `operate-exclusively=false`
  - 进入 `ExperimentalEVMMempool`

问题出在最后一种。

### 6.1 `ExperimentalEVMMempool` 的关键行为

`ExperimentalEVMMempool` 在初始化时，会把：

- `legacyPool.OnTxPromoted`

绑定到：

- `ExperimentalEVMMempool.onEVMTxPromoted(...)`

而这个回调在默认情况下会做一件很关键的事：

- 对 promoted 的 EVM 交易调用 `BroadcastTxSync`

也就是说：

- 交易先在本地 EVM txpool 中排队
- 一旦变得可执行
- 就再同步广播回本地节点

这就是问题路径的核心。

### 6.2 `KrakatoaMempool` 为什么不会走到这里

`KrakatoaMempool` 的 promoted 回调逻辑完全不同。

它不会同步 `BroadcastTxSync`，而是：

- 直接把交易推入 `ReapList`

然后由应用通过 `ReapTxs` 把这些已验证交易提供给 proposer。

因此：

- `ExperimentalEVMMempool`
  - promoted 后回灌本地广播路径
- `KrakatoaMempool`
  - promoted 后直接进入应用侧供块路径

两者结构差异决定了：

- 前者存在同步重入风险
- 后者天然绕开这条路径

## 7. 相关代码路径

下面用一条尽量短的调用链说明当前问题。

### 7.1 启动时的分支选择

相关位置：

- `evmd/mempool.go`

大致逻辑是：

1. 先读取 `mempool.max-txs`
2. 如果 `< 0`，直接跳过 app-side mempool
3. 如果 `>= 0`，再看 `operate-exclusively`
4. `false` 走 `ExperimentalEVMMempool`
5. `true` 走 `KrakatoaMempool`

### 7.2 非独占模式的交易插入

在 `ExperimentalEVMMempool` 中，EVM 交易最终会进入：

- `txPool.Add(...)`
- `LegacyPool`

如果 nonce 还没轮到执行，它会先进入：

- `queued`

等缺失的前序 nonce 被补上后，再进入：

- `pending`

### 7.3 promoted 回调

当 queued 交易被 promoted 后：

- `LegacyPool.OnTxPromoted`
  会触发

在 `ExperimentalEVMMempool` 路径中，这个回调最终会执行：

- `BroadcastTxSync(txBytes)`

### 7.4 同步广播造成回灌

`BroadcastTxSync` 不是一个纯“发出去就完事”的异步动作。

它会把交易重新送回本地节点处理路径，大致表现为：

1. `BroadcastTxSync`
2. 本地节点 `CheckTx`
3. `ExperimentalEVMMempool.Insert(...)`
4. `TxPool.Add(...)`
5. 再次进入 `LegacyPool`

所以 promoted 交易会沿着本地插入路径再次回灌进同一个 txpool 系统。

## 8. 问题的核心风险点

问题的危险之处在于：

- promoted 回调是同步执行的
- 它又会重新进入本地 mempool/txpool 路径

只要这条路径和 `LegacyPool` 的内部锁边界发生交叠，就会产生典型的重入风险。

更直白一点说：

1. 外层 `LegacyPool` 正在处理状态变更
2. 其中一笔交易被 promoted
3. promoted 回调同步触发本地广播
4. 本地广播又重新请求进入同一个 txpool
5. proposer 同时还需要从同一套结构里取交易准备新区块

结果就是：

- 交易准备路径卡住
- proposer 拿不到稳定的候选集
- 高度停止增长

从外部看起来，就会变成：

- 读接口还活着
- 但链不再继续出块

## 9. 实际复现步骤

### 9.1 启动节点

确保当前 `local_node.sh` 满足：

- `mempool.type = "flood"`
- `--mempool.max-txs=0`
- `--evm.mempool.operate-exclusively=false`

然后执行：

```bash
./local_node.sh -y --no-install
```

启动后建议先确认日志中出现的是：

```text
app-side mempool is not operating exclusively, setting up default EVM mempool
```

### 9.2 确认链先正常出块

例如查询：

```bash
curl -s http://127.0.0.1:26657/status
```

或：

```bash
curl -s -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545
```

确认高度是持续增长的。

### 9.3 运行压测脚本

执行：

```bash
node deadlock-transfer.ts
```

如果你本地实际是用 `tsx` 或其他方式运行，也可以用你平时的命令，只要执行的是同一份脚本即可。

### 9.4 观察链是否停住

重复查询：

```bash
curl -s http://127.0.0.1:26657/status
```

```bash
curl -s http://127.0.0.1:26657/num_unconfirmed_txs
```

```bash
curl -s -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545
```

如果问题触发，通常会看到：

- 高度停住
- `num_unconfirmed_txs` 保持非零
- `eth_blockNumber` 不再继续增长

## 10. 现场现象应该如何判断

下面这些组合在一起，就基本可以认定问题已经触发：

- `status` 连续两次查询 `latest_block_height` 完全相同
- `eth_blockNumber` 连续两次查询完全相同
- 节点仍能响应 `26657` 和 `8545`
- `num_unconfirmed_txs` 不是 `0`

这和“节点宕机”是不同现象。

这里的关键特征是：

- 节点还活着
- 但是出块活性没了

## 11. 为什么这是 bug，而不是压测过猛

因为这个问题的实质不是：

- TPS 降低
- RPC 超时增多
- 交易确认变慢

而是：

- 区块高度停止增长
- proposer 无法继续推进共识

对单验证者本地链来说，这已经等价于：

- 链被卡住

只要项目仍然保留 `ExperimentalEVMMempool` 这条非独占路径，这就是一个真实的实现缺陷，而不是压测脚本本身的问题。

## 12. 临时规避方式

如果当前只是想避开问题，而不是立刻修代码，最直接的办法有两个。

### 12.1 切到 `KrakatoaMempool`

把节点改成：

- `mempool.type = "app"`
- `--mempool.max-txs=0`
- `--evm.mempool.operate-exclusively=true`

这样会进入 `KrakatoaMempool` 路径，避开 `ExperimentalEVMMempool` 的同步广播回灌逻辑。

### 12.2 关闭 app-side mempool

把：

- `mempool.max-txs = -1`

这样应用不会初始化 app-side mempool，自然也不会再走到本文描述的这条路径。

不过这同时也意味着：

- 不再支持 app-side EVM nonce gap 处理能力

## 13. 更本质的修复方向

从设计上看，真正该修的不是压测脚本，而是 promoted 回调与本地广播之间的关系。

修复方向可以概括成一句话：

- 不要在 `ExperimentalEVMMempool` 的 promoted 路径里同步回灌本地 `BroadcastTxSync`

更具体一点，至少应满足下面之一：

1. promoted 回调必须脱离敏感锁边界再执行
2. promoted 后不要再同步广播回本地节点
3. 直接改为类似 `Krakatoa` 的内部收集与供块方式
4. 如果项目不再打算支持非独占路径，就应明确禁用或移除这条实现

## 14. 最后给一个最短记法

如果只记一个最短结论，可以记成：

- `deadlock-transfer.ts` 的本质作用不是制造业务流量
- 而是持续制造 nonce gap
- 在 `ExperimentalEVMMempool` 下，nonce gap 交易被 promoted 后会同步 `BroadcastTxSync`
- 这条回灌路径会重入本地 mempool/txpool
- 最终把 proposer 依赖的交易准备路径卡住，导致停出块

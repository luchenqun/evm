# `x/precisebank` 模块详细解析

> **致谢**：感谢 [Kava](https://www.kava.io/) 团队对本模块的宝贵贡献。

## 摘要

本文档详细说明了 Cosmos EVM 中的 `x/precisebank` 模块。

`x/precisebank` 模块负责扩展 `x/bank` 的精度，主要用于 `x/evm` 模块。它作为 `x/bank` 的包装器，将 ATOM 的精度从 6 位小数扩展到 18 位小数，同时保持现有 `x/bank` 余额的行为不变。

该模块仅由 `x/evm` 使用，因为 EVM 需要 18 位小数精度。

## 目录

- [背景](#背景)
    - [核心概念](#核心概念)
    - [余额表示](#余额表示)
    - [储备账户](#储备账户)
- [操作详解](#操作详解)
    - [增加余额（Adding）](#增加余额adding)
    - [减少余额（Subtracting）](#减少余额subtracting)
    - [转账（Transfer）](#转账transfer)
    - [销毁（Burn）](#销毁burn)
    - [铸造（Mint）](#铸造mint)
- [状态管理](#状态管理)
- [Keepers](#keepers)
- [消息](#消息)
- [事件](#事件)
- [客户端查询](#客户端查询)

---

## 背景

### 核心概念

在 Cosmos 链上，标准货币单位是 `ATOM`，其原子单位是 `uatom`，表示 $10^{-6}$ `ATOM`，即 1 `ATOM` = $10^6$ `uatom`。

为了支持 18 位小数精度，同时保持 `uatom` 作为 Cosmos 原生原子单位，我们将每个 `uatom` 单位进一步拆分为 $10^{12}$ 个 `aatom` 单位，这是 Cosmos EVM 的原生货币。

这样就实现了 EVM 所需的 $10^{18}$ 精度。为了避免与原子单位 `uatom` 混淆，我们将 `aatom` 称为"亚原子单位"（sub-atomic units）。

**总结**：
- `uatom`：Cosmos 原生单位，Cosmos 链的原子单位（6 位小数）
- `aatom`：EVM 原生单位，Cosmos 链的亚原子单位（18 位小数）

### 余额表示

为了保持 `aatom` 供应量与 `uatom` 供应量的一致性，我们添加了一个约束：每个亚原子 `aatom` 只能作为原子 `uatom` 的一部分存在。每个 `aatom` 都由 `x/bank` 模块中的 `uatom` 完全支持。

这是必需的，因为 `x/bank` 中的 `uatom` 余额在 Cosmos 模块和 EVM 之间共享。我们使用 `x/precisebank` 模块包装和扩展 `x/bank` 模块，以增加额外的 $10^{12}$ 单位精度。

**通俗理解**：
- 如果 EVM 中转账 $10^{12}$ `aatom`，Cosmos 模块会看到 1 `uatom` 的转账
- 如果 `aatom` 没有完全由 `uatom` 支持，那么 Cosmos 和 EVM 之间的余额变化将不一致

### 数学定义

我们定义以下变量：
- $a(n)$：账户 `n` 的 `aatom` 余额（总余额）
- $b(n)$：账户 `n` 的 `uatom` 余额（存储在 `x/bank` 模块中）
- $f(n)$：账户 `n` 的分数余额（存储在 `x/precisebank` 模块中）
- $C$：转换因子，等于 $10^{12}$

任何能被 $C$ 整除的 $a(n)$ 都可以表示为 $C \times b(n)$。不能被 $C$ 整除的余数，我们定义为"分数余额" $f(n)$，存储在 `x/precisebank` 存储中。

因此：

$$a(n) = b(n) \cdot C + f(n)$$

其中：

$$0 \le f(n) < C$$

$$a(n), b(n) \ge 0$$

这是商余定理，任何 $a(n)$ 都可以用唯一的整数 $b(n)$ 和 $f(n)$ 表示：

$$b(n) = \lfloor a(n)/C \rfloor$$

$$f(n) = a(n) \bmod C$$

在这个定义下，我们将 $b(n)$ 单位称为**整数单位**，$f(n)$ 称为**分数单位**。

**通俗例子**：

假设账户有 1,500,000,000,000,500 `aatom`：
- 整数部分：$b(n) = \lfloor 1,500,000,000,000,500 / 10^{12} \rfloor = 1,500$ `uatom`
- 分数部分：$f(n) = 1,500,000,000,000,500 \bmod 10^{12} = 500$ `aatom`
- 总余额：$a(n) = 1,500 \times 10^{12} + 500 = 1,500,000,000,000,500$ `aatom`

### 储备账户

由于 $f(n)$ 存储在 `x/precisebank` 中，而不是由 `x/bank` keeper 跟踪，这些余额不计入 `uatom` 供应量。

如果我们定义：
- $T_a \equiv \sum_{n \in \mathcal{A}}{a(n)}$：所有账户的总 `aatom` 供应量
- $T_b \equiv \sum_{n \in \mathcal{A}}{b(n)}$：所有账户的总 `uatom` 供应量

其中 $\mathcal{A}$ 是所有账户的集合。

那么需要添加一个储备账户 $R$，使得：

$$a(R) = 0$$

$$b(R) \cdot C = \sum_{n \in \mathcal{A}}{f(n)} + r$$

其中：
- $R$ 是 `x/precisebank` 的模块账户
- $r$ 是余数（remainder），表示由 $b(R)$ 支持但尚未流通的分数金额

因此：

$$T_a = T_b \cdot C - r$$

且

$$0 \le r < C$$

**通俗理解**：
- 储备账户存储所有分数余额对应的 `uatom`
- 余数 $r$ 表示储备账户中尚未分配给任何账户的分数余额
- 这确保了所有 `aatom` 都由 `uatom` 完全支持

**例子**：
- 假设所有账户的分数余额总和为 500,000,000,000 `aatom`
- 余数为 200,000,000,000 `aatom`
- 那么储备账户需要存储：$(500,000,000,000 + 200,000,000,000) / 10^{12} = 0.7$ `uatom`

---

## 操作详解

### 增加余额（Adding）

当增加余额时：

$$a'(n) = a(n) + a$$

$$b'(n) \cdot C + f'(n) = b(n) \cdot C + f(n) + a$$

其中 $a'(n)$ 是增加 `aatom` 金额 $a$ 后的新 `aatom` 余额。

新的 $b'(n)$ 和 $f'(n)$ 可以通过以下公式确定：

$$f'(n) = (f(n) + a) \bmod C$$

$$b'(n) = \begin{cases} 
b(n) + \lfloor a/C \rfloor & f'(n) \geq f(n) \\
b(n) + \lfloor a/C \rfloor + 1 & f'(n) < f(n) 
\end{cases}$$

**关键点**：如果 $f'(n) < f(n)$，说明发生了进位（carry），需要将 1 个整数单位从分数单位进位到整数单位。

**通俗例子**：

假设账户当前余额：
- 整数余额：$b(n) = 1000$ `uatom`
- 分数余额：$f(n) = 999,999,999,999$ `aatom`（接近 $10^{12}$）
- 总余额：$a(n) = 1000 \times 10^{12} + 999,999,999,999 = 1,000,999,999,999,999$ `aatom`

现在增加 500 `aatom`：
- 新分数余额：$f'(n) = (999,999,999,999 + 500) \bmod 10^{12} = 500$ `aatom`
- 因为 $f'(n) = 500 < f(n) = 999,999,999,999$，发生了进位
- 新整数余额：$b'(n) = 1000 + \lfloor 500/10^{12} \rfloor + 1 = 1000 + 0 + 1 = 1001$ `uatom`
- 新总余额：$a'(n) = 1001 \times 10^{12} + 500 = 1,001,000,000,000,500$ `aatom`

**代码实现**（参考 `x/precisebank/keeper/mint.go`）：

```go
// 计算新的分数余额
newFractionalBalance := oldFractionalBalance.Add(amount).Mod(conversionFactor)

// 判断是否发生进位
if newFractionalBalance.LT(oldFractionalBalance) {
    // 发生进位，整数余额需要加 1
    integerCarry = true
}
```

### 减少余额（Subtracting）

当减少余额时：

$$a'(n) = a(n) - a$$

$$b'(n) \cdot C + f'(n) = b(n) \cdot C + f(n) - a$$

新的余额计算：

$$f'(n) = (f(n) - a) \bmod C$$

$$b'(n) = \begin{cases} 
b(n) - \lfloor a/C \rfloor & f'(n) \leq f(n) \\
b(n) - \lfloor a/C \rfloor - 1 & f'(n) > f(n) 
\end{cases}$$

**关键点**：如果 $f'(n) > f(n)$，说明发生了借位（borrow），需要从整数单位借 1 个单位到分数单位。

**通俗例子**：

假设账户当前余额：
- 整数余额：$b(n) = 1000$ `uatom`
- 分数余额：$f(n) = 500$ `aatom`
- 总余额：$a(n) = 1000 \times 10^{12} + 500 = 1,000,000,000,000,500$ `aatom`

现在减少 1,000 `aatom`：
- 新分数余额：$f'(n) = (500 - 1,000) \bmod 10^{12} = 10^{12} - 500 = 999,999,999,500$ `aatom`
- 因为 $f'(n) = 999,999,999,500 > f(n) = 500$，发生了借位
- 新整数余额：$b'(n) = 1000 - \lfloor 1,000/10^{12} \rfloor - 1 = 1000 - 0 - 1 = 999$ `uatom`
- 新总余额：$a'(n) = 999 \times 10^{12} + 999,999,999,500 = 999,999,999,999,500$ `aatom`

### 转账（Transfer）

转账是在两个不同账户之间对单个金额进行增加和减少的组合操作。如果发送方的减少和接收方的增加都有效，则转账有效。

#### 设置

假设两个账户 1 和 2 的余额分别为 $a(1)$ 和 $a(2)$，$a$ 是要转账的金额。假设 $a(1) \ge a$ 以确保转账有效。

我们通过从账户 1 减去 $a$ 并向账户 2 添加 $a$ 来启动转账：

$$a'(1) = a(1) - a$$

$$a'(2) = a(2) + a$$

储备账户也必须更新以反映分数单位总供应量的变化。

#### 余数不变

**重要结论**：在转账过程中，余数 $r$ **不会改变**。

**数学证明**：

取模 $C$ 后：

$$0 = (f'(1) - f(1) + f'(2) - f(2) + r' - r) \bmod C$$

替换 $f'(1)$ 和 $f'(2)$：

$$0 = ((f(1) - a) \bmod C - f(1) + (f(2) + a) \bmod C - f(2) + r' - r) \bmod C$$

简化后：

$$0 = (r' - r) \bmod C$$

由于 $0 \le r' < C$ 和 $0 \le r < C$，我们有 $-C < r' - r < C$，这意味着 $r' - r = 0$。

**通俗理解**：
- 转账只是将余额从一个账户转移到另一个账户
- 总供应量不变，所以余数也不变

#### 储备账户更新

储备账户必须更新以反映两个账户分数单位的变化。

储备账户的变化由两个账户分数单位的变化决定：

$$(b'(R) - b(R)) \cdot C = f'(1) - f(1) + f'(2) - f(2)$$

根据 $f'(1)$ 和 $f'(2)$ 的变化，有四种情况：

$$b'(R) - b(R) = \begin{cases} 
0 & f'(1) > f(1) \land f'(2) < f(2) \\
-1 & f'(1) \leq f(1) \land f'(2) < f(2) \\
1 & f'(1) > f(1) \land f'(2) \geq f(2) \\
0 & f'(1) \leq f(1) \land f'(2) \geq f(2) 
\end{cases}$$

**四种情况的通俗解释**：

1. **情况 1**：发送方借位，接收方进位 → 储备不变（借位和进位抵消）
2. **情况 2**：发送方不借位，接收方进位 → 储备减少 1 `uatom`（需要从储备中提取）
3. **情况 3**：发送方借位，接收方不进位 → 储备增加 1 `uatom`（需要存入储备）
4. **情况 4**：发送方不借位，接收方不进位 → 储备不变

**代码实现**（参考 `x/precisebank/keeper/send.go`）：

```go
// 计算发送方和接收方的分数余额变化
senderFractionalDelta := newSenderFractional.Sub(oldSenderFractional)
receiverFractionalDelta := newReceiverFractional.Sub(oldReceiverFractional)

// 判断是否需要更新储备账户
if senderFractionalDelta.IsNegative() && receiverFractionalDelta.IsPositive() {
    // 情况 1：借位和进位抵消，储备不变
} else if receiverFractionalDelta.IsPositive() {
    // 情况 2：需要从储备中提取
    reserveDelta = -1
} else if senderFractionalDelta.IsNegative() {
    // 情况 3：需要存入储备
    reserveDelta = 1
}
```

**完整例子**：

假设：
- 账户 A：整数余额 1000 `uatom`，分数余额 500 `aatom`
- 账户 B：整数余额 2000 `uatom`，分数余额 999,999,999,999 `aatom`
- 转账金额：1,000,000,000,000,500 `aatom`（1 `uatom` + 500 `aatom`）

转账后：
- 账户 A：整数余额 999 `uatom`，分数余额 999,999,999,999 `aatom`（借位）
- 账户 B：整数余额 2001 `uatom`，分数余额 499 `aatom`（进位）

储备变化：
- 账户 A 分数余额变化：$999,999,999,999 - 500 = 999,999,999,499$（增加，需要从储备提取）
- 账户 B 分数余额变化：$499 - 999,999,999,999 = -999,999,999,500$（减少，但发生了进位）
- 净变化：需要从储备中提取 1 `uatom`

### 销毁（Burn）

销毁时，我们只改变一个账户。假设我们从账户 1 销毁金额 $a$：

$$a'(1) = a(1) - a$$

储备账户的变化由账户分数单位的变化和余数的变化决定：

$$(b'(R) - b(R)) \cdot C = f'(1) - f(1) + r' - r$$

新的分数余额：

$$f'(1) = (f(1) - a) \bmod C$$

我们通过将 $a$ 添加到 $r$ 来更新余数，因为销毁增加了不再流通但仍由储备支持的金额：

$$r' = (r + a) \bmod C$$

储备账户根据账户分数单位和余数的变化进行更新：

$$b'(R) - b(R) = \begin{cases} 
0 & f'(1) > f(1) \land r' < r \\
-1 & f'(1) \leq f(1) \land r' < r \\
1 & f'(1) > f(1) \land r' \geq r \\
0 & f'(1) \leq f(1) \land r' \geq r 
\end{cases}$$

**通俗例子**：

假设：
- 账户余额：整数 1000 `uatom`，分数 500 `aatom`
- 当前余数：$r = 200,000,000,000$ `aatom`
- 销毁金额：300 `aatom`

销毁后：
- 新分数余额：$f'(1) = (500 - 300) \bmod 10^{12} = 200$ `aatom`
- 新余数：$r' = (200,000,000,000 + 300) \bmod 10^{12} = 200,000,000,300$ `aatom`
- 因为 $f'(1) = 200 < f(1) = 500$ 且 $r' = 200,000,000,300 > r = 200,000,000,000$，储备不变

### 铸造（Mint）

铸造类似于销毁，但我们向账户添加而不是移除。假设我们向账户 1 铸造金额 $a$：

$$a'(1) = a(1) + a$$

储备账户的变化由账户分数单位的变化和余数的变化决定：

$$(b'(R) - b(R)) \cdot C = f'(1) - f(1) + r' - r$$

新的分数余额：

$$f'(1) = (f(1) + a) \bmod C$$

我们通过从 $r$ 中减去 $a$ 来更新余数，因为铸造减少了不再流通但仍由储备支持的金额：

$$r' = (r - a) \bmod C$$

储备账户根据账户分数单位和余数的变化进行更新：

$$b'(R) - b(R) = \begin{cases} 
0 & r' > r \land f'(1) < f(1) \\
-1 & r' \leq r \land f'(1) < f(1) \\
1 & r' > r \land f'(1) \geq f(1) \\
0 & r' \leq r \land f'(1) \geq f(1) 
\end{cases}$$

**通俗例子**：

假设：
- 账户余额：整数 1000 `uatom`，分数 999,999,999,999 `aatom`
- 当前余数：$r = 200,000,000,000$ `aatom`
- 铸造金额：500 `aatom`

铸造后：
- 新分数余额：$f'(1) = (999,999,999,999 + 500) \bmod 10^{12} = 499$ `aatom`（发生进位）
- 新整数余额：$b'(1) = 1000 + 1 = 1001$ `uatom`
- 新余数：$r' = (200,000,000,000 - 500) \bmod 10^{12} = 199,999,999,500$ `aatom`
- 因为 $f'(1) = 499 < f(1) = 999,999,999,999$ 且 $r' = 199,999,999,500 < r = 200,000,000,000$，储备减少 1 `uatom`

---

## 状态管理

`x/precisebank` 模块保持以下状态：

1. **账户分数余额**：每个账户的分数余额存储在 `x/precisebank` 的 KVStore 中。

2. **余数金额**：余数表示由储备账户支持但尚未流通的分数金额。如果铸造的分数金额小于 1 `uatom`，这可能非零。

   **注意**：目前，铸造和销毁仅用于通过 `x/evm` 在账户之间转移分数金额。这意味着在主网状态下，每个交易和区块结束时，铸造和销毁总是相等且相反，余数始终为零。

`x/precisebank` 模块不跟踪储备，因为它存储在 `x/bank` 模块中。

---

## Keepers

`x/precisebank` 模块只暴露一个 keeper，它包装了 bank 模块 keeper 并实现与 bank keeper 兼容的方法以支持扩展代币。这符合 `x/evm` 模块的 `BankKeeper` 接口。

```go
type BankKeeper interface {
    authtypes.BankKeeper
    SpendableCoin(ctx sdk.Context, addr sdk.AccAddress, denom string) sdk.Coin
    SendCoinsFromModuleToAccount(ctx sdk.Context, senderModule string, recipientAddr sdk.AccAddress, amt sdk.Coins) error
    MintCoins(ctx sdk.Context, moduleName string, amt sdk.Coins) error
    BurnCoins(ctx sdk.Context, moduleName string, amt sdk.Coins) error
}
```

---

## 消息

`x/precisebank` 模块没有任何消息，旨在被其他模块用作 bank 模块的替代品。

---

## 事件

### Keeper 事件

`x/precisebank` 模块发出以下事件，这些事件旨在匹配 `x/bank` 模块发出的事件。`x/precisebank` 发出的事件只包含 `aatom` 金额，因为 `x/bank` 模块会发出包含所有其他代币的事件。这意味着如果账户转移包括 `aatom` 在内的多种代币，`x/precisebank` 模块将发出包含完整 `aatom` 金额的事件。如果 `uatom` 包含在转账、铸造或销毁中，`x/precisebank` 模块将发出包含完整等效 `aatom` 金额的事件。

#### SendCoins

```json
{
  "type": "transfer",
  "attributes": [
    {
      "key": "recipient",
      "value": "{{接收方的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "sender",
      "value": "{{发送方的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在转移的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

```json
{
  "type": "coin_spent",
  "attributes": [
    {
      "key": "spender",
      "value": "{{正在花费代币的地址的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在花费的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

```json
{
  "type": "coin_received",
  "attributes": [
    {
      "key": "receiver",
      "value": "{{接收代币的地址的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在接收的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

#### MintCoins

```json
{
  "type": "coinbase",
  "attributes": [
    {
      "key": "minter",
      "value": "{{正在铸造代币的模块的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在铸造的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

```json
{
  "type": "coin_received",
  "attributes": [
    {
      "key": "receiver",
      "value": "{{正在铸造代币的模块的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在接收的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

#### BurnCoins

```json
{
  "type": "burn",
  "attributes": [
    {
      "key": "burner",
      "value": "{{正在销毁代币的模块的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在销毁的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

```json
{
  "type": "coin_spent",
  "attributes": [
    {
      "key": "spender",
      "value": "{{正在销毁代币的模块的 sdk.AccAddress}}",
      "index": true
    },
    {
      "key": "amount",
      "value": "{{正在销毁的 sdk.Coins}}",
      "index": true
    }
  ]
}
```

---

## 客户端查询

### gRPC

用户可以使用 gRPC 端点查询 precisebank 模块。

#### TotalFractionalBalances

`TotalFractionalBalances` 端点允许用户查询所有分数余额的聚合总和。这主要用于外部验证模块状态与储备余额。

```shell
cosmos.evm.precisebank.v1.Query/TotalFractionalBalances
```

**示例**：

```shell
grpcurl -plaintext \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/TotalFractionalBalances
```

**示例输出**：

```json
{
  "total": "2000000000000aatom"
}
```

**说明**：返回所有账户的分数余额总和，用于验证储备账户是否正确支持所有分数余额。

#### Remainder

`Remainder` 端点允许用户查询当前余数金额。

```shell
cosmos.evm.precisebank.v1.Query/Remainder
```

**示例**：

```shell
grpcurl -plaintext \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/Remainder
```

**示例输出**：

```json
{
  "remainder": "100aatom"
}
```

**说明**：余数表示由储备账户支持但尚未分配给任何账户的分数金额。

#### FractionalBalance

`FractionalBalance` 端点允许用户查询特定账户的分数余额。

```shell
cosmos.evm.precisebank.v1.Query/FractionalBalance
```

**示例**：

```shell
grpcurl -plaintext \
  -d '{"address": "cosmos1..."}' \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/FractionalBalance
```

**示例输出**：

```json
{
  "fractional_balance": "10000aatom"
}
```

**说明**：返回指定账户的分数余额（不包括整数余额）。

---

## 总结

`x/precisebank` 模块通过以下方式扩展了 `x/bank` 的精度：

1. **精度扩展**：将 6 位小数扩展到 18 位小数，满足 EVM 的需求
2. **余额分离**：将余额分为整数部分（存储在 `x/bank`）和分数部分（存储在 `x/precisebank`）
3. **储备机制**：通过储备账户确保所有 `aatom` 都由 `uatom` 完全支持
4. **一致性保证**：确保 Cosmos 模块和 EVM 之间的余额变化保持一致

该模块的设计确保了在保持 Cosmos SDK 原生精度的同时，为 EVM 提供了所需的 18 位小数精度。

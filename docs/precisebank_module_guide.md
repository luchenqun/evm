# PreciseBank 模块功能说明与测试指南

## 目录

- [模块概述](#模块概述)
- [核心概念](#核心概念)
- [功能详解](#功能详解)
- [状态管理](#状态管理)
- [交易测试指南](#交易测试指南)
- [查询接口](#查询接口)
- [常见操作示例](#常见操作示例)
- [代币配置](#代币配置)
- [注意事项](#注意事项)
- [故障排查](#故障排查)
- [参考资料](#参考资料)

## 模块概述

`x/precisebank` 模块是 Cosmos EVM 链上的一个核心模块，其主要功能是扩展 `x/bank` 模块的精度，将配置的 EVM 原生代币的精度从较低精度（如 6 位小数）扩展到 18 位小数，以满足 EVM（以太坊虚拟机）对 18 位小数精度的要求。

### 重要说明：代币支持

**`precisebank` 模块只支持一个特定的 EVM 原生代币**，该代币在应用初始化时通过 `EvmCoinInfo` 配置指定。虽然文档中经常使用 ATOM（`uatom`/`aatom`）作为示例，但这只是为了说明概念。实际上：

1. **支持任意代币**：模块支持任意配置的 EVM 原生代币，不限于 ATOM
2. **单一代币限制**：每个链只能配置一个 EVM 原生代币使用 `precisebank` 模块
3. **其他代币直通**：其他代币的交易会直接通过 `x/bank` 模块处理，不经过 `precisebank`
4. **配置方式**：代币信息在应用初始化时通过 `x/vm` 模块的 `EvmCoinInfo` 配置

**配置示例**：
- 6 位小数代币：`utest` → `atest`（扩展精度）
- 12 位小数代币：`ptest2` → `atest2`（扩展精度）
- 18 位小数代币：`atest` → `atest`（无需扩展，denom 相同）

### 设计目标

1. **精度扩展**：将配置的 EVM 原生代币从较低精度扩展到 18 位小数精度
2. **兼容性**：保持与现有 `x/bank` 模块的完全兼容
3. **一致性**：确保扩展代币供应量与原始代币供应量保持一致
4. **透明性**：对 EVM 用户透明，自动处理精度转换

## 核心概念

### 货币单位

以下以 ATOM 为例说明，但实际支持的代币由配置决定。

#### 整数代币（Integer Coin，如 uatom）
- **定义**：Cosmos 链的原生原子单位（由配置决定，如 `uatom`、`utest` 等）
- **精度**：取决于链配置（常见为 6 位小数，即 $10^{-6}$）
- **关系**：1 主单位 = $10^n$ 原子单位（n 为小数位数）
- **存储位置**：`x/bank` 模块
- **获取方式**：`types.IntegerCoinDenom()` → `evmtypes.GetEVMCoinDenom()`

#### 扩展代币（Extended Coin，如 aatom）
- **定义**：EVM 原生的扩展单位（由配置决定，如 `aatom`、`atest` 等）
- **精度**：固定为 18 位小数（$10^{-18}$）
- **关系**：1 整数单位 = $10^{12}$ 扩展单位（当整数单位为 6 位小数时）
- **存储位置**：`x/precisebank` 模块（分数余额部分）
- **获取方式**：`types.ExtendedCoinDenom()` → `evmtypes.GetEVMCoinExtendedDenom()`

**注意**：如果配置的 EVM 原生代币已经是 18 位小数，则整数代币和扩展代币的 denom 相同，无需精度扩展。

### 转换因子

转换因子 $C = 10^{12}$，用于在 `uatom` 和 `aatom` 之间转换。

### 余额表示

账户的 `aatom` 余额 $a(n)$ 由两部分组成：

$$a(n) = b(n) \cdot C + f(n)$$

其中：
- $b(n)$：整数余额（存储在 `x/bank` 中，单位为 `uatom`）
- $f(n)$：分数余额（存储在 `x/precisebank` 中，单位为 `aatom`）
- $0 \le f(n) < C$（分数余额必须小于转换因子）

### 储备账户（Reserve Account）

储备账户 $R$ 是 `x/precisebank` 模块账户，用于维护系统的一致性：

$$b(R) \cdot C = \sum_{n \in \mathcal{A}}{f(n)} + r$$

其中：
- $b(R)$：储备账户的 `uatom` 余额
- $r$：余数（remainder），表示已备份但尚未流通的分数金额
- $0 \le r < C$

总供应量关系：

$$T_a = T_b \cdot C - r$$

其中：
- $T_a$：总 `aatom` 供应量
- $T_b$：总 `uatom` 供应量

## 功能详解

### 1. 添加（Adding）

当向账户添加 `aatom` 时：

$$a'(n) = a(n) + a$$

新的分数余额和整数余额计算：

$$f'(n) = f(n) + a \mod{C}$$

$$b'(n) = \begin{cases} 
b(n) + \lfloor a/C \rfloor & f'(n) \geq f(n) \\
b(n) + \lfloor a/C \rfloor + 1 & f'(n) < f(n) 
\end{cases}$$

**说明**：如果 $f'(n) < f(n)$，说明发生了进位，需要从分数余额向整数余额进位 1 个单位。

### 2. 扣除（Subtracting）

当从账户扣除 `aatom` 时：

$$a'(n) = a(n) - a$$

新的分数余额和整数余额计算：

$$f'(n) = f(n) - a \mod{C}$$

$$b'(n) = \begin{cases} 
b(n) - \lfloor a/C \rfloor & f'(n) \leq f(n) \\
b(n) - \lfloor a/C \rfloor - 1 & f'(n) > f(n) 
\end{cases}$$

**说明**：如果 $f'(n) > f(n)$，说明分数余额不足，需要从整数余额借位 1 个单位。

### 3. 转账（Transfer）

转账涉及两个账户：发送方和接收方。

#### 转账过程

1. 从发送方扣除：$a'(1) = a(1) - a$
2. 向接收方添加：$a'(2) = a(2) + a$
3. 更新储备账户以反映分数余额的变化

#### 四种转账情况

转账时可能出现四种情况：

| 情况 | 发送方借位 | 接收方进位 | 储备账户变化     |
| ---- | ---------- | ---------- | ---------------- |
| 1    | 是         | 是         | 不变（直接转账） |
| 2    | 是         | 否         | -1 uatom         |
| 3    | 否         | 是         | +1 uatom         |
| 4    | 否         | 否         | 不变             |

**重要特性**：转账过程中，余数（remainder）$r$ 保持不变。

### 4. 铸造（Mint）

铸造时，向账户添加 `aatom`，同时更新余数：

$$r' = r - a \mod{C}$$

储备账户的变化取决于分数余额和余数的变化。

### 5. 销毁（Burn）

销毁时，从账户扣除 `aatom`，同时更新余数：

$$r' = r + a \mod{C}$$

储备账户的变化取决于分数余额和余数的变化。

## 状态管理

### 存储的数据

1. **账户分数余额**：每个账户的分数余额 $f(n)$，存储在 `x/precisebank` 的状态存储中
2. **余数（Remainder）**：$r$，表示已备份但尚未流通的分数金额

### 不存储的数据

- **整数余额**：存储在 `x/bank` 模块中
- **储备账户余额**：存储在 `x/bank` 模块中

## 交易测试指南

### 前置准备

1. **启动本地节点**

```bash
# 使用提供的脚本启动本地节点
./local_node.sh

# 或者使用 Makefile
make run
```

2. **配置客户端**

```bash
# 设置链 ID 和节点地址
export CHAIN_ID=evm_9000-1
export NODE_URL=http://localhost:26657
export RPC_URL=http://localhost:8545
```

### 测试方法

#### 方法一：通过 EVM 交易测试

`x/precisebank` 模块主要用于支持 EVM 交易，所有通过 EVM 发送的 ETH 交易都会自动使用该模块处理配置的扩展代币（由链的 `evm_denom` 和 `extended_denom` 配置决定）。

**重要说明**：
- 在 EVM 层面，用户始终使用 ETH（18 位小数）作为单位
- 底层实际使用的代币由链配置决定，不是硬编码的
- 可以通过查询链的 EVM 参数或查看 genesis.json 了解实际使用的代币

**示例：发送 ETH 转账交易**

在 EVM 层面，用户发送的是 ETH（18 位小数），但底层实际使用的是配置的扩展代币（由 `evm_denom` 和 `extended_denom` 配置决定，如 `atest`、`stake` 等）。

```javascript
// 使用 ethers.js
const ethers = require('ethers');

const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

// 发送 0.1 ETH（底层实际是配置的扩展代币，如 atest）
// 注意：实际使用的代币由链的配置决定，不是硬编码的 aatom
const tx = await wallet.sendTransaction({
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: ethers.utils.parseEther('0.1') // 0.1 ETH（18 位小数）
});

await tx.wait();
console.log('Transaction hash:', tx.hash);
```

**示例：使用 web3.js**

```javascript
const Web3 = require('web3');
const web3 = new Web3('http://localhost:8545');

const account = web3.eth.accounts.privateKeyToAccount('0xYOUR_PRIVATE_KEY');
web3.eth.accounts.wallet.add(account);

const tx = {
  from: account.address,
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: web3.utils.toWei('0.1', 'ether'), // 0.1 ETH（18 位小数）
  gas: 21000
};

const receipt = await web3.eth.sendTransaction(tx);
console.log('Transaction hash:', receipt.transactionHash);
```

**重要说明**：
- EVM 交易中，用户始终使用 ETH（18 位小数）作为单位
- 底层实际使用的代币由链的 `evm_denom` 和 `extended_denom` 配置决定
- 可以通过查询链配置或 genesis.json 查看实际使用的代币名称
- 如果配置的是 18 位小数代币，则 `evm_denom` 和 `extended_denom` 相同
- 如果配置的是小于 18 位小数的代币，`precisebank` 模块会自动处理精度扩展

#### 方法二：通过 Cosmos SDK 交易测试

虽然 `x/precisebank` 模块本身不提供消息类型，但可以通过其他模块（如 `x/evm`）间接使用。

**示例：查询余额**

```bash
# 查询账户的 Cosmos 余额（整数代币，如 utest、uatom 等，取决于配置）
evmd query bank balances <cosmos_address>

# 查询账户的分数余额（扩展代币，如 atest、aatom 等，取决于配置）
evmd query precisebank fractional-balance <cosmos_address>

# 查看链配置的实际代币名称
evmd query evm params
# 或查看 genesis.json 中的 evm_denom 和 extended_denom_options
```

#### 方法三：通过集成测试

项目提供了完整的集成测试套件，位于 `tests/integration/x/precisebank/`。

**运行测试**

```bash
# 运行所有 precisebank 集成测试
go test -v ./tests/integration/x/precisebank/...

# 运行特定测试
go test -v ./tests/integration/x/precisebank/ -run TestSendCoins
```

**测试示例代码**

```go
// 参考 tests/integration/x/precisebank/test_send_integration.go

// 1. 设置测试环境
s.SetupTest()

// 2. 创建账户
sender := sdk.AccAddress([]byte{1})
recipient := sdk.AccAddress([]byte{2})

// 3. 铸造初始余额
initialBalance := types.ConversionFactor().MulRaw(100)
initialCoins := sdk.NewCoins(sdk.NewCoin(types.ExtendedCoinDenom(), initialBalance))
s.Require().NoError(s.network.App.GetPreciseBankKeeper().MintCoins(
    s.network.GetContext(), 
    evmtypes.ModuleName, 
    initialCoins,
))
s.Require().NoError(s.network.App.GetPreciseBankKeeper().SendCoinsFromModuleToAccount(
    s.network.GetContext(), 
    evmtypes.ModuleName, 
    sender, 
    initialCoins,
))

// 4. 执行转账
transferAmount := types.ConversionFactor().MulRaw(50).AddRaw(500)
transferCoins := sdk.NewCoins(sdk.NewCoin(types.ExtendedCoinDenom(), transferAmount))
err := s.network.App.GetPreciseBankKeeper().SendCoins(
    s.network.GetContext(),
    sender,
    recipient,
    transferCoins,
)
s.Require().NoError(err)

// 5. 验证余额
senderBal := s.GetAllBalances(sender).AmountOf(types.ExtendedCoinDenom())
recipientBal := s.GetAllBalances(recipient).AmountOf(types.ExtendedCoinDenom())
```

## 查询接口

### gRPC 查询

#### 1. TotalFractionalBalances（总分数余额）

查询所有账户的分数余额总和。

**gRPC 端点**：
```
cosmos.evm.precisebank.v1.Query/TotalFractionalBalances
```

**使用 grpcurl**：
```bash
grpcurl -plaintext \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/TotalFractionalBalances
```

**响应示例**：
```json
{
  "total": "2000000000000aatom"
}
```

**使用 CLI**：
```bash
# 注意：CLI 命令可能未实现，优先使用 gRPC
```

#### 2. Remainder（余数）

查询当前的余数金额。

**gRPC 端点**：
```
cosmos.evm.precisebank.v1.Query/Remainder
```

**使用 grpcurl**：
```bash
grpcurl -plaintext \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/Remainder
```

**响应示例**：
```json
{
  "remainder": "100aatom"
}
```

**使用 CLI**：
```bash
evmd query precisebank remainder
```

#### 3. FractionalBalance（账户分数余额）

查询特定账户的分数余额。

**gRPC 端点**：
```
cosmos.evm.precisebank.v1.Query/FractionalBalance
```

**使用 grpcurl**：
```bash
grpcurl -plaintext \
  -d '{"address": "cosmos1..."}' \
  localhost:9090 \
  cosmos.evm.precisebank.v1.Query/FractionalBalance
```

**响应示例**：
```json
{
  "fractional_balance": "10000aatom"
}
```

**使用 CLI**：
```bash
evmd query precisebank fractional-balance cosmos1...
```

### 验证查询结果

查询后，可以通过以下公式验证结果的一致性：

1. **总分数余额验证**：
   ```
   总分数余额 + 余数 = 储备账户余额 × 转换因子
   ```

2. **账户余额验证**：
   ```
   账户总余额（aatom）= 整数余额（uatom）× 10^12 + 分数余额（aatom）
   ```

## 常见操作示例

### 示例 1：小额转账测试

测试小于 1 整数单位的转账（仅涉及分数余额）。

```bash
# 1. 查询发送方余额（整数代币，如 utest、uatom 等）
evmd query bank balances <sender_address>

# 2. 发送小额 EVM 交易（例如 0.000001 ETH = 1000000000000 wei）
# 使用 ethers.js 或 web3.js 发送交易
# 注意：实际使用的代币由链配置决定

# 3. 查询分数余额变化（扩展代币，如 atest、aatom 等）
evmd query precisebank fractional-balance <sender_address>
evmd query precisebank fractional-balance <recipient_address>

# 4. 验证储备账户未变化（因为余数不变）
evmd query precisebank remainder
```

### 示例 2：大额转账测试

测试大于 1 整数单位的转账（涉及整数和分数余额）。

```bash
# 1. 发送大额 EVM 交易（例如 1.5 ETH）
# 这会涉及：
# - 1 整数单位的转账（通过 x/bank，如 1 utest、1 uatom 等）
# - 0.5 整数单位 = 500000000000 wei 的分数转账（通过 x/precisebank）
# 注意：实际使用的代币和转换因子由链配置决定

# 2. 查询余额变化
evmd query bank balances <sender_address>
evmd query bank balances <recipient_address>
evmd query precisebank fractional-balance <sender_address>
evmd query precisebank fractional-balance <recipient_address>

# 3. 验证储备账户可能的变化（取决于借位/进位情况）
evmd query precisebank remainder
```

### 示例 3：边界情况测试

测试分数余额的边界情况。

```go
// 测试分数余额接近转换因子的情况
// 转换因子 = 10^12 = 1000000000000

// 情况 1：分数余额接近最大值
fractionalBalance := types.ConversionFactor().SubRaw(1) // 999999999999

// 情况 2：添加导致进位
addAmount := sdkmath.NewInt(2) // 添加 2 aatom
// 结果：分数余额变为 1，整数余额增加 1

// 情况 3：扣除导致借位
subAmount := sdkmath.NewInt(500000000001) // 扣除超过当前分数余额
// 结果：需要从整数余额借位
```

### 示例 4：批量交易测试

测试连续多次转账对储备账户的影响。

```bash
# 1. 执行多次小额转账
# 2. 每次转账后查询余数
evmd query precisebank remainder

# 3. 验证余数在每次转账后保持不变（因为转账不改变余数）
```

### 示例 5：铸造和销毁测试

测试铸造和销毁操作（通常由 `x/evm` 模块调用）。

```go
// 铸造测试
mintAmount := types.ConversionFactor().QuoRaw(2) // 0.5 uatom = 500000000000 aatom
mintCoins := sdk.NewCoins(sdk.NewCoin(types.ExtendedCoinDenom(), mintAmount))

err := keeper.MintCoins(ctx, moduleName, mintCoins)
// 这会：
// 1. 增加账户余额
// 2. 更新余数 r' = r - mintAmount mod C
// 3. 可能需要调整储备账户

// 销毁测试
burnAmount := types.ConversionFactor().QuoRaw(4) // 0.25 uatom
burnCoins := sdk.NewCoins(sdk.NewCoin(types.ExtendedCoinDenom(), burnAmount))

err := keeper.BurnCoins(ctx, moduleName, burnCoins)
// 这会：
// 1. 减少账户余额
// 2. 更新余数 r' = r + burnAmount mod C
// 3. 可能需要调整储备账户
```

## 事件

`x/precisebank` 模块会发出与 `x/bank` 模块兼容的事件，但只包含 `aatom` 金额。

### 转账事件

```json
{
  "type": "transfer",
  "attributes": [
    {
      "key": "recipient",
      "value": "cosmos1...",
      "index": true
    },
    {
      "key": "sender",
      "value": "cosmos1...",
      "index": true
    },
    {
      "key": "amount",
      "value": "1000000000000aatom",
      "index": true
    }
  ]
}
```

### 铸造事件

```json
{
  "type": "coinbase",
  "attributes": [
    {
      "key": "minter",
      "value": "cosmos1...",
      "index": true
    },
    {
      "key": "amount",
      "value": "500000000000aatom",
      "index": true
    }
  ]
}
```

### 销毁事件

```json
{
  "type": "burn",
  "attributes": [
    {
      "key": "burner",
      "value": "cosmos1...",
      "index": true
    },
    {
      "key": "amount",
      "value": "250000000000aatom",
      "index": true
    }
  ]
}
```

## 注意事项

1. **单一代币支持**：`precisebank` 模块只处理配置的 EVM 原生代币（通过 `EvmCoinInfo` 配置），其他代币的交易会直接通过 `x/bank` 模块处理。

2. **模块账户**：`x/precisebank` 模块账户（储备账户）不应该有分数余额，所有涉及该账户的转账都只处理整数部分。

3. **自转账**：向自己转账会被忽略，不会产生任何状态变化。

4. **精度限制**：分数余额必须满足 $0 \le f(n) < C$（C 为转换因子），超过此范围的金额会自动转换为整数余额。

5. **一致性保证**：系统保证总扩展代币供应量始终等于总整数代币供应量乘以转换因子减去余数。

6. **EVM 集成**：该模块主要供 `x/evm` 模块使用，EVM 交易会自动使用该模块进行余额管理。

7. **配置要求**：代币信息必须在应用初始化时通过 `x/vm` 模块的 `EVMConfigurator` 配置，运行时无法更改。

## 故障排查

### 问题 1：查询余额不一致

**症状**：通过不同接口查询的余额不一致。

**排查步骤**：
1. 检查是否同时查询了 `uatom` 和 `aatom`
2. 使用公式验证：`总余额 = 整数余额 × 10^12 + 分数余额`
3. 查询余数：`evmd query precisebank remainder`

### 问题 2：转账失败

**症状**：EVM 转账失败。

**排查步骤**：
1. 检查账户余额是否充足
2. 检查 gas 费用是否足够
3. 查看交易回执中的错误信息
4. 验证网络连接和节点状态

### 问题 3：储备账户余额异常

**症状**：储备账户余额不符合预期。

**排查步骤**：
1. 查询总分数余额：`grpcurl ... TotalFractionalBalances`
2. 查询余数：`evmd query precisebank remainder`
3. 验证公式：`储备余额 × 10^12 = 总分数余额 + 余数`

## 代币配置

### 如何配置支持的代币

`precisebank` 模块支持的代币在应用初始化时通过 `x/vm` 模块配置。配置示例：

```go
import (
    evmtypes "github.com/cosmos/evm/x/vm/types"
)

// 在应用初始化时配置
coinInfo := evmtypes.EvmCoinInfo{
    Denom:         "uatom",        // 整数代币 denom（6 位小数）
    ExtendedDenom: "aatom",        // 扩展代币 denom（18 位小数）
    DisplayDenom:  "atom",         // 显示代币名称
    Decimals:      evmtypes.SixDecimals.Uint32(), // 原始精度
}

configurator := evmtypes.NewEVMConfigurator()
err := configurator.
    WithEVMCoinInfo(coinInfo).
    Configure()
```

### 支持的精度配置

模块支持从 1 位到 18 位小数的任意精度扩展：

- **1-17 位小数**：需要扩展精度，转换因子 = $10^{18-n}$（n 为原始精度）
- **18 位小数**：无需扩展，`Denom` 和 `ExtendedDenom` 必须相同

### 配置示例

```go
// 示例 1：6 位小数代币（如 ATOM）
coinInfo := evmtypes.EvmCoinInfo{
    Denom:         "uatom",
    ExtendedDenom: "aatom",
    DisplayDenom:  "atom",
    Decimals:      evmtypes.SixDecimals.Uint32(),
}
// 转换因子 = 10^12

// 示例 2：12 位小数代币
coinInfo := evmtypes.EvmCoinInfo{
    Denom:         "ptest2",
    ExtendedDenom: "atest2",
    DisplayDenom:  "test2",
    Decimals:      evmtypes.TwelveDecimals.Uint32(),
}
// 转换因子 = 10^6

// 示例 3：18 位小数代币（无需扩展）
coinInfo := evmtypes.EvmCoinInfo{
    Denom:         "atest",
    ExtendedDenom: "atest",  // 必须相同
    DisplayDenom:  "test",
    Decimals:      evmtypes.EighteenDecimals.Uint32(),
}
// 转换因子 = 1（无需转换）
```

## 参考资料

- [PreciseBank README](../x/precisebank/README.md)
- [集成测试代码](../tests/integration/x/precisebank/)
- [Keeper 实现](../x/precisebank/keeper/)
- [EVM Coin 配置](../x/vm/types/denom_config.go)

## 总结

`x/precisebank` 模块是 Cosmos EVM 链的关键基础设施，它通过巧妙的数学设计实现了从 6 位小数到 18 位小数的精度扩展，同时保持了与 Cosmos SDK 的完全兼容性。通过本文档，您可以：

1. 理解模块的核心概念和工作原理
2. 掌握如何通过 EVM 交易测试模块功能
3. 使用查询接口验证系统状态
4. 排查常见问题

建议在实际使用前，先运行集成测试套件，确保环境配置正确。


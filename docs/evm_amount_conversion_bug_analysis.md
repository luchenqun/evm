# EVM 金额转换问题：根本原因分析与修复

## 问题描述

发送 1 ETH (10^18 wei) 时，系统扣除了 10^18 `uatom`，而理论上应该只扣除 10^6 `uatom`。

## 问题根源

问题出在 `x/vm/keeper/coin_info.go` 的 `LoadEvmCoinInfo` 函数中，该函数负责从 bank denom metadata 中提取 EVM coin 的信息。

### 错误的代码逻辑

原始代码（已修复）：

```go
for _, denomUnit := range evmDenomMetadata.DenomUnits {
    if denomUnit.Denom == evmDenomMetadata.Display {
        decimals = types.Decimals(denomUnit.Exponent)
    }
}
```

**问题**：代码错误地使用了 display denom 的 exponent 作为 EVM denom 的 decimals，而不是计算 EVM denom 相对于 display denom 的小数位数。

### 用户配置中的问题

用户的 genesis.json 配置也存在问题：

```json
{
  "denom_metadata": [
    {
      "description": "Native 18-decimal denom metadata for Cosmos EVM chain",
      "denom_units": [
        {
          "denom": "aatom",
          "exponent": 0
        },
        {
          "denom": "uatom",
          "exponent": 6
        },
        {
          "denom": "atom",
          "exponent": 18
        }
      ],
      "base": "uatom",      // ❌ 错误！应该是 "aatom"
      "display": "atom"
    }
  ]
}
```

**问题**：
1. `base` 设置为 "uatom"，但 `aatom` 的 exponent 是 0，这意味着 `aatom` 才是真正的基础单位（最小不可分割单位）
2. 如果 `base` 是 "uatom"，那么 `uatom` 的 exponent 应该是 0，而不是 6

## 技术背景

### Denom Metadata 的含义

在 Cosmos SDK 中，denom metadata 定义了代币的单位层次结构：

- **base**: 最小不可分割单位（smallest indivisible unit）
- **denom_units**: 不同单位的定义，每个单位的 exponent 表示相对于 base 的 10 的幂次
- **display**: 用户界面显示的单位

### EVM Decimals 系统

在这个 EVM 实现中：

- **EVM 使用 18 位小数**（类似以太坊）
- **extended_denom**：18 位小数的最小单位（例如 "aatom"）
- **evm_denom**：Cosmos 链的原生 denom（例如 "uatom"，6 位小数）
- **decimals**：evm_denom 的小数位数（相对于 display denom）
- **ConversionFactor**：从 evm_denom 转换到 18 位小数表示需要乘的因子

### 转换因子

根据 `x/vm/types/denom.go`：

```go
var ConversionFactor = map[Decimals]math.Int{
    SixDecimals:    math.NewInt(1e12),  // 10^12
    TwelveDecimals: math.NewInt(1e6),   // 10^6
    EighteenDecimals: math.NewInt(1e0), // 1
}
```

- **SixDecimals** (6 位小数)：需要乘以 10^12 才能转换为 18 位小数
- **TwelveDecimals** (12 位小数)：需要乘以 10^6 才能转换为 18 位小数
- **EighteenDecimals** (18 位小数)：已经是 18 位，不需要转换

## 正确的配置与计算

### 正确的 Denom Metadata 配置

```json
{
  "denom_metadata": [
    {
      "description": "Native 18-decimal denom metadata for Cosmos EVM chain",
      "denom_units": [
        {
          "denom": "aatom",
          "exponent": 0,    // ✓ 基础单位，18 位小数
          "aliases": []
        },
        {
          "denom": "uatom",
          "exponent": 12,   // ✓ 1 uatom = 10^12 aatom (6 位小数)
          "aliases": []
        },
        {
          "denom": "atom",
          "exponent": 18,   // ✓ 1 atom = 10^18 aatom (显示单位)
          "aliases": []
        }
      ],
      "base": "aatom",    // ✓ 正确！base 必须是最小单位
      "display": "atom",  // ✓ 显示单位
      "name": "Cosmos EVM",
      "symbol": "ATOM"
    }
  ]
}
```

### Decimals 计算

修复后的代码逻辑：

```go
decimals = types.Decimals(displayExp - evmDenomExp)
```

对于正确的配置：
- `displayExp` = 18 (atom)
- `evmDenomExp` = 12 (uatom)
- `decimals` = 18 - 12 = 6

这意味着：
- `uatom` 有 6 位小数（相对于 display unit "atom"）
- 1 atom = 10^6 uatom（传统的 Cosmos 定义）
- `ConversionFactor[6]` = 10^12
- 从 `uatom` 转换到 18 位小数（`aatom`）需要乘以 10^12

## 转换流程验证

### 发送 1 ETH 的正确流程

以正确的配置为例：

1. **用户发送**：
   ```
   1 ETH = 10^18 wei
   ```

2. **EVM 层处理**：
   ```
   amount = 10^18 (uint256, 18 位小数表示)
   ```

3. **SetBalance 计算差值**：
   ```go
   // x/vm/keeper/statedb.go
   coin := k.bankWrapper.SpendableCoin(ctx, cosmosAddr, types.GetEVMCoinDenom())
   // 获取的是 extended denom (aatom) 的余额
   balance := coin.Amount.BigInt()
   delta := new(big.Int).Sub(amount.ToBig(), balance)
   // delta = 10^18 (aatom)
   ```

4. **BurnAmountFromAccount**：
   ```go
   // x/vm/wrappers/bank.go
   coin := sdk.Coin{Denom: types.GetEVMCoinDenom(), Amount: sdkmath.NewIntFromBigInt(amt)}
   // coin = {Denom: "uatom", Amount: 10^18}

   convertedCoin, _ := types.ConvertEvmCoinDenomToExtendedDenom(coin)
   // convertedCoin = {Denom: "aatom", Amount: 10^18}
   // 注意：只改 denom，金额不变！
   ```

5. **Precisebank 转换**：
   ```go
   // x/precisebank/keeper/burn.go
   extendedAmount := amt.AmountOf(types.ExtendedCoinDenom())  // 10^18 aatom

   integerAmount := extendedAmount.Quo(types.ConversionFactor())
   // integerAmount = 10^18 ÷ 10^12 = 10^6 uatom  ✓

   fractionalAmount := extendedAmount.Mod(types.ConversionFactor())
   // fractionalAmount = 10^18 mod 10^12 = 0 aatom
   ```

6. **最终结果**：
   - 扣除 10^6 `uatom` = 1 atom ✓
   - 分数余额：0 aatom

## 修复内容

### 1. 代码修复 (`x/vm/keeper/coin_info.go`)

修复后的 `LoadEvmCoinInfo` 函数：

- 查找 display denom、evm_denom 和 base denom 的 exponent
- 验证 base denom 的 exponent 必须为 0（确保它是最小单位）
- 计算 `decimals = displayExp - evmDenomExp`

### 2. 配置修复（用户需要更新 genesis.json）

**关键更改**：
1. `base` 改为 `"aatom"`（18 位小数的最小单位）
2. `uatom` 的 `exponent` 改为 `12`（使得 1 uatom = 10^12 aatom）

**为什么 uatom 的 exponent 是 12？**

- 传统 Cosmos：1 atom = 10^6 uatom（6 位小数）
- EVM 表示：1 atom = 10^18 aatom（18 位小数）
- 因此：1 uatom = (10^18 / 10^6) aatom = 10^12 aatom
- 所以 uatom 相对于 base (aatom) 的 exponent 是 12

## 启动节点前需要做的

### 1. 修改 genesis.json

找到 `bank.denom_metadata` 部分，修改为：

```json
{
  "denom_metadata": [
    {
      "description": "Native 18-decimal denom metadata for Cosmos EVM chain",
      "denom_units": [
        {
          "denom": "aatom",
          "exponent": 0,
          "aliases": []
        },
        {
          "denom": "uatom",
          "exponent": 12,
          "aliases": []
        },
        {
          "denom": "atom",
          "exponent": 18,
          "aliases": []
        }
      ],
      "base": "aatom",
      "display": "atom",
      "name": "Cosmos EVM",
      "symbol": "ATOM"
    }
  ]
}
```

### 2. 重新初始化节点

由于 genesis.json 已修改，需要重新初始化节点：

```bash
# 停止节点
pkill evmd

# 删除旧数据
rm -rf /Users/lcq/Code/work/evm/build/nodes

# 重新编译（如果代码已更新）
make build

# 重新初始化节点
# (使用你的初始化脚本)
```

### 3. 验证配置

启动节点后，验证配置是否正确：

```bash
# 查询 denom metadata
./build/evmd query bank denom-metadata

# 查询某个地址的余额
./build/evmd query bank balances <address>

# 发送测试交易（使用 ethers.js）
# await wallet.sendTransaction({
#   to: '0x...',
#   value: ethers.utils.parseEther('1')
# })

# 验证余额变化
# 应该减少 10^6 uatom，而不是 10^18 uatom
```

## 总结

### 问题的根本原因

1. **代码 bug**：`LoadEvmCoinInfo` 使用了错误的逻辑计算 decimals
2. **配置错误**：genesis.json 中的 base denom 和 exponents 配置不正确

### 修复方案

1. **代码修复**：计算 `decimals = displayExp - evmDenomExp`
2. **配置修复**：
   - base: "aatom" (最小单位)
   - uatom exponent: 12 (使得 1 uatom = 10^12 aatom = 10^-6 atom)
   - atom exponent: 18 (使得 1 atom = 10^18 aatom)

### 预期结果

修复后，发送 1 ETH (10^18 wei) 将正确地扣除 10^6 uatom (= 1 atom)。

---

**创建时间**：2026-01-08
**问题发现者**：lcq
**修复者**：Claude Code

# evm_denom 与 extended_denom 详解

## 概述

在 Cosmos EVM 链中，`evm_denom` 和 `extended_denom` 是两个关键配置参数，它们定义了 EVM 原生代币的两种表示方式，用于支持不同精度的代币在 EVM 环境中工作。

## 核心概念

### evm_denom（整数代币）

**定义**：`evm_denom` 是 EVM 原生代币的基础代币名称，对应 Cosmos SDK 中 `x/bank` 模块管理的整数代币。

**特点**：
- 存储在 `x/bank` 模块中
- 精度由代币的元数据（denom metadata）决定（常见为 6 位小数，如 `uatom`）
- 对应 `precisebank` 模块中的 `IntegerCoinDenom()`
- 在代码中通过 `evmtypes.GetEVMCoinDenom()` 获取

**配置位置**：
```json
{
  "evm": {
    "params": {
      "evm_denom": "atest"  // 基础代币名称
    }
  }
}
```

### extended_denom（扩展代币）

**定义**：`extended_denom` 是扩展精度的代币名称，用于在 EVM 中表示 18 位小数精度的代币。

**特点**：
- 由 `precisebank` 模块管理
- 固定为 18 位小数精度
- 对应 `precisebank` 模块中的 `ExtendedCoinDenom()`
- 在代码中通过 `evmtypes.GetEVMCoinExtendedDenom()` 获取
- 如果基础代币已经是 18 位小数，则 `extended_denom = evm_denom`

**配置位置**：
```json
{
  "evm": {
    "params": {
      "extended_denom_options": {
        "extended_denom": "stake"  // 扩展代币名称（仅当基础代币 < 18 位小数时需要）
      }
    }
  }
}
```

## 关系与区别

### 1. 精度关系

| 配置场景 | evm_denom | extended_denom | 转换因子 | 说明 |
|---------|-----------|----------------|----------|------|
| 18 位小数 | `atest` | `atest`（相同） | 1 | 无需扩展，两者相同 |
| 6 位小数 | `utest` | `atest` | 10^6 | 需要扩展 6 位小数到 atest |
| 12 位小数 | `ptest2` | `atest2` | 10^6 | 需要扩展 6 位小数 |

### 2. 存储位置

```
evm_denom (整数代币)
├── 存储在 x/bank 模块
├── 精度：由代币元数据决定（如 6 位小数）
└── 用途：Cosmos SDK 原生交易

extended_denom (扩展代币)
├── 整数部分：存储在 x/bank（以 evm_denom 形式）
├── 分数部分：存储在 x/precisebank（分数余额）
├── 精度：固定 18 位小数
└── 用途：EVM 交易
```

### 3. 代码映射

```go
// 在 x/vm/keeper/coin_info.go 中的逻辑
func (k Keeper) LoadEvmCoinInfo(ctx sdk.Context) (types.EvmCoinInfo, error) {
    params := k.GetParams(ctx)

    // 1. 尝试从 evm_denom 查找元数据
    evmDenomMetadata, found := k.bankWrapper.GetDenomMetaData(ctx, params.EvmDenom)

    // 2. 如果找不到，尝试从 extended_denom 查找
    if !found && params.ExtendedDenomOptions != nil {
        evmDenomMetadata, found = k.bankWrapper.GetDenomMetaData(ctx, params.ExtendedDenomOptions.ExtendedDenom)
    }

    if !found {
        return types.EvmCoinInfo{}, fmt.Errorf("denom metadata not found")
    }

    // 3. 从元数据中获取 evm_denom 的 exponent
    decimals := evmDenomExp  // 从元数据的 denom_units 中获取

    // 4. 确定 extended_denom
    var extendedDenom string
    if decimals == 18 {
        // 如果已经是 18 位小数，则 extended_denom = evm_denom
        extendedDenom = params.EvmDenom
    } else {
        // 如果小于 18 位小数，从配置中获取 extended_denom
        if params.ExtendedDenomOptions == nil {
            return types.EvmCoinInfo{}, fmt.Errorf("extended denom options cannot be nil")
        }
        extendedDenom = params.ExtendedDenomOptions.ExtendedDenom
    }

    return types.EvmCoinInfo{
        Denom:         params.EvmDenom,        // evm_denom
        ExtendedDenom: extendedDenom,          // extended_denom
        Decimals:      decimals,               // evm_denom 的 exponent
    }, nil
}
```

### 4. 在 precisebank 模块中的使用

```go
// x/precisebank/types/fractional_balance.go

// IntegerCoinDenom 返回 evm_denom（整数代币）
func IntegerCoinDenom() string {
    return evmtypes.GetEVMCoinDenom()  // 返回 evm_denom
}

// ExtendedCoinDenom 返回 extended_denom（扩展代币）
func ExtendedCoinDenom() string {
    return evmtypes.GetEVMCoinExtendedDenom()  // 返回 extended_denom
}
```

## 实际配置示例

### 示例 1：18 位小数代币（无需扩展）

```json
{
  "evm": {
    "params": {
      "evm_denom": "atest",
      "extended_denom_options": {
        "extended_denom": "atest"  // 必须与 evm_denom 相同
      }
    }
  }
}
```

**说明**：
- `evm_denom = "atest"`（18 位小数）
- `extended_denom = "atest"`（相同）
- 转换因子 = 1（无需转换）
- `precisebank` 模块基本不工作（因为精度已满足）

### 示例 2：6 位小数代币（需要扩展）

```json
{
  "evm": {
    "params": {
      "evm_denom": "utest",
      "extended_denom_options": {
        "extended_denom": "atest"
      }
    }
  }
}
```

**说明**：
- `evm_denom = "utest"`（exponent=6）
- `extended_denom = "atest"`（exponent=0，最小单位）
- 转换因子 = 10^6
- `precisebank` 模块负责精度扩展

### 示例 3：当前配置（utest + atest）

根据 local_node.sh 的配置：

```json
{
  "evm": {
    "params": {
      "evm_denom": "utest",
      "extended_denom_options": {
        "extended_denom": "atest"
      }
    }
  }
}
```

**分析**：
1. `evm_denom = "utest"`：基础代币名称（exponent=6）
2. `extended_denom = "atest"`：扩展代币名称（exponent=0，最小单位）
3. 代码会先尝试用 "utest" 查找 metadata，找到后从中获取 utest 的 exponent=6
4. 由于 exponent=6 ≠ 18，使用 `extended_denom_options` 中的 "atest" 作为扩展代币
5. 转换因子 = 10^6

## 余额表示

### 账户余额的组成

对于扩展代币，账户的总余额由两部分组成：

```
总余额（extended_denom）= 整数余额（evm_denom）× 转换因子 + 分数余额
```

**示例**（6 位 exponent 代币）：
- 整数余额：1000 `utest`（存储在 x/bank）
- 分数余额：500000 `atest`（存储在 x/precisebank）
- 总余额：1000 × 10^6 + 500000 = 1000500000 `atest`

### 查询余额

```bash
# 查询整数余额（evm_denom）
evmd query bank balances <address>
# 返回：1000utest

# 查询扩展余额（extended_denom）
evmd query bank balances <address> --denom atest
# 返回：1000500000atest（包含整数和分数部分）

# 查询分数余额
evmd query precisebank fractional-balance <address>
# 返回：500000atest（仅分数部分）
```

## EVM 交易中的使用

### 交易流程

1. **用户发送 EVM 交易**：
   - 用户使用 ETH（18 位小数）作为单位
   - 例如：发送 0.1 ETH

2. **系统转换**：
   - EVM 层将 ETH 转换为 `extended_denom`（如 `atest`）
   - 0.1 ETH = 100000000000000000 wei = 100000000000000000 `atest`

3. **precisebank 处理**：
   - 如果 `extended_denom ≠ evm_denom`，`precisebank` 模块处理精度转换
   - 整数部分：100000000000000000 ÷ 10^6 = 100000000000 `utest`（存储在 x/bank）
   - 分数部分：100000000000000000 mod 10^6 = 0 `atest`（存储在 x/precisebank）

4. **余额更新**：
   - x/bank：更新 `evm_denom` 余额
   - x/precisebank：更新分数余额（如果需要）

## 配置规则

### 规则 1：18 位小数代币

如果 `evm_denom` 已经是 18 位小数：
- `extended_denom` **必须**等于 `evm_denom`
- `extended_denom_options` 可以省略或设置为相同值
- `precisebank` 模块基本不工作

```go
// 代码验证（x/vm/types/denom_config.go）
if Decimals(eci.Decimals) == EighteenDecimals {
    if eci.Denom != eci.ExtendedDenom {
        return errors.New("EVM coin denom and extended denom must be the same for 18 decimals")
    }
}
```

### 规则 2：小于 18 位小数代币

如果 `evm_denom` 小于 18 位小数：
- `extended_denom_options` **必须**配置
- `extended_denom` **必须**与 `evm_denom` 不同
- `precisebank` 模块负责精度扩展

```go
// 代码验证（x/vm/keeper/coin_info.go）
if decimals != 18 {
    if params.ExtendedDenomOptions == nil {
        return types.EvmCoinInfo{}, fmt.Errorf("extended denom options cannot be nil for non-18-decimal chains")
    }
    extendedDenom = params.ExtendedDenomOptions.ExtendedDenom
}
```

## 常见问题

### Q1: 为什么需要两个代币名称？

**A**: 因为 Cosmos SDK 和 EVM 对精度有不同的要求：
- Cosmos SDK：可以使用不同精度的代币（如 `utest` exponent=6）
- EVM：内部使用最小单位表示（如 `atest` exponent=0，对应 18 位小数系统）
- `precisebank` 模块通过两个代币名称实现精度扩展，同时保持兼容性

### Q2: 如果配置错误会怎样？

**A**: 
- 如果 18 位小数代币的 `extended_denom ≠ evm_denom`：应用启动时会报错
- 如果小于 18 位小数代币未配置 `extended_denom_options`：应用启动时会报错

### Q3: 如何查询当前配置？

**A**:
```bash
# 查询 EVM 参数
evmd query evm params

# 或查看 genesis.json
cat build/nodes/node0/evmd/config/genesis.json | jq '.app_state.evm.params'
```

### Q4: 可以动态修改配置吗？

**A**: 不可以。这些配置在应用初始化时设置，运行时无法修改。如果需要修改，需要：
1. 停止节点
2. 修改 genesis.json
3. 重新初始化链（或通过治理提案修改参数）

## 总结

| 特性 | evm_denom | extended_denom |
|------|-----------|----------------|
| **定义** | 基础代币（整数部分） | 扩展代币（最小单位，exponent=0） |
| **存储** | x/bank 模块 | x/bank（整数）+ x/precisebank（分数） |
| **精度** | 由元数据的 exponent 决定 | 作为最小单位，用于 EVM 18 位小数表示 |
| **用途** | Cosmos SDK 交易 | EVM 交易 |
| **关系** | 整数部分 | 整数 + 分数部分 |
| **配置** | 必须 | exponent=18时可省略（等于evm_denom） |

**关键要点**：
1. `evm_denom` 是基础代币，存储在 `x/bank`，其 exponent 由 metadata 决定
2. `extended_denom` 是扩展代币（最小单位），由 `precisebank` 模块管理
3. 如果 evm_denom 的 exponent 已经是 18，两者相同
4. 如果 evm_denom 的 exponent 小于 18，需要配置不同的 `extended_denom`（通常是 base denom）
5. 代码会先尝试用 `evm_denom` 查找 metadata，找不到再用 `extended_denom` 查找
6. 所有 EVM 交易都使用 `extended_denom`，系统自动处理精度转换

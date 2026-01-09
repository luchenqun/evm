# Denom 与 ExtendedDenom 深度解析

## 目录
1. [概述](#概述)
2. [EvmCoinInfo 结构](#evmcoininfo-结构)
3. [Denom 的作用与使用](#denom-的作用与使用)
4. [ExtendedDenom 的作用与使用](#extendeddenom-的作用与使用)
5. [两者的关系与区别](#两者的关系与区别)
6. [完整的交易流程](#完整的交易流程)
7. [代码实现细节](#代码实现细节)
8. [实际配置示例](#实际配置示例)

---

## 概述

在 Cosmos EVM 链中，`Denom` 和 `ExtendedDenom` 是两个核心概念，它们共同支撑了 EVM 和 Cosmos SDK 之间的代币精度转换机制。理解这两者的区别和用途对于理解整个系统至关重要。

### 核心问题

**为什么需要两个 denom？**

- **EVM 要求**: EVM 内部所有计算都使用最小单位（wei），对应 18 位小数
- **Cosmos SDK 灵活性**: Cosmos SDK 支持任意精度的代币（通常是 6 位小数）
- **兼容性需求**: 需要在两种精度系统之间无缝转换

### 解决方案

通过 `Denom` 和 `ExtendedDenom` 分离职责：
- `Denom`: Cosmos SDK 层面使用的代币单位
- `ExtendedDenom`: EVM 层面使用的最小单位（对应 18 位小数系统）

---

## EvmCoinInfo 结构

### Proto 定义

**位置**: `proto/cosmos/evm/vm/v1/evm.proto`

```protobuf
message EvmCoinInfo {
  string denom = 1;              // EVM 在 Cosmos 中使用的标准计价单位
  string extended_denom = 2;      // 最小单位的原子单位（基础单位）
  string display_denom = 3;       // 用户友好的显示单位
  uint32 decimals = 4;            // 精度等级 (1-18)
}
```

### Go 结构体

**位置**: `x/vm/types/evm.pb.go`

```go
type EvmCoinInfo struct {
    Denom         string `protobuf:"bytes,1,opt,name=denom,proto3" json:"denom,omitempty"`
    ExtendedDenom string `protobuf:"bytes,2,opt,name=extended_denom,json=extendedDenom,proto3" json:"extended_denom,omitempty"`
    DisplayDenom  string `protobuf:"bytes,3,opt,name=display_denom,json=displayDenom,proto3" json:"display_denom,omitempty"`
    Decimals      uint32 `protobuf:"varint,4,opt,name=decimals,proto3" json:"decimals,omitempty"`
}
```

### 字段对比表

| 字段 | 18-小数链 | 6-小数链 | 说明 |
|------|----------|---------|------|
| **Denom** | `aatom` | `utest` | Cosmos SDK 交易和银行操作中使用 |
| **ExtendedDenom** | `aatom` | `atest` | EVM 交易中使用，总是最小单位 |
| **DisplayDenom** | `atom` | `test` | 用户界面展示 |
| **Decimals** | `18` | `6` | Denom 的 exponent 值 |

**关键规则**：
- **18-小数链**: `Denom == ExtendedDenom`（两者都是最小单位，无需转换）
- **其他小数链**: `Denom != ExtendedDenom`（需要通过 precisebank 转换）

---

## Denom 的作用与使用

### 定义

`Denom` 是 **Cosmos SDK 层面使用的代币单位**，它：
- 在 Cosmos SDK 的标准交易中使用
- 作为 `x/bank` 模块的主要计价单位
- 由 denom metadata 的某个 denom_unit 定义（通常不是 base）

### 使用场景

#### 1. 模块初始化

**文件**: `x/vm/module.go`

```go
func (am AppModule) PreBlock(goCtx context.Context) (appmodule.ResponsePreBlock, error) {
    ctx := sdk.UnwrapSDKContext(goCtx)
    coinInfo := am.keeper.GetEvmCoinInfo(ctx)

    am.initializer.Do(func() {
        // 设置全局配置变量
        SetGlobalConfigVariables(coinInfo)
    })

    return &sdk.ResponsePreBlock{ConsensusParamsChanged: false}, nil
}
```

**设置基础 Denom**:
```go
func setBaseDenom(ci types.EvmCoinInfo) (err error) {
    // 将 EvmCoinInfo.Denom 设置为 Cosmos SDK 的基础 Denom
    defer func() {
        err = sdk.SetBaseDenom(ci.Denom)
    }()

    // 注册显示单位
    if err := sdk.RegisterDenom(ci.DisplayDenom, math.LegacyOneDec()); err != nil {
        return err
    }

    // 注册 EVM Denom 及其精度
    return sdk.RegisterDenom(ci.Denom, math.LegacyNewDecWithPrec(1, int64(ci.Decimals)))
}
```

#### 2. Mempool 交易排序

**文件**: `mempool/mempool.go`

```go
// 使用 Denom 作为费用单位进行交易排序
func (m *PriorityNonceMempool) Select(...) mempool.Iterator {
    evmDenom := m.vmKeeper.GetEvmCoinInfo(ctx).Denom

    // 查找 Cosmos 交易的费用
    found, coin := cosmosTxFee.GetFee().Find(evmDenom)
    if !found {
        // 处理找不到费用的情况
    }

    // 创建迭代器时传入 Denom
    combinedIterator := NewEVMMempoolIterator(
        evmIterator,
        cosmosIterator,
        m.logger,
        m.txConfig,
        evmDenom,  // 使用 Denom 作为费用单位
        m.blockchain.Config().ChainID,
        m.blockchain
    )

    return combinedIterator
}
```

#### 3. GRPC 查询

**文件**: `x/vm/keeper/grpc_query.go`

```go
func (k Keeper) Config(ctx context.Context, _ *types.QueryConfigRequest) (*types.QueryConfigResponse, error) {
    config := types.GetChainConfig()

    // 在 Config 查询中返回 Denom
    config.Denom = types.GetEVMCoinDenom()
    config.Decimals = uint64(types.GetEVMCoinDecimals())

    return &types.QueryConfigResponse{Config: config}, nil
}
```

#### 4. Precisebank 整数部分

**文件**: `x/precisebank/types/fractional_balance.go`

```go
// IntegerCoinDenom 返回用于存储整数部分的 Denom
func IntegerCoinDenom() string {
    return evmtypes.GetEVMCoinDenom()  // 返回 Denom (e.g., "utest")
}
```

在 `x/precisebank` 中，整数部分使用 `Denom` 存储在 `x/bank` 中：

```go
// 发送 ExtendedDenom 时的整数部分处理
func (k Keeper) sendExtendedCoins(ctx sdk.Context, from, to sdk.AccAddress, amt sdkmath.Int) error {
    // 分解为整数和分数部分
    integerAmt := amt.Quo(types.ConversionFactor())      // 整数部分
    fractionalAmt := amt.Mod(types.ConversionFactor())   // 分数部分

    // ... 分数余额处理 ...

    // 使用 Denom 转移整数部分
    if integerAmt.IsPositive() {
        transferCoin := sdk.NewCoin(types.IntegerCoinDenom(), integerAmt)  // Denom
        if err := k.bk.SendCoins(ctx, from, to, sdk.NewCoins(transferCoin)); err != nil {
            return err
        }
    }

    return nil
}
```

### Denom 的关键特性

1. **作为 Cosmos SDK 的标准单位**: 所有标准 Cosmos 交易使用 Denom
2. **在 x/bank 中存储**: 账户余额的整数部分用 Denom 表示
3. **可以有不同的精度**: Decimals 字段定义了 Denom 的精度（1-18）
4. **对用户透明**: 用户在 Cosmos CLI 中看到的就是 Denom

---

## ExtendedDenom 的作用与使用

### 定义

`ExtendedDenom` 是 **EVM 层面使用的最小单位**，它：
- 在 EVM 交易中使用
- 总是 denom metadata 中的 base denom（exponent=0）
- 对应 18 位小数系统的最小单位
- 通过 `x/precisebank` 管理分数余额

### 使用场景

#### 1. Precisebank 分数部分

**文件**: `x/precisebank/types/fractional_balance.go`

```go
// ExtendedCoinDenom 返回用于 EVM 交易的扩展 Denom
func ExtendedCoinDenom() string {
    return evmtypes.GetEVMCoinExtendedDenom()  // 返回 ExtendedDenom (e.g., "atest")
}

// 判断是否需要分数余额处理
func IsExtendedDenomSameAsIntegerDenom() bool {
    return IntegerCoinDenom() == ExtendedCoinDenom()
    // 18-小数链: true (Denom == ExtendedDenom)
    // 6-小数链: false (Denom != ExtendedDenom)
}

// ConversionFactor 是从 Denom 到 ExtendedDenom 的转换系数
func ConversionFactor() sdkmath.Int {
    return sdkmath.NewIntFromBigInt(evmtypes.GetEVMCoinDecimals().ConversionFactor().BigInt())
    // 6-小数链: 10^6 (1 utest = 10^6 atest)
    // 18-小数链: 1 (1 aatom = 1 aatom)
}
```

#### 2. BankWrapper 自动转换

**文件**: `x/vm/wrappers/bank.go`

BankWrapper 是 EVM 和 Cosmos SDK 之间的桥梁，它自动处理 Denom 到 ExtendedDenom 的转换：

```go
// GetBalance 自动查询 ExtendedDenom
func (w BankWrapper) GetBalance(ctx context.Context, addr sdk.AccAddress, denom string) sdk.Coin {
    if denom != types.GetEVMCoinDenom() {
        panic(fmt.Sprintf("expected evm denom %s, received %s", types.GetEVMCoinDenom(), denom))
    }

    // 实际查询使用 ExtendedDenom
    return w.BankKeeper.GetBalance(ctx, addr, types.GetEVMCoinExtendedDenom())
}

// MintAmountToAccount 转换 Denom 到 ExtendedDenom
func (w BankWrapper) MintAmountToAccount(ctx context.Context, recipientAddr sdk.AccAddress, amt *big.Int) error {
    // 创建以 Denom 表示的 Coin
    coin := sdk.Coin{
        Denom:  types.GetEVMCoinDenom(),
        Amount: sdkmath.NewIntFromBigInt(amt),
    }

    // 转换为 ExtendedDenom
    convertedCoin, err := types.ConvertEvmCoinDenomToExtendedDenom(coin)
    if err != nil {
        return errors.Wrap(err, "failed to mint coin to account in bank wrapper")
    }

    // 使用 ExtendedDenom 进行 Mint
    coinsToMint := sdk.Coins{convertedCoin}
    if err := w.MintCoins(ctx, types.ModuleName, coinsToMint); err != nil {
        return errors.Wrap(err, "failed to mint coins to account in bank wrapper")
    }

    return w.BankKeeper.SendCoinsFromModuleToAccount(ctx, types.ModuleName, recipientAddr, coinsToMint)
}
```

#### 3. Precisebank SendCoins

**文件**: `x/precisebank/keeper/send.go`

```go
func (k Keeper) SendCoins(
    goCtx context.Context,
    from, to sdk.AccAddress,
    amt sdk.Coins,
) error {
    ctx := sdk.UnwrapSDKContext(goCtx)

    // 提取 ExtendedDenom 金额
    extendedCoinAmount := amt.AmountOf(types.ExtendedCoinDenom())

    // 移除 ExtendedDenom，其余通过 x/bank 处理
    passthroughCoins := amt
    if extendedCoinAmount.IsPositive() {
        subCoin := sdk.NewCoin(types.ExtendedCoinDenom(), extendedCoinAmount)
        passthroughCoins = amt.Sub(subCoin)
    }

    // 处理普通 Cosmos 代币
    if passthroughCoins.IsAllPositive() {
        if err := k.bk.SendCoins(ctx, from, to, passthroughCoins); err != nil {
            return err
        }
    }

    // 通过 x/precisebank 处理 ExtendedDenom
    if extendedCoinAmount.IsPositive() {
        if err := k.sendExtendedCoins(ctx, from, to, extendedCoinAmount); err != nil {
            return err
        }
    }

    return nil
}
```

**分数余额处理**:
```go
func (k Keeper) sendExtendedCoins(
    ctx sdk.Context,
    from, to sdk.AccAddress,
    amt sdkmath.Int,
) error {
    // 分解为整数和分数部分
    integerAmt := amt.Quo(types.ConversionFactor())      // 整数部分（Denom）
    fractionalAmt := amt.Mod(types.ConversionFactor())   // 分数部分（ExtendedDenom）

    // 获取当前分数余额
    senderFracBal := k.GetFractionalBalance(ctx, from)
    recipientFracBal := k.GetFractionalBalance(ctx, to)

    // 计算新的分数余额（需要处理借位和进位）
    senderNewFracBal, senderNeedsBorrow := subFromFractionalBalance(senderFracBal, fractionalAmt)
    recipientNewFracBal, recipientNeedsCarry := addToFractionalBalance(recipientFracBal, fractionalAmt)

    // 根据是否需要借位/进位，调整整数部分
    if senderNeedsBorrow {
        integerAmt = integerAmt.AddRaw(1)  // 从整数部分借一位
    }
    if recipientNeedsCarry {
        integerAmt = integerAmt.SubRaw(1)  // 进位到整数部分
    }

    // 更新分数余额
    k.SetFractionalBalance(ctx, from, senderNewFracBal)
    k.SetFractionalBalance(ctx, to, recipientNewFracBal)

    // 使用 Denom 转移整数部分
    if integerAmt.IsPositive() {
        transferCoin := sdk.NewCoin(types.IntegerCoinDenom(), integerAmt)
        if err := k.bk.SendCoins(ctx, from, to, sdk.NewCoins(transferCoin)); err != nil {
            return k.updateInsufficientFundsError(ctx, from, amt, err)
        }
    }

    return nil
}
```

#### 4. EVM 交易验证

**文件**: `ante/evm/04_validate.go`

```go
func CheckTxFee(txFeeInfo *tx.Fee, txFee *big.Int, txGasLimit uint64) error {
    // EVM 交易的费用必须使用 ExtendedDenom
    evmExtendedDenom := evmtypes.GetEVMCoinExtendedDenom()

    // 验证费用金额
    if !txFeeInfo.Amount.AmountOf(evmExtendedDenom).Equal(sdkmath.NewIntFromBigInt(txFee)) {
        return errorsmod.Wrapf(
            errortypes.ErrInvalidRequest,
            "invalid AuthInfo Fee Amount (%s != %s)",
            txFeeInfo.Amount,
            txFee
        )
    }

    // 验证 gas 限制
    if txFeeInfo.GasLimit != txGasLimit {
        return errorsmod.Wrapf(
            errortypes.ErrInvalidRequest,
            "invalid AuthInfo Fee GasLimit (%d != %d)",
            txFeeInfo.GasLimit,
            txGasLimit
        )
    }

    return nil
}
```

#### 5. IsSendEnabledCoin 检查

**文件**: `x/precisebank/keeper/send.go`

```go
func (k Keeper) IsSendEnabledCoin(ctx context.Context, coin sdk.Coin) bool {
    // 如果是 ExtendedDenom，需要转换为 Denom 并检查 SendEnabled 状态
    if coin.Denom == evmtypes.GetEVMCoinExtendedDenom() {
        // 将 ExtendedDenom 转换为 Denom
        integerAmount := coin.Amount.Quo(types.ConversionFactor())
        integerCoin := sdk.NewCoin(evmtypes.GetEVMCoinDenom(), integerAmount)

        return k.bk.IsSendEnabledCoin(ctx, integerCoin)
    }

    // 其他代币直接检查
    return k.bk.IsSendEnabledCoin(ctx, coin)
}
```

### ExtendedDenom 的关键特性

1. **总是最小单位**: 对应 denom metadata 中的 base（exponent=0）
2. **EVM 交易专用**: 所有 EVM 交易内部使用 ExtendedDenom
3. **支持分数余额**: 通过 `x/precisebank` 跟踪 < ConversionFactor 的余额
4. **自动转换**: BankWrapper 自动处理 Denom 到 ExtendedDenom 的转换

---

## 两者的关系与区别

### 对比表

| 特性 | Denom | ExtendedDenom |
|------|-------|---------------|
| **定义来源** | EVM 参数配置 | EVM 参数配置或等于 Denom |
| **精度** | 可变（1-18） | 固定对应最小单位（exponent=0） |
| **使用场景** | Cosmos SDK 交易 | EVM 交易 |
| **存储位置** | x/bank（整数部分） | x/bank（整数）+ x/precisebank（分数） |
| **转换因子** | - | ConversionFactor = 10^(Decimals) |
| **18-小数链** | 等于 ExtendedDenom | 等于 Denom |
| **6-小数链** | 不等于 ExtendedDenom | 不等于 Denom |

### 关系图

#### 6-小数链（utest/atest）

```
┌──────────────────────────────────────────────────────────────┐
│                    用户发起 EVM 交易                          │
│                   金额：1 ETH (10^18 wei)                     │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                  转换为 ExtendedDenom                         │
│               10^18 wei = 10^18 atest                        │
│                  (最小单位，exponent=0)                       │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│              precisebank 分解 ExtendedDenom                   │
│                                                               │
│   整数部分 = 10^18 ÷ 10^6 = 10^12 utest (Denom)           │
│   分数部分 = 10^18 mod 10^6 = 0 atest                      │
│                                                               │
│   ConversionFactor = 10^6                                   │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    更新账户余额                               │
│                                                               │
│   x/bank (Denom):        扣除 10^12 utest                   │
│   x/precisebank (分数):   更新分数余额                       │
└──────────────────────────────────────────────────────────────┘
```

#### 18-小数链（aatom/aatom）

```
┌──────────────────────────────────────────────────────────────┐
│                    用户发起 EVM 交易                          │
│                   金额：1 ETH (10^18 wei)                     │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│            Denom == ExtendedDenom == "aatom"                 │
│               10^18 wei = 10^18 aatom                        │
│                  (无需转换，1:1 对应)                         │
│                                                               │
│   ConversionFactor = 1 (无需 precisebank 处理)              │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    直接更新账户余额                           │
│                                                               │
│   x/bank (Denom):        扣除 10^18 aatom                   │
│   x/precisebank:          不参与（无分数余额）              │
└──────────────────────────────────────────────────────────────┘
```

### 转换机制

**文件**: `x/vm/types/scaling.go`

```go
// ConvertEvmCoinDenomToExtendedDenom 将 Denom 转换为 ExtendedDenom
func ConvertEvmCoinDenomToExtendedDenom(coin sdk.Coin) (sdk.Coin, error) {
    if coin.Denom != GetEVMCoinDenom() {
        return sdk.Coin{}, fmt.Errorf(
            "expected coin denom %s, received %s",
            GetEVMCoinDenom(),
            coin.Denom
        )
    }

    // 只改变 Denom 字段，Amount 保持不变
    // 因为 Amount 已经是按照 EVM 表示（最小单位）
    return sdk.Coin{
        Denom:  GetEVMCoinExtendedDenom(),
        Amount: coin.Amount,
    }, nil
}

// ConvertCoinsDenomToExtendedDenom 批量转换
func ConvertCoinsDenomToExtendedDenom(coins sdk.Coins) sdk.Coins {
    evmDenom := GetEVMCoinDenom()
    convertedCoins := make(sdk.Coins, len(coins))

    for i, coin := range coins {
        if coin.Denom == evmDenom {
            coin, _ = ConvertEvmCoinDenomToExtendedDenom(coin)
        }
        convertedCoins[i] = coin
    }

    return convertedCoins.Sort()
}
```

---

## 完整的交易流程

### EVM 交易处理流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 用户发起 EVM 交易                                          │
│    - 使用 MetaMask 等钱包                                     │
│    - 金额以 wei 为单位（BigInt）                              │
│    - 例如：发送 0.1 ETH = 100000000000000000 wei           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BuildTx - 构建 Cosmos 交易                                │
│    - 转换 EVM 交易为 MsgEthereumTx                           │
│    - 费用使用 Denom 表示（例如 "utest"）                     │
│    - 调用 GetEVMCoinDenom() 获取 Denom                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Ante Handler - 交易验证                                   │
│    - 检查签名、nonce、gas 限制                               │
│    - 验证费用使用 ExtendedDenom（例如 "atest"）            │
│    - 调用 GetEVMCoinExtendedDenom()                        │
│    - 通过 BankWrapper 自动转换 Denom -> ExtendedDenom      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. 费用扣除 - DeductFees                                     │
│    - 调用 BankWrapper.GetBalance(Denom)                     │
│    - 内部查询 ExtendedDenom 的余额                          │
│    - 确保账户有足够的余额                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EVM 执行                                                   │
│    - 在 EVM 中执行智能合约                                   │
│    - 所有计算使用 wei（ExtendedDenom 的语义）              │
│    - 状态变更记录在 StateDB 中                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. 余额更新 - BankWrapper                                    │
│    - 转账、mint、burn 操作                                   │
│    - 自动转换 Denom -> ExtendedDenom                        │
│    - 调用 precisebank 或 bank 模块                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. precisebank 处理（仅非 18-小数链）                       │
│    - 分离 ExtendedDenom 为整数和分数部分                    │
│    - 整数部分：ExtendedDenom ÷ ConversionFactor = Denom   │
│    - 分数部分：ExtendedDenom mod ConversionFactor          │
│    - 更新 x/bank 中的 Denom 余额（整数部分）                │
│    - 更新 x/precisebank 中的分数余额                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. 状态提交                                                   │
│    - 提交所有状态变更                                        │
│    - 发出事件（Events）                                      │
│    - 返回交易回执                                            │
└─────────────────────────────────────────────────────────────┘
```

### Cosmos 原生交易流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 用户发起 Cosmos 交易                                       │
│    - 使用 CLI 或 REST API                                    │
│    - 金额使用 Denom 表示（例如 "1000000utest"）             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. x/bank 标准处理                                           │
│    - 直接使用 Denom 进行转账                                 │
│    - 无需转换（除非涉及 EVM 相关操作）                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 状态提交                                                   │
│    - 更新 x/bank 中的账户余额                                │
│    - 发出 Transfer 事件                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 代码实现细节

### 1. EvmCoinInfo 的加载和初始化

**文件**: `x/vm/keeper/coin_info.go`

```go
// LoadEvmCoinInfo 从 bank denom metadata 加载 EvmCoinInfo
func (k Keeper) LoadEvmCoinInfo(ctx sdk.Context) (_ types.EvmCoinInfo, err error) {
    params := k.GetParams(ctx)

    // 1. 尝试从 evm_denom 查找 metadata
    evmDenomMetadata, found := k.bankWrapper.GetDenomMetaData(ctx, params.EvmDenom)

    // 2. 如果找不到，尝试从 extended_denom 查找
    if !found && params.ExtendedDenomOptions != nil {
        evmDenomMetadata, found = k.bankWrapper.GetDenomMetaData(ctx, params.ExtendedDenomOptions.ExtendedDenom)
    }

    if !found {
        extendedDenomStr := "N/A"
        if params.ExtendedDenomOptions != nil {
            extendedDenomStr = params.ExtendedDenomOptions.ExtendedDenom
        }
        return types.EvmCoinInfo{}, fmt.Errorf(
            "denom metadata for %s (or extended denom %s) could not be found",
            params.EvmDenom,
            extendedDenomStr
        )
    }

    // 3. 从 metadata 中提取各个 denom 的 exponent
    var displayExp, evmDenomExp, baseExp uint32
    displayFound, evmDenomFound, baseFound := false, false, false

    for _, denomUnit := range evmDenomMetadata.DenomUnits {
        if denomUnit.Denom == evmDenomMetadata.Display {
            displayExp = denomUnit.Exponent
            displayFound = true
        }
        if denomUnit.Denom == params.EvmDenom {
            evmDenomExp = denomUnit.Exponent
            evmDenomFound = true
        }
        if denomUnit.Denom == evmDenomMetadata.Base {
            baseExp = denomUnit.Exponent
            baseFound = true
        }
    }

    // 4. 验证必要的 denom 都存在
    if !displayFound {
        return types.EvmCoinInfo{}, fmt.Errorf("display denom %s not found in denom_units", evmDenomMetadata.Display)
    }
    if !evmDenomFound {
        return types.EvmCoinInfo{}, fmt.Errorf("evm denom %s not found in denom_units", params.EvmDenom)
    }
    if !baseFound {
        return types.EvmCoinInfo{}, fmt.Errorf("base denom %s not found in denom_units", evmDenomMetadata.Base)
    }

    // 5. 验证 base denom 的 exponent 必须为 0
    if baseExp != 0 {
        return types.EvmCoinInfo{}, fmt.Errorf("base denom exponent must be 0, got %d for %s", baseExp, evmDenomMetadata.Base)
    }

    // 6. 验证 display denom 的 exponent 必须 >= evm denom 的 exponent
    if displayExp < evmDenomExp {
        return types.EvmCoinInfo{}, fmt.Errorf(
            "display denom exponent (%d) must be greater than or equal to evm denom exponent (%d)",
            displayExp,
            evmDenomExp
        )
    }

    // 7. decimals 就是 evm denom 的 exponent
    decimals := types.Decimals(evmDenomExp)

    // 8. 确定 ExtendedDenom
    var extendedDenom string
    if decimals == 18 {
        // 如果 Denom 已经是 18 位小数，ExtendedDenom = Denom
        extendedDenom = params.EvmDenom
    } else {
        // 如果 Denom 不是 18 位小数，必须配置 ExtendedDenomOptions
        if params.ExtendedDenomOptions == nil {
            return types.EvmCoinInfo{}, fmt.Errorf("extended denom options cannot be nil for non-18-decimal chains")
        }
        extendedDenom = params.ExtendedDenomOptions.ExtendedDenom
    }

    // 9. 返回 EvmCoinInfo
    return types.EvmCoinInfo{
        Denom:         params.EvmDenom,        // 例如 "utest"
        ExtendedDenom: extendedDenom,          // 例如 "atest"
        DisplayDenom:  evmDenomMetadata.Display, // 例如 "test"
        Decimals:      decimals.Uint32(),      // 例如 6
    }, nil
}
```

### 2. 全局配置变量

**文件**: `x/vm/types/denom_config.go`

```go
var (
    evmCoinInfo     types.EvmCoinInfo
    evmCoinInfoOnce sync.Once
)

// SetEvmCoinInfo 设置全局 EVM Coin Info（只能设置一次）
func SetEvmCoinInfo(coinInfo types.EvmCoinInfo) {
    evmCoinInfoOnce.Do(func() {
        evmCoinInfo = coinInfo
    })
}

// GetEVMCoinDenom 返回 Denom
func GetEVMCoinDenom() string {
    return evmCoinInfo.Denom
}

// GetEVMCoinExtendedDenom 返回 ExtendedDenom
func GetEVMCoinExtendedDenom() string {
    return evmCoinInfo.ExtendedDenom
}

// GetEVMCoinDisplayDenom 返回 DisplayDenom
func GetEVMCoinDisplayDenom() string {
    return evmCoinInfo.DisplayDenom
}

// GetEVMCoinDecimals 返回 Decimals
func GetEVMCoinDecimals() types.Decimals {
    return types.Decimals(evmCoinInfo.Decimals)
}
```

### 3. Decimals 和 ConversionFactor

**文件**: `x/vm/types/decimals.go`

```go
type Decimals uint32

const (
    SixDecimals      Decimals = 6
    EighteenDecimals Decimals = 18
)

// ConversionFactor 返回从 Denom 到 ExtendedDenom 的转换因子
func (d Decimals) ConversionFactor() *big.Int {
    switch d {
    case SixDecimals:
        // 1 utest = 10^6 atest
        return new(big.Int).Exp(big.NewInt(10), big.NewInt(6), nil)
    case EighteenDecimals:
        // 1 aatom = 1 aatom（无需转换）
        return big.NewInt(1)
    default:
        panic(fmt.Sprintf("unsupported decimals: %d", d))
    }
}

// Uint32 返回 uint32 类型的 decimals
func (d Decimals) Uint32() uint32 {
    return uint32(d)
}
```

### 4. Precisebank 的分数余额管理

**文件**: `x/precisebank/keeper/fractional_balance.go`

```go
// GetFractionalBalance 获取账户的分数余额
func (k Keeper) GetFractionalBalance(ctx sdk.Context, addr sdk.AccAddress) sdkmath.Int {
    store := ctx.KVStore(k.storeKey)
    key := types.FractionalBalanceKey(addr)

    bz := store.Get(key)
    if bz == nil {
        return sdkmath.ZeroInt()
    }

    amount := sdkmath.ZeroInt()
    if err := amount.Unmarshal(bz); err != nil {
        panic(err)
    }

    return amount
}

// SetFractionalBalance 设置账户的分数余额
func (k Keeper) SetFractionalBalance(ctx sdk.Context, addr sdk.AccAddress, amount sdkmath.Int) {
    // 分数余额必须 < ConversionFactor
    if amount.GTE(types.ConversionFactor()) {
        panic(fmt.Sprintf("fractional balance %s exceeds conversion factor %s", amount, types.ConversionFactor()))
    }

    store := ctx.KVStore(k.storeKey)
    key := types.FractionalBalanceKey(addr)

    if amount.IsZero() {
        store.Delete(key)
        return
    }

    bz, err := amount.Marshal()
    if err != nil {
        panic(err)
    }

    store.Set(key, bz)
}
```

### 5. 分数余额的算术操作

**文件**: `x/precisebank/keeper/send.go`

```go
// addToFractionalBalance 将金额添加到分数余额
// 返回新的分数余额和是否需要进位
func addToFractionalBalance(balance, amount sdkmath.Int) (sdkmath.Int, bool) {
    newBalance := balance.Add(amount)

    if newBalance.GTE(types.ConversionFactor()) {
        // 需要进位
        newBalance = newBalance.Sub(types.ConversionFactor())
        return newBalance, true
    }

    return newBalance, false
}

// subFromFractionalBalance 从分数余额中减去金额
// 返回新的分数余额和是否需要借位
func subFromFractionalBalance(balance, amount sdkmath.Int) (sdkmath.Int, bool) {
    if balance.GTE(amount) {
        // 不需要借位
        return balance.Sub(amount), false
    }

    // 需要借位
    newBalance := types.ConversionFactor().Add(balance).Sub(amount)
    return newBalance, true
}
```

---

## 实际配置示例

### 示例 1：6-小数链（当前配置）

**Genesis 配置**:
```json
{
  "evm": {
    "params": {
      "evm_denom": "utest",
      "extended_denom_options": {
        "extended_denom": "atest"
      }
    }
  },
  "bank": {
    "denom_metadata": [
      {
        "description": "The native staking token for evmd.",
        "denom_units": [
          {
            "denom": "atest",
            "exponent": 0,
            "aliases": ["attotest"]
          },
          {
            "denom": "utest",
            "exponent": 6,
            "aliases": []
          },
          {
            "denom": "test",
            "exponent": 18,
            "aliases": []
          }
        ],
        "base": "atest",
        "display": "test",
        "name": "Test Token",
        "symbol": "TEST"
      }
    ]
  }
}
```

**EvmCoinInfo**:
```go
types.EvmCoinInfo{
    Denom:         "utest",   // exponent=6
    ExtendedDenom: "atest",   // exponent=0 (base)
    DisplayDenom:  "test",    // exponent=18
    Decimals:      6,         // utest 的 exponent
}
```

**单位关系**:
- 1 test = 10^18 atest = 10^12 utest
- 1 utest = 10^6 atest
- ConversionFactor = 10^6

**余额表示**（账户余额 = 1.5 test）:
```
ExtendedDenom 表示:  1,500,000,000,000,000,000 atest
                          ↓
              分解为整数和分数部分
                          ↓
整数部分 (Denom):    1,500,000,000,000 utest  (存储在 x/bank)
分数部分 (ExtendedDenom): 0 atest  (存储在 x/precisebank)
```

**EVM 交易示例**（发送 0.1 ETH）:
```
用户操作:         发送 0.1 ETH
                          ↓
EVM 金额:         100,000,000,000,000,000 wei
                          ↓
ExtendedDenom:    100,000,000,000,000,000 atest
                          ↓
Precisebank 分解:
  整数部分:       100,000,000,000,000,000 ÷ 10^6 = 100,000,000,000 utest
  分数部分:       100,000,000,000,000,000 mod 10^6 = 0 atest
                          ↓
余额更新:
  x/bank:         扣除 100,000,000,000 utest
  x/precisebank:  分数余额保持不变（0 atest）
```

### 示例 2：18-小数链

**Genesis 配置**:
```json
{
  "evm": {
    "params": {
      "evm_denom": "aatom",
      "extended_denom_options": {
        "extended_denom": "aatom"
      }
    }
  },
  "bank": {
    "denom_metadata": [
      {
        "description": "Native 18-decimal token",
        "denom_units": [
          {
            "denom": "aatom",
            "exponent": 0,
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
        "name": "Atom Token",
        "symbol": "ATOM"
      }
    ]
  }
}
```

**EvmCoinInfo**:
```go
types.EvmCoinInfo{
    Denom:         "aatom",   // exponent=18
    ExtendedDenom: "aatom",   // 等于 Denom
    DisplayDenom:  "atom",    // exponent=18
    Decimals:      18,        // aatom 的 exponent
}
```

**单位关系**:
- 1 atom = 10^18 aatom
- Denom == ExtendedDenom（无需 precisebank）
- ConversionFactor = 1

**余额表示**（账户余额 = 1.5 atom）:
```
ExtendedDenom 表示:  1,500,000,000,000,000,000 aatom
                          ↓
         Denom == ExtendedDenom，无需分解
                          ↓
整数部分 (Denom):    1,500,000,000,000,000,000 aatom  (存储在 x/bank)
分数部分:            不存在（precisebank 不参与）
```

**EVM 交易示例**（发送 0.1 ETH）:
```
用户操作:         发送 0.1 ETH
                          ↓
EVM 金额:         100,000,000,000,000,000 wei
                          ↓
ExtendedDenom:    100,000,000,000,000,000 aatom
                          ↓
Denom == ExtendedDenom，直接使用
                          ↓
余额更新:
  x/bank:         扣除 100,000,000,000,000,000 aatom
  x/precisebank:  不参与
```

---

## 总结

### Denom 的核心职责

1. **Cosmos SDK 标准单位**: 作为 Cosmos SDK 交易中的代币单位
2. **整数部分存储**: 在 x/bank 中存储账户余额的整数部分
3. **用户可见**: 用户在 Cosmos CLI 和 REST API 中看到的单位
4. **可变精度**: 支持 1-18 位小数，由 Decimals 字段定义

### ExtendedDenom 的核心职责

1. **EVM 最小单位**: 在 EVM 交易中使用的最小原子单位
2. **分数余额管理**: 通过 x/precisebank 跟踪 < ConversionFactor 的分数余额
3. **自动转换**: BankWrapper 自动处理 Denom 到 ExtendedDenom 的转换
4. **固定语义**: 总是对应 denom metadata 的 base（exponent=0）

### 关键设计原则

1. **18-小数链**: Denom == ExtendedDenom，无需 precisebank
2. **其他小数链**: Denom != ExtendedDenom，需要 precisebank 处理分数
3. **ConversionFactor**: 定义了 Denom 到 ExtendedDenom 的转换比例
4. **透明转换**: BankWrapper 自动处理转换，对上层模块透明

### 代码位置速查

| 功能 | 文件 |
|------|------|
| EvmCoinInfo 加载 | `x/vm/keeper/coin_info.go` |
| 全局配置管理 | `x/vm/types/denom_config.go` |
| Denom 转换 | `x/vm/types/scaling.go` |
| BankWrapper | `x/vm/wrappers/bank.go` |
| Precisebank 核心 | `x/precisebank/types/fractional_balance.go` |
| Precisebank 发送 | `x/precisebank/keeper/send.go` |
| EVM 交易验证 | `ante/evm/04_validate.go` |
| Mempool 排序 | `mempool/mempool.go` |

---

**创建时间**: 2026-01-09
**作者**: Claude Code
**版本**: 1.0

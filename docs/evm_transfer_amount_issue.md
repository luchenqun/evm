# EVM 转账金额问题分析

## 问题描述

发送 1 ETH 时，理论上应该只减少 10^6 `uatom`，但实际上减少了 10^18 `uatom`。

## 理论计算

### 正确的转换流程

1. **用户发送**：
   ```
   1 ETH = 1,000,000,000,000,000,000 wei
   ```

2. **EVM 层处理**：
   ```
   wei → aatom（金额不变，只是单位转换）
   1,000,000,000,000,000,000 wei = 1,000,000,000,000,000,000 aatom
   ```

3. **precisebank 模块转换**：
   ```
   整数部分：1,000,000,000,000,000,000 ÷ 10^12 = 1,000,000 uatom
   分数部分：1,000,000,000,000,000,000 mod 10^12 = 0 aatom
   ```

4. **预期结果**：
   - 扣除：1,000,000 `uatom`（即 10^6 uatom）
   - 分数余额：不变

### 实际观察到的行为

- **实际扣除**：10^18 `uatom`
- **问题**：系统直接将 wei 金额（10^18）作为 `uatom` 金额处理了

## 代码流程分析

### 1. EVM 转账流程

```go
// x/vm/keeper/statedb.go
func (k *Keeper) SetBalance(ctx sdk.Context, addr common.Address, amount *uint256.Int) error {
    cosmosAddr := sdk.AccAddress(addr.Bytes())
    
    // 获取当前余额（扩展代币，aatom）
    coin := k.bankWrapper.SpendableCoin(ctx, cosmosAddr, types.GetEVMCoinDenom())
    balance := coin.Amount.BigInt()  // 这是 aatom 余额（18位小数）
    
    // 计算差值（amount 也是 18位小数，单位是 wei/aatom）
    delta := new(big.Int).Sub(amount.ToBig(), balance)
    
    switch delta.Sign() {
    case -1:
        // 需要扣除
        k.bankWrapper.BurnAmountFromAccount(ctx, cosmosAddr, new(big.Int).Neg(delta))
    }
}
```

### 2. BankWrapper 的转换

```go
// x/vm/wrappers/bank.go
func (w BankWrapper) BurnAmountFromAccount(ctx context.Context, account sdk.AccAddress, amt *big.Int) error {
    // amt 是 18位小数的金额（aatom）
    coin := sdk.Coin{Denom: types.GetEVMCoinDenom(), Amount: sdkmath.NewIntFromBigInt(amt)}
    
    // 转换为扩展代币（只是改 denom，金额不变）
    convertedCoin, err := types.ConvertEvmCoinDenomToExtendedDenom(coin)
    // convertedCoin = {Denom: "aatom", Amount: amt}  // 金额不变！
    
    // 发送到模块账户
    w.BankKeeper.SendCoinsFromAccountToModule(ctx, account, types.ModuleName, coinsToBurn)
    
    // 销毁
    w.BurnCoins(ctx, types.ModuleName, coinsToBurn)
}
```

### 3. ConvertEvmCoinDenomToExtendedDenom 的实现

```go
// x/vm/types/scaling.go
func ConvertEvmCoinDenomToExtendedDenom(coin sdk.Coin) (sdk.Coin, error) {
    if coin.Denom != GetEVMCoinDenom() {
        return sdk.Coin{}, fmt.Errorf("expected coin denom %s, received %s", GetEVMCoinDenom(), coin.Denom)
    }
    
    // 关键：只改 denom，金额不变！
    return sdk.Coin{Denom: GetEVMCoinExtendedDenom(), Amount: coin.Amount}, nil
}
```

### 4. precisebank 的 BurnCoins

```go
// x/precisebank/keeper/burn.go
func (k Keeper) BurnCoins(ctx sdk.Context, moduleName string, amt sdk.Coins) error {
    extendedAmount := amt.AmountOf(types.ExtendedCoinDenom())  // 10^18 aatom
    
    // 计算整数和分数部分
    integerBurnAmount := extendedAmount.Quo(types.ConversionFactor())  // 10^18 ÷ 10^12 = 10^6
    fractionalBurnAmount := extendedAmount.Mod(types.ConversionFactor())  // 0
    
    // 应该只扣除 10^6 uatom
    integerBurnCoin := sdk.NewCoin(types.IntegerCoinDenom(), integerBurnAmount)
    k.bk.BurnCoins(ctx, moduleName, sdk.NewCoins(integerBurnCoin))
}
```

## 问题定位

根据代码分析，`precisebank` 模块的逻辑是正确的：
- 它应该将 10^18 `aatom` 转换为 10^6 `uatom`
- 但实际却扣除了 10^18 `uatom`

**可能的原因**：

1. **余额查询问题**：
   - 查询余额时可能直接查询了 `uatom`，而不是通过 `precisebank` 查询扩展余额
   - 导致看到的余额是整数余额，而不是总余额

2. **转换逻辑被绕过**：
   - 某些路径可能直接使用了 `x/bank` 而不是 `precisebank`
   - 导致转换逻辑没有被执行

3. **余额单位理解错误**：
   - 查询到的余额可能已经是 `aatom` 单位，但被误认为是 `uatom`
   - 例如：查询返回 10^18，实际是 10^18 `aatom` = 10^6 `uatom`

## 验证步骤

### 1. 查询实际余额

```bash
# 查询整数余额（uatom）
evmd query bank balances <address>

# 查询扩展余额（aatom，包含整数和分数）
evmd query bank balances <address> --denom aatom

# 查询分数余额
evmd query precisebank fractional-balance <address>
```

### 2. 验证余额计算

根据 `precisebank` 的逻辑：
```
总余额（aatom）= 整数余额（uatom）× 10^12 + 分数余额（aatom）
```

**示例**：
- 如果整数余额是 10^12 `uatom`
- 分数余额是 0 `aatom`
- 总余额应该是：10^12 × 10^12 + 0 = 10^24 `aatom`

### 3. 检查交易后的余额变化

发送 1 ETH（10^18 wei）后：

**预期**：
- 整数余额减少：10^6 `uatom`
- 扩展余额减少：10^18 `aatom`
- 分数余额：不变

**如果实际**：
- 整数余额减少：10^18 `uatom`
- 说明转换逻辑没有被正确执行

## 解决方案

### 检查点 1：确认使用的是 precisebank keeper

确保所有 EVM 相关的余额操作都通过 `precisebank` keeper，而不是直接使用 `x/bank` keeper。

### 检查点 2：验证余额查询

查询余额时，应该：
- 使用 `precisebank` keeper 的 `GetBalance` 方法
- 或者使用 `bankWrapper` 的 `SpendableCoin` 方法
- 不应该直接查询 `x/bank` 的 `uatom` 余额

### 检查点 3：检查配置

确认：
- `evm_denom` = "uatom"（6位小数）
- `extended_denom` = "aatom"（18位小数）
- 转换因子 = 10^12

## 调试建议

1. **添加日志**：
   - 在 `BurnCoins` 中添加日志，记录输入的 `extendedAmount` 和计算出的 `integerBurnAmount`
   - 确认转换是否正确执行

2. **检查调用链**：
   - 追踪从 EVM 转账到余额扣除的完整调用链
   - 确认每一步的金额单位

3. **对比测试**：
   - 发送小额交易（如 10^12 wei = 1 aatom）
   - 验证是否只扣除 1 `uatom`（如果正确）或 10^12 `uatom`（如果错误）

## 总结

理论上，发送 1 ETH（10^18 wei）应该只扣除 10^6 `uatom`。如果实际扣除了 10^18 `uatom`，说明：

1. 转换逻辑可能被绕过
2. 或者余额查询/显示的单位理解有误
3. 需要检查完整的调用链，确认每一步的金额单位

建议先验证余额查询的结果，确认看到的是 `uatom` 还是 `aatom` 单位。

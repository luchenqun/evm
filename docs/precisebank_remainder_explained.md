# Precisebank Remainder 详解

## 目录
1. [什么是 Remainder](#什么是-remainder)
2. [Remainder 的数学原理](#remainder-的数学原理)
3. [Remainder 何时更新](#remainder-何时更新)
4. [实际案例分析](#实际案例分析)
5. [Remainder 的查询和验证](#remainder-的查询和验证)
6. [代码实现细节](#代码实现细节)
7. [常见问题](#常见问题)

---

## 什么是 Remainder

### 定义

**Remainder（余数/剩余量）** 是 x/precisebank 模块中的一个内部账簿金额，代表 **"由准备金备份但尚未在流通中"** 的分数金额。

简单来说：
- **分数余额（Fractional Balances）**: 已分配给各个账户的分数单位
- **Remainder**: 由准备金持有但未分配给任何账户的分数单位

### 为什么需要 Remainder？

在 6-小数链中：
- **EVM 使用 18 位小数**（atest，最小单位）
- **Cosmos 使用 6 位小数**（utest）
- **ConversionFactor = 10^12**（1 utest = 10^12 atest）

问题：当我们需要 mint/burn 分数数量的 atest 时，可能无法完全对应整数数量的 utest。

**解决方案**：
- 使用 **准备金账户（Reserve Account）** 持有额外的整数币
- 使用 **remainder** 跟踪准备金中未分配的分数部分

### 核心特性

| 特性 | 说明 |
|------|------|
| **类型** | `cosmossdk.io/math.Int` (大整数) |
| **范围** | `0 ≤ remainder < ConversionFactor` (0 到 999,999,999,999 atest) |
| **单位** | ExtendedDenom (atest) |
| **更新时机** | Mint/Burn 操作 |
| **Transfer 影响** | **不影响**（数学上已证明） |

---

## Remainder 的数学原理

### 基本不变式

**核心公式**：

$$b(R) \cdot C = \sum_{n \in \mathcal{A}}{f(n)} + r$$

**其中**：
- $b(R)$ = 准备金账户的整数余额（utest）
- $C$ = ConversionFactor = 10^12
- $f(n)$ = 账户 $n$ 的分数余额（atest）
- $r$ = remainder（atest）
- $\mathcal{A}$ = 所有账户集合

**含义**：
- 准备金账户持有的整数币（转换为最小单位）
- 必须等于所有账户的分数余额之和 + remainder

### 总供应量守恒

**公式**：

$$T_a = T_b \cdot C - r$$

**其中**：
- $T_a$ = 总扩展币供应量（atest）
- $T_b$ = 总整数币供应量（utest）
- $C$ = ConversionFactor
- $r$ = remainder

**含义**：
- 扩展币总供应量 = 整数币总供应量（转换后） - remainder
- Remainder 是"已备份但未流通"的部分

### 验证条件

**Genesis 验证**：

```go
sum := sumOfAllFractionalBalances
sumWithRemainder := sum.Add(remainder)
offBy := sumWithRemainder.Mod(ConversionFactor)

// offBy 必须为 0
// 即：sum + remainder 必须是 ConversionFactor 的整数倍
```

**不变式**：

```
∀ 操作: sum(fractionalBalances) + remainder ≡ 0 (mod ConversionFactor)
```

---

## Remainder 何时更新

### 更新时机总览

| 操作 | Remainder 变化 | 原因 |
|------|---------------|------|
| **Mint** | `remainder - fractionalAmount` | 从准备金分配分数单位 |
| **Burn** | `remainder + fractionalAmount` | 回收分数单位到准备金 |
| **Transfer** | **不变** | 只是账户间重新分配 |
| **Genesis** | 初始化 | 从 genesis 文件加载 |

### 1. Mint 操作

**文件**: `x/precisebank/keeper/mint.go`

**逻辑**：

```
用户操作: 铸造 X atest
              ↓
1. 计算分数部分:
   fractionalMintAmount = X mod ConversionFactor
   integerMintAmount = X ÷ ConversionFactor
              ↓
2. 更新 remainder:
   newRemainder = prevRemainder - fractionalMintAmount
              ↓
3. 处理负值（如果需要）:
   if newRemainder < 0:
       newRemainder += ConversionFactor
       从准备金账户额外铸造 1 utest
              ↓
4. 处理进位（如果 newRemainder >= ConversionFactor）:
   从准备金账户转移 1 utest 给接收账户
   newRemainder -= ConversionFactor
              ↓
5. 更新状态:
   SetRemainderAmount(ctx, newRemainder)
```

**代码示例**：

```go
func (k Keeper) mintExtendedCoin(
    ctx sdk.Context,
    recipientAddr sdk.AccAddress,
    amt sdkmath.Int,
) error {
    // 1. 获取当前 remainder
    prevRemainder := k.GetRemainderAmount(ctx)

    // 2. 计算整数和分数部分
    integerMintAmount := amt.Quo(types.ConversionFactor())
    fractionalMintAmount := amt.Mod(types.ConversionFactor())

    // 3. 计算新的 remainder
    newRemainder := prevRemainder.Sub(fractionalMintAmount)

    // 4. 如果 remainder 为负，从准备金借一位
    if newRemainder.IsNegative() {
        newRemainder = newRemainder.Add(types.ConversionFactor())
        integerMintAmount = integerMintAmount.AddRaw(1)  // 从准备金多铸造 1 utest
    }

    // 5. 如果需要进位
    if newRemainder.GTE(types.ConversionFactor()) {
        newRemainder = newRemainder.Sub(types.ConversionFactor())
        // 从准备金转移 1 utest 给接收账户
    }

    // 6. 更新 remainder
    k.SetRemainderAmount(ctx, newRemainder)

    return nil
}
```

**示例**：

假设当前状态：
- prevRemainder = 500,000,000,000 atest
- 用户要 mint 600,000,000,000 atest

计算：
```
newRemainder = 500,000,000,000 - 600,000,000,000 = -100,000,000,000 (负数!)

处理负值:
newRemainder = -100,000,000,000 + 1,000,000,000,000 = 900,000,000,000 atest
同时从准备金额外铸造 1 utest
```

### 2. Burn 操作

**文件**: `x/precisebank/keeper/burn.go`

**逻辑**：

```
用户操作: 燃烧 X atest
              ↓
1. 计算分数部分:
   fractionalBurnAmount = X mod ConversionFactor
   integerBurnAmount = X ÷ ConversionFactor
              ↓
2. 更新 remainder:
   newRemainder = prevRemainder + fractionalBurnAmount
              ↓
3. 处理溢出（如果 newRemainder >= ConversionFactor）:
   从准备金账户燃烧 1 utest
   newRemainder -= ConversionFactor
              ↓
4. 更新状态:
   SetRemainderAmount(ctx, newRemainder)
```

**代码示例**：

```go
func (k Keeper) burnExtendedCoin(
    ctx sdk.Context,
    holderAddr sdk.AccAddress,
    amt sdkmath.Int,
) error {
    // 1. 获取当前 remainder
    prevRemainder := k.GetRemainderAmount(ctx)

    // 2. 计算整数和分数部分
    integerBurnAmount := amt.Quo(types.ConversionFactor())
    fractionalBurnAmount := amt.Mod(types.ConversionFactor())

    // 3. 计算新的 remainder
    newRemainder := prevRemainder.Add(fractionalBurnAmount)

    // 4. 如果 remainder 溢出，从准备金燃烧 1 utest
    if newRemainder.GTE(types.ConversionFactor()) {
        newRemainder = newRemainder.Sub(types.ConversionFactor())
        integerBurnAmount = integerBurnAmount.AddRaw(1)  // 额外燃烧 1 utest
    }

    // 5. 更新 remainder
    k.SetRemainderAmount(ctx, newRemainder)

    return nil
}
```

**示例**：

假设当前状态：
- prevRemainder = 800,000,000,000 atest
- 用户要 burn 300,000,000,000 atest

计算：
```
newRemainder = 800,000,000,000 + 300,000,000,000 = 1,100,000,000,000 atest (溢出!)

处理溢出:
newRemainder = 1,100,000,000,000 - 1,000,000,000,000 = 100,000,000,000 atest
同时从准备金燃烧 1 utest
```

### 3. Transfer 操作

**文件**: `x/precisebank/keeper/send.go`

**重要结论**：**Transfer 操作不改变 remainder**

**原因**：

Transfer 只是在账户之间重新分配分数余额：
- 从账户 A 减少 X atest
- 给账户 B 增加 X atest

根据数学证明（README.md 第 194-238 行）：
```
sum(fractionalBalances)_before = sum(fractionalBalances)_after

因此：
(sum + remainder)_before = (sum + remainder)_after

即：remainder 保持不变
```

**代码**：

```go
func (k Keeper) sendExtendedCoins(
    ctx sdk.Context,
    from, to sdk.AccAddress,
    amt sdkmath.Int,
) error {
    // ... 更新分数余额 ...

    // 注意：没有任何更新 remainder 的代码！
    // 因为 transfer 不改变 remainder

    return nil
}
```

---

## 实际案例分析

### 你的查询结果

**操作**：转移 1 wei (= 1 atest)

**查询结果**：

```bash
# 发送方分数余额
evmd query precisebank fractional-balance cosmos1cml96vmptgw99syqrrz8az79xer2pcgp95srxm
fractional_balance:
  amount: "999999999999"
  denom: atest

# 接收方分数余额
evmd query precisebank fractional-balance cosmos1jcltmuhplrdcwp7stlr4hlhlhgd4htqhnu0t2g
fractional_balance:
  amount: "1"
  denom: atest

# Remainder
evmd query precisebank remainder
remainder:
  amount: "0"
  denom: atest
```

### 分析

#### 1. 转移前的状态

根据结果推测，转移前：
- 发送方分数余额：1,000,000,000,000 atest（= 1 utest）
- 接收方分数余额：0 atest
- Remainder：0 atest

**验证**：
```
sum(fractionalBalances) + remainder = 1,000,000,000,000 + 0 = 1,000,000,000,000
1,000,000,000,000 mod ConversionFactor = 0 ✓
```

#### 2. 转移操作

```
转移：1 atest
  发送方：1,000,000,000,000 - 1 = 999,999,999,999 atest
  接收方：0 + 1 = 1 atest
```

#### 3. 转移后的状态

- 发送方分数余额：999,999,999,999 atest
- 接收方分数余额：1 atest
- Remainder：0 atest（**不变**）

**验证**：
```
sum(fractionalBalances) + remainder = (999,999,999,999 + 1) + 0 = 1,000,000,000,000
1,000,000,000,000 mod ConversionFactor = 0 ✓
```

### 为什么 Remainder 是 0？

**答案**：因为转移操作不改变 remainder！

**详细解释**：

1. **Transfer 不涉及 Mint/Burn**：
   - 只是在两个账户之间移动分数余额
   - 不从准备金取出或存入任何分数单位

2. **总分数余额不变**：
   ```
   sum_before = 1,000,000,000,000 atest
   sum_after = 999,999,999,999 + 1 = 1,000,000,000,000 atest
   sum_before == sum_after ✓
   ```

3. **根据不变式**：
   ```
   sum + remainder = 常数（ConversionFactor 的整数倍）

   如果 sum 不变，remainder 也不变
   ```

4. **数学证明**（来自 README.md）：
   ```
   Transfer 前: sum(f) + r = k × C
   Transfer 后: sum(f') + r' = k × C

   因为 sum(f) = sum(f')（只是重新分配）
   所以 r = r'（remainder 不变）
   ```

### 什么时候 Remainder 不是 0？

**场景 1：Mint 分数数量**

```bash
# 假设初始状态 remainder = 0
# Mint 123,456,789,012 atest

计算：
fractionalMintAmount = 123,456,789,012 mod 10^12 = 123,456,789,012
newRemainder = 0 - 123,456,789,012 = -123,456,789,012 (负数!)

处理负值：
newRemainder = -123,456,789,012 + 10^12 = 876,543,210,988 atest

结果：remainder = 876,543,210,988 atest
```

**场景 2：Burn 分数数量**

```bash
# 假设当前 remainder = 876,543,210,988
# Burn 123,456,789,012 atest

计算：
newRemainder = 876,543,210,988 + 123,456,789,012 = 1,000,000,000,000

处理溢出：
newRemainder = 1,000,000,000,000 - 10^12 = 0 atest

结果：remainder = 0 atest（恢复为 0）
```

### 在实际 Mainnet 上

**重要结论**（来自 README.md）：

> 在 mainnet 上，由于 mint 和 burn 仅用于 x/evm 转移，
> mint 和 burn 总是相等且相反的，
> 因此每个交易和区块末尾 remainder 总是为 0。

**原因**：

1. **EVM 转账流程**：
   ```
   发送方: Burn X atest → remainder += fractionalAmount
   接收方: Mint X atest → remainder -= fractionalAmount

   净效果: remainder 不变（通常恢复为 0）
   ```

2. **每笔 EVM 交易内部**：
   - StateDB 中的转账通过 Mint/Burn 实现
   - 同一交易中 mint 和 burn 的分数部分相互抵消
   - 交易结束时 remainder 恢复为 0

3. **区块结束时**：
   - 所有交易的 mint/burn 总量相等
   - Remainder 保持为 0

---

## Remainder 的查询和验证

### 查询命令

**1. gRPC 查询**：

```bash
grpcurl -plaintext localhost:9090 cosmos.evm.precisebank.v1.Query/Remainder
```

**2. CLI 查询**：

```bash
evmd query precisebank remainder
```

**3. REST API**：

```bash
curl http://localhost:1317/cosmos/evm/precisebank/v1/remainder
```

### 查询响应

**Proto 定义**：

```protobuf
message QueryRemainderResponse {
  cosmos.base.v1beta1.Coin remainder = 1 [ (gogoproto.nullable) = false ];
}
```

**示例响应**：

```json
{
  "remainder": {
    "denom": "atest",
    "amount": "0"
  }
}
```

### 验证工具

**1. 验证不变式**：

```bash
# 查询所有分数余额
evmd query precisebank total-fractional-balances

# 查询 remainder
evmd query precisebank remainder

# 验证：sum + remainder 必须是 ConversionFactor 的整数倍
```

**2. Genesis 验证**：

```bash
# 导出 genesis
evmd export > genesis.json

# 验证 precisebank 状态
cat genesis.json | jq '.app_state.precisebank'
```

**3. 代码验证**（Genesis 加载时自动验证）：

```go
// x/precisebank/types/genesis.go

func (gs GenesisState) Validate() error {
    // 计算总分数余额
    sum := gs.Balances.SumAmount()

    // 加上 remainder
    sumWithRemainder := sum.Add(gs.Remainder)

    // 必须是 ConversionFactor 的整数倍
    offBy := sumWithRemainder.Mod(ConversionFactor())
    if !offBy.IsZero() {
        return fmt.Errorf(
            "sum of fractional balances %s + remainder %s = %s is not evenly divisible by conversion factor %s, off by %s",
            sum, gs.Remainder, sumWithRemainder, ConversionFactor(), offBy,
        )
    }

    return nil
}
```

---

## 代码实现细节

### 存储位置

**文件**: `x/precisebank/types/keys.go`

```go
var (
    // RemainderBalanceKey 是存储 remainder 的键
    RemainderBalanceKey = []byte{0x02}
)
```

**存储结构**：

```
KVStore:
  Key:   0x02
  Value: marshaled(remainder Amount)
```

### Keeper 接口

**文件**: `x/precisebank/keeper/remainder_amount.go`

```go
// GetRemainderAmount 返回内部 remainder 金额
func (k Keeper) GetRemainderAmount(ctx sdk.Context) sdkmath.Int {
    store := ctx.KVStore(k.storeKey)
    bz := store.Get(types.RemainderBalanceKey)

    if bz == nil {
        return sdkmath.ZeroInt()
    }

    amount := sdkmath.ZeroInt()
    if err := amount.Unmarshal(bz); err != nil {
        panic(err)
    }

    return amount
}

// SetRemainderAmount 设置内部 remainder 金额
func (k Keeper) SetRemainderAmount(ctx sdk.Context, amount sdkmath.Int) {
    // 验证范围
    if err := types.ValidateFractionalAmount(amount); err != nil {
        panic(fmt.Errorf("remainder amount is invalid: %w", err))
    }

    store := ctx.KVStore(k.storeKey)

    // 如果为 0，删除存储
    if amount.IsZero() {
        k.DeleteRemainderAmount(ctx)
        return
    }

    // 序列化并存储
    bz, err := amount.Marshal()
    if err != nil {
        panic(err)
    }

    store.Set(types.RemainderBalanceKey, bz)
}

// DeleteRemainderAmount 删除内部 remainder 金额
func (k Keeper) DeleteRemainderAmount(ctx sdk.Context) {
    store := ctx.KVStore(k.storeKey)
    store.Delete(types.RemainderBalanceKey)
}
```

### 验证函数

**文件**: `x/precisebank/types/fractional_balance.go`

```go
// ValidateFractionalAmount 验证分数金额的有效性
func ValidateFractionalAmount(amount sdkmath.Int) error {
    if amount.IsNegative() {
        return fmt.Errorf("amount cannot be negative: %s", amount)
    }

    if amount.GTE(ConversionFactor()) {
        return fmt.Errorf(
            "amount must be less than conversion factor %s: %s",
            ConversionFactor(),
            amount,
        )
    }

    return nil
}
```

### Genesis 处理

**文件**: `x/precisebank/genesis.go`

```go
// InitGenesis 初始化 precisebank 状态
func InitGenesis(ctx sdk.Context, keeper keeper.Keeper, gs types.GenesisState) {
    // 验证 genesis 状态
    if err := gs.Validate(); err != nil {
        panic(err)
    }

    // 设置 remainder
    keeper.SetRemainderAmount(ctx, gs.Remainder)

    // 设置所有分数余额
    for _, balance := range gs.Balances {
        addr := sdk.MustAccAddressFromBech32(balance.Address)
        keeper.SetFractionalBalance(ctx, addr, balance.Amount)
    }
}

// ExportGenesis 导出 precisebank 状态
func ExportGenesis(ctx sdk.Context, keeper keeper.Keeper) *types.GenesisState {
    // 导出所有分数余额
    balances := []types.FractionalBalance{}
    keeper.IterateFractionalBalances(ctx, func(addr sdk.AccAddress, amount sdkmath.Int) bool {
        balances = append(balances, types.FractionalBalance{
            Address: addr.String(),
            Amount:  amount,
        })
        return false
    })

    // 导出 remainder
    remainder := keeper.GetRemainderAmount(ctx)

    return &types.GenesisState{
        Balances:  balances,
        Remainder: remainder,
    }
}
```

---

## 常见问题

### Q1: 为什么我的 Remainder 总是 0？

**A**: 这是正常的，原因：

1. **在 Mainnet 上**：
   - EVM 交易中的 mint 和 burn 总是成对出现
   - 每笔交易后 remainder 恢复为 0

2. **在测试中**：
   - 如果你只做 transfer 操作，remainder 永远不变
   - Transfer 不影响 remainder

3. **Genesis 初始化**：
   - 如果 genesis 中 remainder 配置为 0
   - 并且没有 mint/burn 操作，remainder 保持为 0

### Q2: Remainder 可以为负数吗？

**A**: 不可以。

**验证**：

```go
func ValidateFractionalAmount(amount sdkmath.Int) error {
    if amount.IsNegative() {
        return fmt.Errorf("amount cannot be negative: %s", amount)
    }
    // ...
}
```

**处理**：在 mint 操作中，如果计算出负数，会自动调整：
```go
if newRemainder.IsNegative() {
    newRemainder = newRemainder.Add(types.ConversionFactor())
    // 同时从准备金额外铸造 1 utest
}
```

### Q3: Remainder 的最大值是多少？

**A**: `ConversionFactor - 1 = 999,999,999,999 atest`

**验证**：

```go
if amount.GTE(ConversionFactor()) {
    return fmt.Errorf(
        "amount must be less than conversion factor %s: %s",
        ConversionFactor(),
        amount,
    )
}
```

**处理**：在 burn 操作中，如果超过最大值，会自动调整：
```go
if newRemainder.GTE(types.ConversionFactor()) {
    newRemainder = newRemainder.Sub(types.ConversionFactor())
    // 同时从准备金燃烧 1 utest
}
```

### Q4: 如何理解 Remainder 和准备金的关系？

**A**:

**准备金账户（Reserve Account）**：
- 持有额外的整数币（utest），用于支持分数余额
- 公式：`b(R) × C = sum(f) + r`

**Remainder**：
- 表示准备金中"已备份但未分配"的分数部分
- 是准备金总额减去所有账户分数余额后的剩余

**示例**：

```
准备金账户余额: 5 utest
ConversionFactor: 10^12 atest/utest

准备金对应的 atest: 5 × 10^12 = 5,000,000,000,000 atest

所有账户分数余额之和: 3,500,000,000,000 atest

Remainder: 5,000,000,000,000 - 3,500,000,000,000 = 1,500,000,000,000 atest

验证：
b(R) × C = sum(f) + r
5 × 10^12 = 3,500,000,000,000 + 1,500,000,000,000
5,000,000,000,000 = 5,000,000,000,000 ✓
```

### Q5: Transfer 为什么不改变 Remainder？

**A**:

**数学证明**：

Transfer 只是重新分配分数余额：
```
发送方: f(A) → f(A) - x
接收方: f(B) → f(B) + x

总和: sum(f)' = (f(A) - x) + (f(B) + x) + ... = sum(f)
```

因为总和不变，根据不变式：
```
sum(f) + r = 常数（k × ConversionFactor）

如果 sum(f) 不变，则 r 也不变
```

**实际意义**：

Transfer 不涉及准备金：
- 不从准备金取出分数单位（不 mint）
- 不向准备金存入分数单位（不 burn）
- 只是在账户之间移动已存在的分数单位
- 因此 remainder（准备金中未分配的部分）保持不变

### Q6: 如何手动计算 Remainder 应该是多少？

**A**:

**步骤**：

1. **查询准备金余额**：
   ```bash
   evmd query bank balances <reserve-account-address>
   ```

2. **查询所有分数余额总和**：
   ```bash
   evmd query precisebank total-fractional-balances
   ```

3. **计算**：
   ```
   准备金 atest 总额 = 准备金 utest × ConversionFactor
   Remainder = 准备金 atest 总额 - 所有分数余额之和
   ```

**示例**：

```
准备金余额: 1000 utest
所有分数余额之和: 500,000,000,000 atest

计算：
准备金 atest: 1000 × 10^12 = 1,000,000,000,000,000 atest
Remainder: 1,000,000,000,000,000 - 500,000,000,000 = 999,999,500,000,000,000 atest

验证：
remainder 必须 < ConversionFactor ✗（这个例子中超限了，说明准备金余额很大）
```

### Q7: Remainder 会影响账户余额查询吗？

**A**: 不会。

**原因**：

Remainder 是内部账簿金额，用户查询余额时看不到：

1. **查询整数余额**：
   ```bash
   evmd query bank balances <address>
   # 返回 utest 余额，不包含 remainder
   ```

2. **查询分数余额**：
   ```bash
   evmd query precisebank fractional-balance <address>
   # 返回该账户的分数余额，不包含 remainder
   ```

3. **查询扩展余额**：
   ```bash
   evmd query bank balances <address> --denom atest
   # 返回: 整数余额 × ConversionFactor + 分数余额
   # 不包含 remainder
   ```

**Remainder 只影响**：
- 准备金账户的整数余额
- 系统内部的不变式验证
- Genesis 验证

---

## 总结

### Remainder 的本质

**Remainder** 是 x/precisebank 模块中的一个关键概念，用于维护分数余额系统的数学一致性。

**核心要点**：

1. **定义**：由准备金备份但未分配给任何账户的分数单位
2. **范围**：0 到 ConversionFactor - 1
3. **更新**：仅在 Mint/Burn 时更新，Transfer 不影响
4. **不变式**：sum(fractionalBalances) + remainder ≡ 0 (mod ConversionFactor)
5. **实际状态**：在 Mainnet 上通常为 0（因为 Mint/Burn 成对出现）

### 关键文件位置

| 文件 | 功能 |
|------|------|
| `x/precisebank/keeper/remainder_amount.go` | Remainder 的存储和访问 |
| `x/precisebank/keeper/mint.go` | Mint 时更新 remainder |
| `x/precisebank/keeper/burn.go` | Burn 时更新 remainder |
| `x/precisebank/types/keys.go` | 存储键定义 |
| `x/precisebank/types/genesis.go` | Genesis 验证 |
| `x/precisebank/README.md` | 详细的数学文档 |

### 你的查询结果解释

**为什么 Remainder 是 0？**

因为：
1. 你执行的是 **Transfer 操作**，不改变 remainder
2. 转移前 remainder 就是 0
3. 转移后 remainder 仍然是 0

**验证**：
```
sum(fractionalBalances) + remainder = 1,000,000,000,000 + 0 = 1,000,000,000,000
1,000,000,000,000 mod ConversionFactor = 0 ✓（完全整除）
```

这是正常且符合预期的行为！

---

**创建时间**: 2026-01-09
**作者**: Claude Code
**版本**: 1.0

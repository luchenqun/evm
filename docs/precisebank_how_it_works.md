# Precisebank：如何表示低于 Bank 最小单位的精度

## 你的问题

> 现在 bank 模块中最小单位为 1 uatom，那么用户转移 1 aatom，bank 模块无法表示这么低的精度，该怎么办？

**精彩的问题！** 这正是 `precisebank` 模块存在的原因。

---

## TL;DR（快速答案）

**Precisebank 使用"整数 + 分数"的双账本系统**：

```
总余额 (aatom) = 整数部分 (uatom) × 10^12 + 分数部分 (aatom)
                  ↑                          ↑
              存储在 bank               存储在 precisebank
```

**示例**：
```
bank 余额:         1,234,567 uatom
precisebank 余额:  890,123,456,789 aatom (分数部分)
总余额:            1,234,567 × 10^12 + 890,123,456,789 = 1,234,567,890,123,456,789 aatom
```

这样就可以精确表示任意的 aatom 金额，即使 bank 模块只能处理 uatom！

---

## 详细解释

### 问题场景

在你的配置中：
- **Bank 最小单位**：1 uatom（6 位小数）
- **EVM 最小单位**：1 aatom（18 位小数）
- **关系**：1 uatom = 10^12 aatom

**问题**：如果用户转移 1 aatom，bank 模块怎么表示？
```
1 aatom = 0.000000000001 uatom (10^-12 uatom)
```

Bank 模块只能存储整数，无法表示 10^-12 uatom！

### Precisebank 的解决方案

Precisebank 使用**分离存储**策略：

1. **整数部分**：存储在 `x/bank`（单位：uatom）
2. **分数部分**：存储在 `x/precisebank`（单位：aatom，范围 0 到 10^12-1）
3. **总余额**：整数部分 × 转换因子 + 分数部分

### 数据结构

#### Bank 模块（整数部分）

```protobuf
// x/bank 存储
message Balance {
  string address = 1;
  repeated Coin coins = 2;
}

message Coin {
  string denom = 1;   // "uatom"
  string amount = 2;  // 整数，如 "1234567"
}
```

#### Precisebank 模块（分数部分）

```protobuf
// x/precisebank 存储
message FractionalBalance {
  string address = 1;
  string amount = 2;  // 整数，范围 [0, 10^12)，单位是 aatom
}
```

**关键约束**：
```go
// 分数余额必须 < ConversionFactor (10^12)
0 <= FractionalBalance < 10^12 aatom
```

这确保分数部分永远不会"溢出"成整数部分。

---

## 工作原理示例

### 示例 1：存储余额

**场景**：用户有 1.5 ETH（1.5 atom）

**计算**：
```
1.5 atom = 1,500,000,000,000,000,000 aatom (10^18 wei)

分解：
整数部分 = 1,500,000,000,000,000,000 ÷ 10^12 = 1,500,000 uatom
分数部分 = 1,500,000,000,000,000,000 mod 10^12 = 0 aatom
```

**存储**：
```
bank:         1,500,000 uatom
precisebank:  0 aatom
总余额:       1,500,000 × 10^12 + 0 = 1,500,000,000,000,000,000 aatom ✓
```

### 示例 2：转移小额（低于 uatom）

**场景**：用户转移 1 aatom

**初始状态**：
```
发送方:
  bank:         1,000,000 uatom
  precisebank:  0 aatom
  总余额:       1,000,000,000,000,000,000 aatom

接收方:
  bank:         0 uatom
  precisebank:  0 aatom
  总余额:       0 aatom
```

**转移 1 aatom**：

转移金额：1 aatom

```go
// x/precisebank/keeper/send.go:169-170
integerAmt := amt.Quo(types.ConversionFactor())
// integerAmt = 1 ÷ 10^12 = 0 (整数除法)

fractionalAmt := amt.Mod(types.ConversionFactor())
// fractionalAmt = 1 mod 10^12 = 1 aatom
```

所以：
- 整数转移：0 uatom（不需要通过 bank 转移）
- 分数转移：1 aatom（通过 precisebank 转移）

**发送方扣除**：

```go
// 发送方当前分数余额：0 aatom
// 需要扣除：1 aatom
// 0 - 1 = -1 < 0，分数不足！

// 需要借位（borrow）：从 bank 借 1 uatom
senderNewFracBal = 0 - 1 + 10^12 = 999,999,999,999 aatom
senderNeedsBorrow = true
```

发送方借位操作：
```go
// x/precisebank/keeper/send.go:199-208
// 从发送方的 bank 账户转 1 uatom 到 precisebank 模块账户（储备金）
k.bk.SendCoinsFromAccountToModule(
    ctx,
    from, // 发送方
    types.ModuleName, // precisebank 模块
    sdk.NewCoins(sdk.NewCoin("uatom", sdkmath.NewInt(1))),
)
```

**接收方增加**：

```go
// 接收方当前分数余额：0 aatom
// 增加：1 aatom
// 0 + 1 = 1 aatom < 10^12，不需要进位

recipientNewFracBal = 0 + 1 = 1 aatom
recipientNeedsCarry = false
```

**最终状态**：
```
发送方:
  bank:         999,999 uatom (减少了 1 uatom)
  precisebank:  999,999,999,999 aatom (借位后的余额)
  总余额:       999,999 × 10^12 + 999,999,999,999 = 999,999,999,999,999,999 aatom
  变化:        -1 aatom ✓

接收方:
  bank:         0 uatom
  precisebank:  1 aatom
  总余额:       0 × 10^12 + 1 = 1 aatom
  变化:        +1 aatom ✓

precisebank 模块（储备金）:
  bank:         1 uatom (从发送方借来的)
```

### 示例 3：转移大额（跨越进位）

**场景**：发送方转移 500,000,000,000 aatom

**初始状态**：
```
发送方:
  bank:         1,000,000 uatom
  precisebank:  600,000,000,000 aatom
  总余额:       1,000,600,000,000,000 aatom

接收方:
  bank:         0 uatom
  precisebank:  800,000,000,000 aatom
  总余额:       800,000,000,000 aatom
```

**转移计算**：

```go
integerAmt = 500,000,000,000 ÷ 10^12 = 0 uatom
fractionalAmt = 500,000,000,000 mod 10^12 = 500,000,000,000 aatom
```

**发送方扣除**：

```go
senderNewFracBal = 600,000,000,000 - 500,000,000,000 = 100,000,000,000 aatom
senderNeedsBorrow = false // 分数余额足够，不需要借位
```

**接收方增加**：

```go
recipientNewFracBal = 800,000,000,000 + 500,000,000,000 = 1,300,000,000,000 aatom
// 1,300,000,000,000 >= 10^12，需要进位！

recipientNeedsCarry = true
recipientNewFracBal = 1,300,000,000,000 - 10^12 = 300,000,000,000 aatom
```

接收方进位操作：
```go
// x/precisebank/keeper/send.go:214-234
// 从 precisebank 模块账户（储备金）转 1 uatom 到接收方
k.bk.SendCoins(
    ctx,
    reserveAddr, // precisebank 模块
    to, // 接收方
    sdk.NewCoins(sdk.NewCoin("uatom", sdkmath.NewInt(1))),
)
```

**最终状态**：
```
发送方:
  bank:         1,000,000 uatom (不变)
  precisebank:  100,000,000,000 aatom
  总余额:       1,000,100,000,000,000 aatom
  变化:        -500,000,000,000 aatom ✓

接收方:
  bank:         1 uatom (进位增加)
  precisebank:  300,000,000,000 aatom
  总余额:       1 × 10^12 + 300,000,000,000 = 1,300,000,000,000 aatom
  变化:        +500,000,000,000 aatom ✓

precisebank 模块（储备金）:
  bank:         -1 uatom (给接收方的进位)
```

---

## 四种转移场景

Precisebank 处理 4 种场景（参见 `send.go:100-125`）：

| 场景 | 发送方借位 | 接收方进位 | Bank 操作 |
|------|------------|------------|-----------|
| #1 | 需要 | 需要 | 直接转移借位和进位（+1 uatom 从发送方到接收方）|
| #2 | 需要 | 不需要 | 发送方转 1 uatom 到储备金 |
| #3 | 不需要 | 需要 | 储备金转 1 uatom 到接收方 |
| #4 | 不需要 | 不需要 | 只更新分数余额，不涉及 bank |

### 场景详解

#### 场景 #1：发送方借位 + 接收方进位

**示例**：
```
发送方分数余额: 100 aatom
接收方分数余额: 999,999,999,999 aatom (几乎满了)
转移金额: 200 aatom
```

**发送方**：
```
100 - 200 = -100 < 0
需要借位！从 bank 借 1 uatom = 10^12 aatom
新分数余额 = -100 + 10^12 = 999,999,999,900 aatom
```

**接收方**：
```
999,999,999,999 + 200 = 1,000,000,000,199 aatom >= 10^12
需要进位！转 1 uatom 到 bank
新分数余额 = 1,000,000,000,199 - 10^12 = 199 aatom
```

**优化**：
```
发送方需要借 1 uatom，接收方需要进位 1 uatom
可以直接从发送方的 bank 转 1 uatom 到接收方的 bank！
不需要经过储备金。
```

#### 场景 #2：发送方借位，接收方不进位

**示例**：
```
发送方分数余额: 100 aatom
接收方分数余额: 0 aatom
转移金额: 200 aatom
```

**操作**：
```
发送方需要借 1 uatom → 转到储备金
接收方不需要进位
```

#### 场景 #3：发送方不借位，接收方进位

**示例**：
```
发送方分数余额: 500,000,000,000 aatom
接收方分数余额: 600,000,000,000 aatom
转移金额: 500,000,000,000 aatom
```

**操作**：
```
发送方不需要借位
接收方需要进位 1 uatom → 从储备金获取
```

#### 场景 #4：无借位，无进位

**示例**：
```
发送方分数余额: 500,000,000,000 aatom
接收方分数余额: 0 aatom
转移金额: 100 aatom
```

**操作**：
```
只更新 precisebank 的分数余额
不涉及 bank 模块
```

---

## Precisebank 储备金

### 储备金的作用

Precisebank 模块账户持有一定数量的 uatom 作为**储备金**（reserve），用于处理借位和进位操作。

### 储备金余额

```
储备金余额 = Σ(所有账户的分数余额) ÷ 10^12 (向上取整)
```

**示例**：
```
账户 A: 500,000,000,000 aatom
账户 B: 300,000,000,000 aatom
账户 C: 700,000,000,000 aatom
总计:   1,500,000,000,000 aatom

储备金 = ⌈1,500,000,000,000 ÷ 10^12⌉ = ⌈1.5⌉ = 2 uatom
```

### 为什么需要储备金？

**场景**：所有用户同时将分数余额全部提取到 bank

```
如果所有分数余额都转换成整数：
总分数余额 / 10^12 = 需要的 uatom 数量

储备金必须 >= 这个数量，才能支持所有转换。
```

### 储备金验证

Precisebank 在每次操作后都会验证储备金是否充足：

```go
// x/precisebank/keeper/invariants.go
// 储备金 >= ⌈Σ分数余额 / 10^12⌉
```

如果储备金不足，链会停止（invariant 失败）。

---

## 查询余额

### 查询整数余额（bank）

```bash
evmd query bank balances <address>
```

返回：
```json
{
  "balances": [
    {
      "denom": "uatom",
      "amount": "1000000"
    }
  ]
}
```

### 查询分数余额（precisebank）

```bash
evmd query precisebank fractional-balance <address>
```

返回：
```json
{
  "address": "cosmos1...",
  "amount": "500000000000"
}
```

### 查询总余额（precisebank）

```bash
evmd query precisebank balance <address> aatom
```

返回：
```json
{
  "balance": {
    "denom": "aatom",
    "amount": "1000500000000000"
  }
}
```

计算：
```
总余额 = 1,000,000 uatom × 10^12 + 500,000,000,000 aatom
       = 1,000,000,000,000,000,000 + 500,000,000,000
       = 1,000,500,000,000,000 aatom ✓
```

---

## 代码流程

### SendCoins 流程

```go
// x/precisebank/keeper/send.go:56
func (k Keeper) SendCoins(ctx, from, to, amt) error {
    // 1. 分离普通币和扩展币
    passthroughCoins := amt // 除了 aatom 以外的币
    extendedCoinAmount := amt.AmountOf("aatom")

    // 2. 普通币通过 x/bank 转移
    if passthroughCoins.IsAllPositive() {
        k.bk.SendCoins(ctx, from, to, passthroughCoins)
    }

    // 3. 扩展币通过 precisebank 转移
    if extendedCoinAmount.IsPositive() {
        k.sendExtendedCoins(ctx, from, to, extendedCoinAmount)
    }
}
```

### sendExtendedCoins 流程

```go
// x/precisebank/keeper/send.go:125
func (k Keeper) sendExtendedCoins(ctx, from, to, amt) error {
    // 1. 分解金额
    integerAmt = amt / 10^12        // 整数部分
    fractionalAmt = amt % 10^12     // 分数部分

    // 2. 获取当前分数余额
    senderFracBal = k.GetFractionalBalance(ctx, from)
    recipientFracBal = k.GetFractionalBalance(ctx, to)

    // 3. 计算新的分数余额和借位/进位
    senderNewFracBal, senderNeedsBorrow =
        subFromFractionalBalance(senderFracBal, fractionalAmt)

    recipientNewFracBal, recipientNeedsCarry =
        addToFractionalBalance(recipientFracBal, fractionalAmt)

    // 4. 处理 4 种场景
    if senderNeedsBorrow && recipientNeedsCarry {
        // 场景 #1: 直接转移
        integerAmt += 1
    }

    // 5. 转移整数部分（如果有）
    if integerAmt > 0 {
        k.bk.SendCoins(ctx, from, to,
            sdk.NewCoins(sdk.NewCoin("uatom", integerAmt)))
    }

    // 6. 处理借位（场景 #2）
    if senderNeedsBorrow && !recipientNeedsCarry {
        k.bk.SendCoinsFromAccountToModule(ctx, from,
            types.ModuleName, sdk.NewCoins(sdk.NewCoin("uatom", 1)))
    }

    // 7. 处理进位（场景 #3）
    if !senderNeedsBorrow && recipientNeedsCarry {
        k.bk.SendCoins(ctx, reserveAddr, to,
            sdk.NewCoins(sdk.NewCoin("uatom", 1)))
    }

    // 8. 更新分数余额
    k.SetFractionalBalance(ctx, from, senderNewFracBal)
    k.SetFractionalBalance(ctx, to, recipientNewFracBal)
}
```

---

## 总结

### Precisebank 解决了什么问题？

**问题**：Bank 模块只能存储整数，无法表示低于 uatom 的精度。

**解决方案**：
1. **分离存储**：整数部分存 bank，分数部分存 precisebank
2. **自动转换**：转移时自动处理借位和进位
3. **储备金机制**：precisebank 模块持有储备金支持借位/进位
4. **透明性**：用户看到的是完整的 aatom 余额，无需关心内部细节

### 关键特性

✅ **精确表示**：可以精确表示任意 aatom 金额
✅ **自动管理**：借位/进位自动处理，用户无感知
✅ **安全性**：储备金 invariant 确保系统一致性
✅ **兼容性**：完全兼容标准 Cosmos bank 模块

### 类比

想象一下货币系统：

```
美元系统：
- 整数部分：美元（存在银行账户）
- 分数部分：美分（存在零钱罐）
- 总金额 = 美元 × 100 + 美分

Precisebank：
- 整数部分：uatom（存在 bank）
- 分数部分：aatom（存在 precisebank）
- 总金额 = uatom × 10^12 + aatom
```

当你给别人 50 美分，但零钱罐里只有 25 美分时：
1. 从银行取出 1 美元（100 美分）
2. 零钱罐现在有 125 美分
3. 给出 50 美分
4. 零钱罐剩 75 美分

这就是 precisebank 的"借位"机制！

---

**创建时间**：2026-01-08
**问题提出者**：lcq
**作者**：Claude Code

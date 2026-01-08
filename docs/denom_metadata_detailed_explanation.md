# Denom Metadata 详细解释

## 目录
1. [什么是 Denom Metadata](#什么是-denom-metadata)
2. [字段详解](#字段详解)
3. [Exponent 的工作原理](#exponent-的工作原理)
4. [常见示例](#常见示例)
5. [在 EVM 项目中的特殊应用](#在-evm-项目中的特殊应用)
6. [常见错误配置](#常见错误配置)

---

## 什么是 Denom Metadata

`denom_metadata` 是 Cosmos SDK 中用于定义代币单位层次结构的元数据。它允许一个代币有多个不同的单位表示，类似于现实世界中的货币：

- 比特币：1 BTC = 1,000 mBTC = 1,000,000 μBTC = 100,000,000 satoshi
- 以太坊：1 ETH = 1,000 finney = 1,000,000 szabo = 1,000,000,000 gwei = 10^18 wei
- 美元：1 USD = 100 cents

在 Cosmos SDK 中，这些单位关系通过 `denom_metadata` 定义。

---

## 字段详解

### 完整的 Denom Metadata 结构

```json
{
  "description": "代币的描述信息",
  "denom_units": [
    {
      "denom": "单位名称",
      "exponent": 0,
      "aliases": ["别名1", "别名2"]
    }
  ],
  "base": "基础单位（最小不可分割单位）",
  "display": "显示单位（UI 中默认显示的单位）",
  "name": "代币全名",
  "symbol": "代币符号",
  "uri": "代币相关的 URI（可选）",
  "uri_hash": "URI 的哈希值（可选）"
}
```

### 字段说明

#### 1. `base` (基础单位)

- **定义**：最小的、不可分割的单位
- **特点**：
  - 所有链上存储和计算都使用这个单位
  - **exponent 必须为 0**
  - 不能再细分
- **类比**：
  - 比特币的 satoshi (1 satoshi = 10^-8 BTC)
  - 以太坊的 wei (1 wei = 10^-18 ETH)
  - 美元的 cent (1 cent = 10^-2 USD)

#### 2. `display` (显示单位)

- **定义**：用户界面中默认显示的单位
- **特点**：
  - 最"人性化"的单位
  - 通常是整数部分最小的单位
- **类比**：
  - 比特币显示为 BTC（而不是 satoshi）
  - 以太坊显示为 ETH（而不是 wei）
  - 美元显示为 USD（而不是 cent）

#### 3. `denom_units` (单位列表)

定义所有可用的单位及其相对于 base 的关系。

每个单位包含：
- **denom**: 单位名称
- **exponent**: 相对于 base 的 10 的幂次
- **aliases**: 别名列表（可选）

#### 4. `name` 和 `symbol`

- **name**: 代币的完整名称（如 "Cosmos Hub"）
- **symbol**: 代币符号（如 "ATOM"）

---

## Exponent 的工作原理

### 基本公式

```
1 单位 = 10^exponent × base 单位
```

### 示例 1：传统 Cosmos (ATOM)

```json
{
  "denom_units": [
    {
      "denom": "uatom",
      "exponent": 0
    },
    {
      "denom": "matom",
      "exponent": 3
    },
    {
      "denom": "atom",
      "exponent": 6
    }
  ],
  "base": "uatom",
  "display": "atom"
}
```

**单位关系**：
- `uatom` 的 exponent = 0，所以 `1 uatom = 10^0 × uatom = 1 uatom`（基础单位）
- `matom` 的 exponent = 3，所以 `1 matom = 10^3 × uatom = 1,000 uatom`
- `atom` 的 exponent = 6，所以 `1 atom = 10^6 × uatom = 1,000,000 uatom`

**换算**：
```
1 atom = 1,000 matom = 1,000,000 uatom
```

### 示例 2：以太坊 (ETH)

```json
{
  "denom_units": [
    {
      "denom": "wei",
      "exponent": 0
    },
    {
      "denom": "gwei",
      "exponent": 9
    },
    {
      "denom": "eth",
      "exponent": 18
    }
  ],
  "base": "wei",
  "display": "eth"
}
```

**单位关系**：
- `wei` 的 exponent = 0，所以 `1 wei = 1 wei`（基础单位）
- `gwei` 的 exponent = 9，所以 `1 gwei = 10^9 wei`
- `eth` 的 exponent = 18，所以 `1 eth = 10^18 wei`

**换算**：
```
1 ETH = 10^9 gwei = 10^18 wei
```

### 示例 3：美元 (USD)

如果用 Cosmos SDK 表示美元：

```json
{
  "denom_units": [
    {
      "denom": "cent",
      "exponent": 0
    },
    {
      "denom": "dollar",
      "exponent": 2
    }
  ],
  "base": "cent",
  "display": "dollar"
}
```

**单位关系**：
- `cent` 的 exponent = 0，所以 `1 cent = 1 cent`（基础单位）
- `dollar` 的 exponent = 2，所以 `1 dollar = 10^2 cent = 100 cent`

---

## 在 EVM 项目中的特殊应用

### 背景

这个 EVM 项目需要：
1. 兼容 Cosmos 的 6 位小数传统（`uatom`）
2. 支持 EVM 的 18 位小数（`aatom`）
3. 使用 `precisebank` 模块在两者之间转换

### 正确的配置

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

### 为什么 uatom 的 exponent 是 12？

这是最容易混淆的地方，让我详细解释：

#### 传统 Cosmos 的定义
```
1 atom = 10^6 uatom
```

这意味着 atom 有 6 位小数。

#### EVM 需要 18 位小数

但 EVM（以太坊虚拟机）使用 18 位小数：
```
1 atom = 10^18 wei (或在这个项目中称为 aatom)
```

#### 计算 uatom 相对于 aatom 的关系

如果：
- 1 atom = 10^18 aatom（EVM 定义）
- 1 atom = 10^6 uatom（Cosmos 定义）

那么：
```
10^6 uatom = 10^18 aatom
1 uatom = 10^18 / 10^6 aatom
1 uatom = 10^12 aatom
```

所以，**uatom 相对于 base (aatom) 的 exponent 是 12**。

### 三层单位结构

```
┌─────────────────────────────────────────────────────────────┐
│                          1 atom                             │
│                     (显示单位, exp=18)                       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│      10^6 uatom          │    │     10^18 aatom          │
│   (Cosmos 单位, exp=12)  │    │    (EVM 单位, exp=0)     │
│     6 位小数单位          │    │    18 位小数单位          │
└──────────────────────────┘    └──────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              │
                         1 uatom = 10^12 aatom
```

### 单位换算表

| 单位 | Exponent | 相对于 aatom | 相对于 uatom | 相对于 atom |
|------|----------|--------------|--------------|-------------|
| aatom | 0 | 1 | 10^-12 | 10^-18 |
| uatom | 12 | 10^12 | 1 | 10^-6 |
| atom | 18 | 10^18 | 10^6 | 1 |

### 实际应用

#### 场景 1：EVM 转账

用户发送 1 ETH (= 10^18 wei)：

```
EVM 金额: 10^18 (单位: wei/aatom, 18 位小数)
         ↓
转换到 Cosmos: 10^18 aatom
         ↓
precisebank 转换:
  整数部分 = 10^18 ÷ 10^12 = 10^6 uatom
  分数部分 = 10^18 mod 10^12 = 0 aatom
         ↓
最终扣除: 10^6 uatom (= 1 atom) ✓
```

#### 场景 2：Cosmos 原生转账

用户发送 1 atom：

```
Cosmos 金额: 1,000,000 uatom (6 位小数)
         ↓
扩展到 18 位小数: 1,000,000 × 10^12 = 10^18 aatom
         ↓
在 EVM 中显示: 10^18 wei = 1 ETH ✓
```

---

## 常见示例

### 示例 1：6 位小数链（传统 Cosmos）

```json
{
  "denom_units": [
    {
      "denom": "utest",
      "exponent": 0
    },
    {
      "denom": "test",
      "exponent": 6
    }
  ],
  "base": "utest",
  "display": "test"
}
```

- base 是 `utest`
- 1 test = 10^6 utest
- 链上存储使用 `utest`

### 示例 2：18 位小数链（纯 EVM）

```json
{
  "denom_units": [
    {
      "denom": "atest",
      "exponent": 0
    },
    {
      "denom": "test",
      "exponent": 18
    }
  ],
  "base": "atest",
  "display": "test"
}
```

- base 是 `atest`
- 1 test = 10^18 atest
- 链上存储使用 `atest`
- `evm_denom` = `extended_denom` = `atest`

### 示例 3：混合链（本项目）

```json
{
  "denom_units": [
    {
      "denom": "aatom",
      "exponent": 0
    },
    {
      "denom": "uatom",
      "exponent": 12
    },
    {
      "denom": "atom",
      "exponent": 18
    }
  ],
  "base": "aatom",
  "display": "atom"
}
```

- base 是 `aatom`（18 位小数）
- `uatom` 是 Cosmos 原生单位（6 位小数）
- `atom` 是显示单位
- 需要 `precisebank` 在 `aatom` 和 `uatom` 之间转换

---

## 常见错误配置

### 错误 1：Base 设置错误

❌ **错误配置**：
```json
{
  "denom_units": [
    {
      "denom": "aatom",
      "exponent": 0
    },
    {
      "denom": "uatom",
      "exponent": 6
    }
  ],
  "base": "uatom"  // ❌ 错误！uatom 的 exponent 不是 0
}
```

**问题**：base 必须是 exponent 为 0 的单位。

✅ **正确配置**：
```json
{
  "base": "aatom"  // ✓ aatom 的 exponent 是 0
}
```

### 错误 2：Exponent 计算错误

❌ **错误配置**（你的原始配置）：
```json
{
  "denom_units": [
    {
      "denom": "aatom",
      "exponent": 0
    },
    {
      "denom": "uatom",
      "exponent": 6  // ❌ 错误！
    },
    {
      "denom": "atom",
      "exponent": 18
    }
  ],
  "base": "aatom"
}
```

**问题**：
- 如果 uatom 的 exponent 是 6，那么 1 uatom = 10^6 aatom
- 但我们需要 1 atom = 10^6 uatom（Cosmos 传统）
- 所以 1 uatom = 10^18 / 10^6 = 10^12 aatom
- 因此 uatom 的 exponent 应该是 12

✅ **正确配置**：
```json
{
  "denom_units": [
    {
      "denom": "aatom",
      "exponent": 0
    },
    {
      "denom": "uatom",
      "exponent": 12  // ✓ 正确！
    },
    {
      "denom": "atom",
      "exponent": 18
    }
  ],
  "base": "aatom"
}
```

### 错误 3：Base 不在 denom_units 中

❌ **错误配置**：
```json
{
  "denom_units": [
    {
      "denom": "utest",
      "exponent": 0
    }
  ],
  "base": "atest"  // ❌ atest 不在 denom_units 中
}
```

**问题**：base 必须在 denom_units 列表中定义。

### 错误 4：多个单位的 exponent 为 0

❌ **错误配置**：
```json
{
  "denom_units": [
    {
      "denom": "atest",
      "exponent": 0
    },
    {
      "denom": "utest",
      "exponent": 0  // ❌ 不能有两个 exponent 为 0 的单位
    }
  ],
  "base": "atest"
}
```

**问题**：只能有一个 base 单位（exponent = 0）。

---

## 验证你的配置

### 验证规则

1. **Base 验证**：
   - base 必须在 denom_units 中
   - base 的 exponent 必须为 0

2. **Exponent 验证**：
   - 只能有一个单位的 exponent 为 0
   - 所有 exponent 必须 ≥ 0
   - exponent 必须是整数

3. **单位关系验证**：
   - 计算 `1 display = 10^display_exp base`
   - 确认符合预期

### 验证命令

启动节点后：

```bash
# 查询 denom metadata
./build/evmd query bank denom-metadata

# 查询特定 denom 的 metadata
./build/evmd query bank denom-metadata uatom
```

### 手动计算验证

对于你的配置（修复后）：

```
base = aatom, exponent = 0
uatom, exponent = 12 → 1 uatom = 10^12 aatom
atom, exponent = 18 → 1 atom = 10^18 aatom

验证 Cosmos 传统定义：
1 atom = 10^18 aatom
1 uatom = 10^12 aatom
所以 1 atom = (10^18 / 10^12) uatom = 10^6 uatom ✓

这符合 Cosmos 的 6 位小数传统！
```

---

## 总结

### 关键要点

1. **Base**：最小单位，exponent 必须为 0，链上存储使用这个单位
2. **Display**：用户界面显示的单位，最"人性化"
3. **Exponent**：`1 单位 = 10^exponent × base`
4. **在混合链中**：
   - base 应该是最小的单位（18 位小数，如 `aatom`）
   - 中间单位（如 `uatom`）的 exponent 需要正确计算
   - 保持与 Cosmos 传统的兼容性

### 你的配置修复

| 字段 | 错误值 | 正确值 | 原因 |
|------|--------|--------|------|
| base | "uatom" | "aatom" | aatom 才是最小单位 (exp=0) |
| uatom exponent | 6 | 12 | 1 uatom = 10^12 aatom |

### 记忆技巧

想象一个楼梯：

```
atom (18层)      ← display (最上层)
   ↑
uatom (12层)     ← 中间层
   ↑
aatom (0层)      ← base (地面)
```

- 从 base 到 uatom 需要爬 12 层 (exponent=12)
- 从 base 到 atom 需要爬 18 层 (exponent=18)
- 从 uatom 到 atom 需要爬 6 层 (18-12=6，符合 Cosmos 6 位小数)

---

**创建时间**：2026-01-08
**作者**：Claude Code

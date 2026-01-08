# Genesis.json 配置解析：evm_denom 与 extended_denom

## 当前配置概览

基于 `build/nodes/node0/evmd/config/genesis.json` 的实际配置分析。

## 配置详情

### 1. EVM 模块配置

```json
{
  "app_name": "evmd",
  "app_version": "0.5.0-rc.0-156-g84c2a0aa",
  "genesis_time": "2026-01-08T06:08:39.183315Z",
  "chain_id": "9001",
  "initial_height": 1,
  "app_hash": null,
  "app_state": {
    "07-tendermint": null,
    "auth": {
      "params": {
        "max_memo_characters": "256",
        "tx_sig_limit": "7",
        "tx_size_cost_per_byte": "10",
        "sig_verify_cost_ed25519": "590",
        "sig_verify_cost_secp256k1": "1000"
      },
      "accounts": [
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1cml96vmptgw99syqrrz8az79xer2pcgp95srxm",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1jcltmuhplrdcwp7stlr4hlhlhgd4htqhnu0t2g",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1gzsvk8rruqn2sx64acfsskrwy8hvrmafzhvvr0",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1fx944mzagwdhx0wz7k9tfztc8g3lkfk6pzezqh",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1qqqqhe5pnaq5qq39wqkn957aydnrm45s0jk6ae",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        },
        {
          "@type": "/cosmos.auth.v1beta1.BaseAccount",
          "address": "cosmos1zyg3qtwny9stqe8j55fvmmm5hldk48ukk030he",
          "pub_key": null,
          "account_number": "0",
          "sequence": "0"
        }
      ]
    },
    "authz": {
      "authorization": []
    },
    "bank": {
      "params": {
        "send_enabled": [],
        "default_send_enabled": true
      },
      "balances": [
        {
          "address": "cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul",
          "coins": [
            {
              "denom": "uatom",
              "amount": "1000000000000000000000"
            },
            {
              "denom": "stake",
              "amount": "500000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1gzsvk8rruqn2sx64acfsskrwy8hvrmafzhvvr0",
          "coins": [
            {
              "denom": "uatom",
              "amount": "1000000000000000000000"
            },
            {
              "denom": "stake",
              "amount": "500000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1fx944mzagwdhx0wz7k9tfztc8g3lkfk6pzezqh",
          "coins": [
            {
              "denom": "uatom",
              "amount": "1000000000000000000000"
            },
            {
              "denom": "stake",
              "amount": "500000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1jcltmuhplrdcwp7stlr4hlhlhgd4htqhnu0t2g",
          "coins": [
            {
              "denom": "uatom",
              "amount": "1000000000000000000000"
            },
            {
              "denom": "stake",
              "amount": "500000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1cml96vmptgw99syqrrz8az79xer2pcgp95srxm",
          "coins": [
            {
              "denom": "uatom",
              "amount": "1000000000000000000000"
            },
            {
              "denom": "stake",
              "amount": "500000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1qqqqhe5pnaq5qq39wqkn957aydnrm45s0jk6ae",
          "coins": [
            {
              "denom": "uatom",
              "amount": "10000000000000000000000000"
            }
          ]
        },
        {
          "address": "cosmos1zyg3qtwny9stqe8j55fvmmm5hldk48ukk030he",
          "coins": [
            {
              "denom": "uatom",
              "amount": "10000000000000000000000000"
            }
          ]
        }
      ],
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
              "exponent": 6,
              "aliases": []
            },
            {
              "denom": "atom",
              "exponent": 18,
              "aliases": []
            }
          ],
          "base": "uatom",
          "display": "atom",
          "name": "Cosmos EVM",
          "symbol": "ATOM",
          "uri": "",
          "uri_hash": ""
        }
      ],
      "send_enabled": []
    },
    "consensus": null,
    "distribution": {
      "params": {
        "community_tax": "0.020000000000000000",
        "base_proposer_reward": "0.000000000000000000",
        "bonus_proposer_reward": "0.000000000000000000",
        "withdraw_addr_enabled": true
      },
      "fee_pool": {
        "community_pool": []
      },
      "delegator_withdraw_infos": [],
      "previous_proposer": "",
      "outstanding_rewards": [],
      "validator_accumulated_commissions": [],
      "validator_historical_rewards": [],
      "validator_current_rewards": [],
      "delegator_starting_infos": [],
      "validator_slash_events": []
    },
    "erc20": {
      "params": {
        "enable_erc20": true,
        "permissionless_registration": true
      },
      "token_pairs": [],
      "allowances": [],
      "native_precompiles": [],
      "dynamic_precompiles": []
    },
    "evidence": {
      "evidence": []
    },
    "evm": {
      "accounts": [],
      "params": {
        "evm_denom": "uatom",
        "extra_eips": [],
        "evm_channels": [],
        "access_control": {
          "create": {
            "access_type": "ACCESS_TYPE_PERMISSIONLESS",
            "access_control_list": []
          },
          "call": {
            "access_type": "ACCESS_TYPE_PERMISSIONLESS",
            "access_control_list": []
          }
        },
        "active_static_precompiles": [],
        "history_serve_window": "8192",
        "extended_denom_options": {
          "extended_denom": "aatom"
        }
      },
      "preinstalls": []
    },
    "feegrant": {
      "allowances": []
    },
    "feemarket": {
      "params": {
        "no_base_fee": false,
        "base_fee_change_denominator": 8,
        "elasticity_multiplier": 2,
        "enable_height": "0",
        "base_fee": "0.000000000000000000",
        "min_gas_price": "0.000000000000000000",
        "min_gas_multiplier": "0.500000000000000000"
      },
      "block_gas": "0"
    },
    "genutil": {
      "gen_txs": [
        {
          "body": {
            "messages": [
              {
                "@type": "/cosmos.staking.v1beta1.MsgCreateValidator",
                "description": {
                  "moniker": "node0",
                  "identity": "",
                  "website": "",
                  "security_contact": "",
                  "details": ""
                },
                "commission": {
                  "rate": "0.100000000000000000",
                  "max_rate": "1.000000000000000000",
                  "max_change_rate": "1.000000000000000000"
                },
                "min_self_delegation": "1",
                "delegator_address": "",
                "validator_address": "cosmosvaloper1hajh6rhhkjqkwet6wqld3lgx8ur4y3kh4frdsv",
                "pubkey": {
                  "@type": "/cosmos.crypto.ed25519.PubKey",
                  "key": "iWXOcw9xzHo8+r7HbzONTGmjdPKodDG1KB0gvxjCC70="
                },
                "value": {
                  "denom": "stake",
                  "amount": "100000000000000000000"
                }
              }
            ],
            "memo": "ab6c6100963d4728708af8a4edbeed88a379a185@192.168.0.1:26656",
            "timeout_height": "0",
            "unordered": false,
            "timeout_timestamp": null,
            "extension_options": [],
            "non_critical_extension_options": []
          },
          "auth_info": {
            "signer_infos": [
              {
                "public_key": {
                  "@type": "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
                  "key": "A50rbJg3TMPACbzE5Ujg0clx+d4udBAtggqEQiB7v9Sc"
                },
                "mode_info": {
                  "single": {
                    "mode": "SIGN_MODE_DIRECT"
                  }
                },
                "sequence": "0"
              }
            ],
            "fee": {
              "amount": [],
              "gas_limit": "0",
              "payer": "",
              "granter": ""
            },
            "tip": null
          },
          "signatures": ["60TkvVnKvrQ8z+0FbrRV5mfVs712uC5iGwQvwRcPcyVcxk50mHibqb6STXXCWdIcqMU89KMyA44Vw7AmgsDP2gA="]
        }
      ]
    },
    "gov": {
      "starting_proposal_id": "1",
      "deposits": [],
      "votes": [],
      "proposals": [],
      "deposit_params": null,
      "voting_params": null,
      "tally_params": null,
      "params": {
        "min_deposit": [
          {
            "denom": "stake",
            "amount": "10000000"
          }
        ],
        "max_deposit_period": "172800s",
        "voting_period": "120s",
        "quorum": "0.334000000000000000",
        "threshold": "0.500000000000000000",
        "veto_threshold": "0.334000000000000000",
        "min_initial_deposit_ratio": "0.000000000000000000",
        "proposal_cancel_ratio": "0.500000000000000000",
        "proposal_cancel_dest": "",
        "expedited_voting_period": "86400s",
        "expedited_threshold": "0.667000000000000000",
        "expedited_min_deposit": [
          {
            "denom": "stake",
            "amount": "50000000"
          }
        ],
        "burn_vote_quorum": false,
        "burn_proposal_deposit_prevote": false,
        "burn_vote_veto": true,
        "min_deposit_ratio": "0.010000000000000000"
      },
      "constitution": ""
    },
    "ibc": {
      "client_genesis": {
        "clients": [],
        "clients_consensus": [],
        "clients_metadata": [],
        "params": {
          "allowed_clients": ["*"]
        },
        "create_localhost": false,
        "next_client_sequence": "0"
      },
      "connection_genesis": {
        "connections": [],
        "client_connection_paths": [],
        "next_connection_sequence": "0",
        "params": {
          "max_expected_time_per_block": "30000000000"
        }
      },
      "channel_genesis": {
        "channels": [],
        "acknowledgements": [],
        "commitments": [],
        "receipts": [],
        "send_sequences": [],
        "recv_sequences": [],
        "ack_sequences": [],
        "next_channel_sequence": "0"
      },
      "client_v2_genesis": {
        "counterparty_infos": []
      },
      "channel_v2_genesis": {
        "acknowledgements": [],
        "commitments": [],
        "receipts": [],
        "async_packets": [],
        "send_sequences": []
      }
    },
    "mint": {
      "minter": {
        "inflation": "0.130000000000000000",
        "annual_provisions": "0.000000000000000000"
      },
      "params": {
        "mint_denom": "stake",
        "inflation_rate_change": "0.130000000000000000",
        "inflation_max": "0.200000000000000000",
        "inflation_min": "0.070000000000000000",
        "goal_bonded": "0.670000000000000000",
        "blocks_per_year": "6311520"
      }
    },
    "precisebank": {
      "balances": [],
      "remainder": "0"
    },
    "slashing": {
      "params": {
        "signed_blocks_window": "100",
        "min_signed_per_window": "0.500000000000000000",
        "downtime_jail_duration": "600s",
        "slash_fraction_double_sign": "0.050000000000000000",
        "slash_fraction_downtime": "0.010000000000000000"
      },
      "signing_infos": [],
      "missed_blocks": []
    },
    "staking": {
      "params": {
        "unbonding_time": "1814400s",
        "max_validators": 100,
        "max_entries": 7,
        "historical_entries": 10000,
        "bond_denom": "stake",
        "min_commission_rate": "0.000000000000000000"
      },
      "last_total_power": "0",
      "last_validator_powers": [],
      "validators": [],
      "delegations": [],
      "unbonding_delegations": [],
      "redelegations": [],
      "exported": false
    },
    "transfer": {
      "port_id": "transfer",
      "denoms": [],
      "params": {
        "send_enabled": true,
        "receive_enabled": true
      },
      "total_escrowed": []
    },
    "upgrade": {},
    "vesting": {}
  },
  "consensus": {
    "params": {
      "block": {
        "max_bytes": "22020096",
        "max_gas": "-1"
      },
      "evidence": {
        "max_age_num_blocks": "100000",
        "max_age_duration": "172800000000000",
        "max_bytes": "1048576"
      },
      "validator": {
        "pub_key_types": ["ed25519"]
      },
      "version": {
        "app": "0"
      },
      "abci": {
        "vote_extensions_enable_height": "0"
      }
    }
  }
}

```

```json
{
  "evm": {
    "params": {
      "evm_denom": "uatom",
      "extended_denom_options": {
        "extended_denom": "aatom"
      }
    }
  }
}
```

**关键配置**：
- `evm_denom`: `"uatom"` - 基础代币（整数代币）
- `extended_denom`: `"aatom"` - 扩展代币（18位小数）

### 2. 代币元数据（Denom Metadata）

```json
{
  "bank": {
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
            "exponent": 6,
            "aliases": []
          },
          {
            "denom": "atom",
            "exponent": 18,
            "aliases": []
          }
        ],
        "base": "uatom",
        "display": "atom",
        "name": "Cosmos EVM",
        "symbol": "ATOM"
      }
    ]
  }
}
```

**元数据解析**：

| Denom   | Exponent | 精度     | 说明                             |
| ------- | -------- | -------- | -------------------------------- |
| `aatom` | 0        | 18位小数 | 最小单位（atto-atom），扩展代币  |
| `uatom` | 6        | 6位小数  | 基础单位（micro-atom），整数代币 |
| `atom`  | 18       | 0位小数  | 显示单位（主单位）               |

**关系**：
- 1 `atom` = 10^18 `aatom` = 10^6 `uatom`
- 1 `uatom` = 10^12 `aatom`
- 转换因子 C = 10^12

## 配置分析

### evm_denom = "uatom"

**作用**：
- 这是 Cosmos SDK 中 `x/bank` 模块管理的基础代币
- 精度：6 位小数（exponent = 6）
- 存储在 `x/bank` 模块中
- 对应 `precisebank` 模块的 `IntegerCoinDenom()`

**在代码中的使用**：
```go
// x/precisebank/types/fractional_balance.go
func IntegerCoinDenom() string {
    return evmtypes.GetEVMCoinDenom()  // 返回 "uatom"
}
```

**余额存储示例**：
```json
{
  "address": "cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul",
  "coins": [
    {
      "denom": "uatom",
      "amount": "1000000000000000000000"  // 存储在 x/bank
    }
  ]
}
```

### extended_denom = "aatom"

**作用**：
- 这是 EVM 中使用的扩展代币
- 精度：18 位小数（exponent = 0，表示最小单位）
- 由 `precisebank` 模块管理
- 对应 `precisebank` 模块的 `ExtendedCoinDenom()`

**在代码中的使用**：
```go
// x/precisebank/types/fractional_balance.go
func ExtendedCoinDenom() string {
    return evmtypes.GetEVMCoinExtendedDenom()  // 返回 "aatom"
}
```

**余额组成**：
```
总余额（aatom）= 整数余额（uatom）× 10^12 + 分数余额（aatom）
```

## 精度扩展机制

### 转换关系

```
uatom (6位小数)  ←→  aatom (18位小数)
     × 10^12              ÷ 10^12
```

**示例转换**：
- 1000 `uatom` = 1000 × 10^12 = 1,000,000,000,000,000 `aatom`
- 500,000,000,000 `aatom` = 500,000,000,000 ÷ 10^12 = 0.5 `uatom`

### 余额表示示例

假设账户有以下余额：

**整数部分**（存储在 x/bank）：
```json
{
  "denom": "uatom",
  "amount": "1000"
}
```

**分数部分**（存储在 x/precisebank）：
```json
{
  "address": "cosmos1...",
  "fractional_balance": "500000000000"  // 单位：aatom
}
```

**总余额计算**：
```
总余额 = 1000 × 10^12 + 500000000000
      = 1,000,000,000,000,000 + 500,000,000,000
      = 1,000,500,000,000,000 aatom
```

## 实际配置验证

### 1. 配置一致性检查

根据 `x/vm/keeper/coin_info.go` 的逻辑：

```go
// 1. 获取 evm_denom 的元数据
evmDenomMetadata := GetDenomMetaData("uatom")
// 返回：base="uatom", display="atom", exponent=6

// 2. 确定精度
decimals = 6  // 从元数据中获取

// 3. 确定 extended_denom
if decimals == 18 {
    extendedDenom = "uatom"  // 不需要扩展
} else {
    extendedDenom = params.ExtendedDenomOptions.ExtendedDenom  // "aatom"
}

// 结果：
// Denom: "uatom"
// ExtendedDenom: "aatom"
// Decimals: 6
```

**验证结果**：✅ 配置正确
- `evm_denom` = "uatom"（6位小数）
- `extended_denom` = "aatom"（18位小数）
- 转换因子 = 10^12

### 2. 余额配置验证

查看 genesis.json 中的初始余额：

```json
{
  "address": "cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul",
  "coins": [
    {
      "denom": "uatom",
      "amount": "1000000000000000000000"  // 1,000,000,000,000 uatom
    },
    {
      "denom": "stake",
      "amount": "500000000000000000000"   // 500,000,000,000 stake
    }
  ]
}
```

**注意**：
- `uatom` 余额：这是整数代币余额，存储在 `x/bank`
- `stake` 余额：这是用于 staking 的代币（`bond_denom`），**不是** `extended_denom`
- `aatom` 余额：不会在 genesis 中直接显示，因为分数余额初始为 0

### 3. Staking 代币说明

**重要区别**：
- `stake`：用于 Cosmos SDK staking 的代币（`bond_denom`）
- `aatom`：用于 EVM 交易的扩展代币（`extended_denom`）

这两个是不同的代币：
```json
{
  "staking": {
    "params": {
      "bond_denom": "stake"  // Staking 使用的代币
    }
  },
  "evm": {
    "params": {
      "evm_denom": "uatom",
      "extended_denom_options": {
        "extended_denom": "aatom"  // EVM 使用的扩展代币
      }
    }
  }
}
```

## EVM 交易流程

### 示例：发送 1 ETH

1. **用户操作**：
   ```javascript
   // 用户发送 1 ETH
   await wallet.sendTransaction({
     to: '0x...',
     value: ethers.utils.parseEther('1')  // 1 ETH = 1000000000000000000 wei
   });
   ```

2. **系统转换**：
   ```
   ETH → aatom
   1 ETH = 1,000,000,000,000,000,000 wei = 1,000,000,000,000,000,000 aatom
   ```

3. **precisebank 处理**：
   ```
   整数部分：1,000,000,000,000,000,000 ÷ 10^12 = 1,000,000 uatom
   分数部分：1,000,000,000,000,000,000 mod 10^12 = 0 aatom
   ```

4. **余额更新**：
   - x/bank：扣除 1,000,000 `uatom`（即 10^6 uatom）
   - x/precisebank：分数余额不变（因为整除）

**重要说明**：
- 发送 1 ETH（10^18 wei）应该只扣除 10^6 `uatom`
- 如果发现实际扣除了 10^18 `uatom`，说明系统可能直接将 wei 金额作为 `uatom` 处理了
- 正确的流程应该是：wei → aatom（金额不变）→ precisebank 转换 → uatom（除以 10^12）

## 查询余额示例

### 查询整数余额（uatom）

```bash
evmd query bank balances cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul
```

**返回**：
```json
{
  "balances": [
    {
      "denom": "uatom",
      "amount": "1000000000000000000000"
    },
    {
      "denom": "stake",
      "amount": "500000000000000000000"
    }
  ]
}
```

### 查询扩展余额（aatom）

```bash
evmd query bank balances cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul --denom aatom
```

**返回**：
```json
{
  "balance": {
    "denom": "aatom",
    "amount": "1000000000000000000000000000000000"  // 整数余额 × 10^12 + 分数余额
  }
}
```

### 查询分数余额

```bash
evmd query precisebank fractional-balance cosmos1hajh6rhhkjqkwet6wqld3lgx8ur4y3khsahcul
```

**返回**：
```json
{
  "fractional_balance": {
    "denom": "aatom",
    "amount": "0"  // 初始状态，分数余额为 0
  }
}
```

## 配置总结

| 配置项             | 值      | 说明                                    |
| ------------------ | ------- | --------------------------------------- |
| **evm_denom**      | `uatom` | 基础代币，6位小数，存储在 x/bank        |
| **extended_denom** | `aatom` | 扩展代币，18位小数，由 precisebank 管理 |
| **转换因子**       | 10^12   | uatom 到 aatom 的转换倍数               |
| **base denom**     | `uatom` | 代币元数据中的基础单位                  |
| **display denom**  | `atom`  | 显示单位（主单位）                      |
| **bond denom**     | `stake` | Staking 使用的代币（与 EVM 无关）       |

## 关键要点

1. **evm_denom = "uatom"**：
   - 6 位小数精度
   - 存储在 `x/bank` 模块
   - 用于 Cosmos SDK 原生交易

2. **extended_denom = "aatom"**：
   - 18 位小数精度
   - 由 `precisebank` 模块管理
   - 用于 EVM 交易

3. **转换关系**：
   - 1 `uatom` = 10^12 `aatom`
   - 账户总余额 = 整数余额（uatom）× 10^12 + 分数余额（aatom）

4. **staking 代币**：
   - `stake` 是独立的 staking 代币，与 EVM 代币系统无关
   - EVM 交易只使用 `uatom`/`aatom` 系统

5. **初始状态**：
   - Genesis 中只配置 `uatom` 余额
   - `aatom` 的分数余额初始为 0
   - 通过 EVM 交易后才会产生分数余额

## 验证命令

```bash
# 1. 查看 EVM 参数
evmd query evm params

# 2. 查看代币元数据
evmd query bank denom-metadata uatom

# 3. 查询账户余额
evmd query bank balances <address>

# 4. 查询扩展余额
evmd query bank balances <address> --denom aatom

# 5. 查询分数余额
evmd query precisebank fractional-balance <address>

# 6. 查询余数
evmd query precisebank remainder
```

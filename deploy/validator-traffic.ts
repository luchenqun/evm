// @ts-nocheck
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";
import initTomlEditor, { parse as parseToml } from "@rainbowatcher/toml-edit-js";
import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";

const execFileAsync = util.promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const deployDir = path.dirname(__filename);
const binary = path.join(deployDir, "evmd");

const STAKING_ADDRESS = "0x0000000000000000000000000000000000000800";
const DISTRIBUTION_ADDRESS = "0x0000000000000000000000000000000000000801";
const GOV_ADDRESS = "0x0000000000000000000000000000000000000805";
const GOV_MODULE_ADDR = "cosmos10d07y265gmmuvt4z0w9aw880jnsr700j6zn9kn";
const GAS_LIMIT = 1_000_000n;
const CREATE_VALIDATOR_AMOUNT = 10n ** 18n;
const STAKE_AMOUNT = 10_000_000_000_000n;
const DIST_AMOUNT = 10_000_000_000_000n;
const EVM_TRANSFER_AMOUNT = 10_000_000_000_000n;
const CLI_AMOUNT = "10000000000000";
const FAIL_RECEIVER = "cosmos1invalid";
const GOV_PROPOSAL_LIMIT = 10;
const GOV_SUBMIT_INTERVAL = 3;
const GOV_EXTRA_DEPOSIT = "1";
const CLI_GAS = "300000";
const CLI_FUND_AMOUNT = "100000000000000000";
const LOOP_DELAY_MS = 250;
const ROUND_DELAY_MS = 1000;
const RECEIPT_RETRY_DELAY_MS = 1000;
const RECEIPT_RETRY_LIMIT = 90;

const STAKING_ABI = ["function delegate(address delegatorAddress,string validatorAddress,uint256 amount) returns (bool)"];

const DISTRIBUTION_ABI = [
  "function fundCommunityPool(address depositor,(string denom,uint256 amount)[] amount) returns (bool)",
  "function depositValidatorRewardsPool(address depositor,string validatorAddress,(string denom,uint256 amount)[] amount) returns (bool)",
];

const GOV_ABI = [
  "event SubmitProposal(address indexed proposer, uint64 proposalId)",
  "function submitProposal(address proposer,bytes jsonProposal,(string denom,uint256 amount)[] deposit) returns (uint64 proposalId)",
  "function deposit(address depositor,uint64 proposalId,(string denom,uint256 amount)[] amount) returns (bool)",
  "function vote(address voter,uint64 proposalId,uint8 option,string metadata) returns (bool)",
];

const run = async (command, args, cwd = deployDir, allowFailure = false) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 32,
      timeout: 60_000,
    });
    return { ok: true, stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "" };
  } catch (error) {
    const stdout = error.stdout?.trim?.() ?? "";
    const stderr = error.stderr?.trim?.() ?? error.message;
    if (!allowFailure) {
      throw new Error([stderr, stdout].filter(Boolean).join("\n"));
    }
    return { ok: false, stdout, stderr };
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};
const loadChainId = async () => {
  const envPath = path.join(deployDir, "env.toml");
  const envExamplePath = path.join(deployDir, "env.toml.example");
  if (!(await exists(envPath))) {
    await copyFile(envExamplePath, envPath);
  }
  const config = parseToml(await readFile(envPath, "utf8"));
  return config["chain-id"] || "9001";
};
const shortError = (text) => String(text || "").split("\n")[0] || "unknown error";
const findEvent = (logs, iface, name) => {
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === name) {
        return parsed;
      }
    } catch {
      // ignore unrelated logs
    }
  }
  return null;
};

const log = (tag, fields = {}) => {
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
  console.log([tag, ...parts].join(" "));
};

const parseArgs = () => ({
  compile: process.argv.includes("--compile") || process.argv.includes("-c"),
});

const nodePaths = (index) => {
  const home = path.join(deployDir, "nodes", `node${index}`, "evmd");
  return {
    home,
    keySeed: path.join(home, "key_seed.json"),
    privValidator: path.join(home, "config", "priv_validator_key.json"),
    rpc: `http://127.0.0.1:${8545 + index * 10}`,
    tm: `tcp://127.0.0.1:${26657 + index}`,
  };
};

const getWallet = (mnemonic, provider) => Wallet.fromPhrase(mnemonic).connect(provider);

const startFreshNetwork = async (compile) => {
  log("boot", { validators: 1, common: 1, compile });
  await run("node", ["dev.ts", "--v=1", "--cn=1", `--c=${compile}`], deployDir);
};

const writeValidatorFile = async (pubkey) => {
  const dir = path.join(deployDir, "data");
  const file = path.join(dir, "node1-validator.json");
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        pubkey,
        amount: `${CREATE_VALIDATOR_AMOUNT}atest`,
        moniker: "node1",
        identity: "",
        website: "",
        security: "",
        details: "validator-traffic",
        "commission-rate": "0.05",
        "commission-max-rate": "0.20",
        "commission-max-change-rate": "0.01",
        "min-self-delegation": "1",
      },
      null,
      2,
    )}\n`,
  );
  return file;
};

const writeProposalFile = async (index, deposit, outcome, params) => {
  const dir = path.join(deployDir, "data");
  const file = path.join(dir, `proposal-${index}-${outcome}.json`);
  const title = `traffic-proposal-${index}`;
  const summary = `traffic proposal ${index} -> ${outcome}`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        messages: [
          {
            "@type": "/cosmos.gov.v1.MsgUpdateParams",
            authority: GOV_MODULE_ADDR,
            params,
          },
        ],
        metadata: title,
        deposit: `${deposit}atest`,
        title,
        summary,
        expedited: false,
      },
      null,
      2,
    )}\n`,
  );
  return file;
};

const showKey = async (index, name, bech = "acc") => {
  const { stdout } = await run(binary, ["keys", "show", name, "-a", "--bech", bech, "--home", nodePaths(index).home, "--keyring-backend", "test"]);
  return stdout.split(/\s+/).pop();
};

const ensureKey = async (index, name) => {
  const existing = await run(binary, ["keys", "show", name, "-a", "--home", nodePaths(index).home, "--keyring-backend", "test"], deployDir, true);
  if (existing.ok) {
    return existing.stdout.split(/\s+/).pop();
  }
  const created = await run(binary, ["keys", "add", name, "--home", nodePaths(index).home, "--keyring-backend", "test", "--output", "json"]);
  return JSON.parse(created.stdout).address;
};

const waitForRpc = async (provider, name) => {
  for (;;) {
    try {
      const height = await provider.getBlockNumber();
      log("rpc_ready", { node: name, height });
      return height;
    } catch {
      await sleep(1000);
    }
  }
};

const waitForValidator = async (valoper) => {
  for (;;) {
    const result = await run(binary, ["query", "staking", "validator", valoper, "--node", nodePaths(0).tm, "-o", "json"], deployDir, true);
    if (result.ok) {
      return;
    }
    await sleep(1000);
  }
};

const cliBaseArgs = (index, chainId) => {
  const paths = nodePaths(index);
  return [
    "--home",
    paths.home,
    "--node",
    paths.tm,
    "--chain-id",
    String(chainId),
    "--keyring-backend",
    "test",
    "--gas",
    CLI_GAS,
    "--gas-prices",
    "0atest",
    "--broadcast-mode",
    "sync",
    "--yes",
    "-o",
    "json",
  ];
};

const cliBankSendArgs = (index, chainId, from, to, amount) => ["tx", "bank", "send", from, to, `${amount}atest`, ...cliBaseArgs(index, chainId)];

const cliDelegateArgs = (index, chainId, from, validator, amount) => [
  "tx",
  "staking",
  "delegate",
  validator,
  `${amount}atest`,
  "--from",
  from,
  ...cliBaseArgs(index, chainId),
];

const cliGovSubmitArgs = (index, chainId, from, file) => ["tx", "gov", "submit-proposal", file, "--from", from, ...cliBaseArgs(index, chainId)];

const cliGovDepositArgs = (index, chainId, from, proposalId, amount) => [
  "tx",
  "gov",
  "deposit",
  String(proposalId),
  `${amount}atest`,
  "--from",
  from,
  ...cliBaseArgs(index, chainId),
];

const queryJson = async (args, required = false) => {
  const result = await run(binary, args, deployDir, true);
  if (!result.ok) {
    if (required) {
      throw new Error(result.stderr || result.stdout);
    }
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    if (required) {
      throw error;
    }
    return null;
  }
};

const sendCli = async (name, args, expectedFailure = false, required = false) => {
  const result = await run(binary, args, deployDir, true);
  if (!result.ok) {
    if (required) {
      throw new Error(result.stderr || result.stdout);
    }
    log(expectedFailure ? "cli_expected_fail" : "cli_err", { name, error: shortError(result.stderr || result.stdout) });
    return null;
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = null;
  }
  const code = Number(payload?.code ?? 0);
  if (code !== 0) {
    const raw = payload?.raw_log || payload?.codespace || result.stdout;
    if (required) {
      throw new Error(raw);
    }
    log(expectedFailure ? "cli_expected_fail" : "cli_err", { name, error: shortError(raw) });
    return payload;
  }
  log("cli_ok", { name, hash: payload?.txhash ?? "" });
  return payload;
};

const waitForReceipt = async (tx) => {
  const provider = tx.provider;
  for (let attempt = 1; attempt <= RECEIPT_RETRY_LIMIT; attempt++) {
    try {
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!message.includes("request timed out")) {
        throw error;
      }
    }
    await sleep(RECEIPT_RETRY_DELAY_MS);
  }
  throw new Error(`receipt timeout after ${RECEIPT_RETRY_LIMIT}s`);
};

const sendEvm = async (name, action, required = false) => {
  try {
    const tx = await action();
    const receipt = await waitForReceipt(tx);
    if (!receipt || receipt.status !== 1) {
      throw new Error(`receipt status ${receipt?.status ?? "missing"}`);
    }
    log("evm_ok", { name, hash: tx.hash, block: receipt.blockNumber });
    return true;
  } catch (error) {
    if (required) {
      throw error;
    }
    log("evm_err", { name, error: error.message });
    return false;
  }
};

const main = async () => {
  const options = parseArgs();
  await initTomlEditor();

  await startFreshNetwork(options.compile);

  const chainId = await loadChainId();

  const provider0 = new JsonRpcProvider(nodePaths(0).rpc);
  const provider1 = new JsonRpcProvider(nodePaths(1).rpc);

  await waitForRpc(provider0, "node0");
  await waitForRpc(provider1, "node1");

  const [{ secret: mnemonic0 }, { secret: mnemonic1 }, privValidator] = await Promise.all([
    readJson(nodePaths(0).keySeed),
    readJson(nodePaths(1).keySeed),
    readJson(nodePaths(1).privValidator),
  ]);

  const wallet0 = getWallet(mnemonic0, provider0);
  const wallet1 = getWallet(mnemonic1, provider1);
  const signer0 = new NonceManager(wallet0);
  const signer1 = new NonceManager(wallet1);
  const [node0Acc, node1Acc, node0Valoper, node1Valoper, aliceAcc, bobAcc, traffic0Acc, traffic1Acc, traffic2Acc, traffic3Acc] = await Promise.all([
    showKey(0, "node0", "acc"),
    showKey(1, "node1", "acc"),
    showKey(0, "node0", "val"),
    showKey(1, "node1", "val"),
    showKey(0, "alice", "acc"),
    showKey(0, "bob", "acc"),
    ensureKey(0, "traffic0"),
    ensureKey(0, "traffic1"),
    ensureKey(0, "traffic2"),
    ensureKey(0, "traffic3"),
  ]);
  const validatorFile = await writeValidatorFile({
    "@type": "/cosmos.crypto.ed25519.PubKey",
    key: privValidator.pub_key.value,
  });

  log("accounts", {
    node0: wallet0.address,
    node1: wallet1.address,
    node0Acc,
    node1Acc,
    node0Valoper,
    node1Valoper,
    aliceAcc,
    bobAcc,
    traffic0Acc,
    traffic1Acc,
    traffic2Acc,
    traffic3Acc,
  });

  await sendCli("fund_traffic0_from_alice", cliBankSendArgs(0, chainId, "alice", traffic0Acc, CLI_FUND_AMOUNT), false, true);
  await sendCli("fund_traffic1_from_bob", cliBankSendArgs(0, chainId, "bob", traffic1Acc, CLI_FUND_AMOUNT), false, true);
  await sendCli("fund_traffic2_from_alice", cliBankSendArgs(0, chainId, "alice", traffic2Acc, CLI_FUND_AMOUNT), false, true);
  await sendCli("fund_traffic3_from_bob", cliBankSendArgs(0, chainId, "bob", traffic3Acc, CLI_FUND_AMOUNT), false, true);

  // 这里直接走 CLI create-validator，把普通节点稳定地抬成验证人。
  await sendCli(
    "create_validator_node1",
    ["tx", "staking", "create-validator", validatorFile, "--from", "node1", ...cliBaseArgs(1, chainId)],
    false,
    true,
  );

  await waitForValidator(node1Valoper);
  log("validator_ready", { validator: node1Valoper });

  const govParams = await queryJson(["query", "gov", "params", "--node", nodePaths(0).tm, "-o", "json"], true);
  const govMinDeposit = BigInt(govParams?.params?.min_deposit?.[0]?.amount ?? "1");
  const staking0 = new Contract(STAKING_ADDRESS, STAKING_ABI, signer0);
  const distribution0 = new Contract(DISTRIBUTION_ADDRESS, DISTRIBUTION_ABI, signer0);
  const distribution1 = new Contract(DISTRIBUTION_ADDRESS, DISTRIBUTION_ABI, signer1);
  const gov0 = new Contract(GOV_ADDRESS, GOV_ABI, signer0);
  const gov1 = new Contract(GOV_ADDRESS, GOV_ABI, signer1);
  const proposals = [];
  let nextProposalId = 1;

  const waitForProposal = async (proposalId) => {
    for (let i = 0; i < 20; i++) {
      const proposal = await queryJson(["query", "gov", "proposal", String(proposalId), "--node", nodePaths(0).tm, "-o", "json"]);
      if (proposal?.proposal) {
        return proposal.proposal;
      }
      await sleep(1000);
    }
    return null;
  };

  const queryProposal = async (proposalId) => queryJson(["query", "gov", "proposal", String(proposalId), "--node", nodePaths(0).tm, "-o", "json"]);

  const submitProposal = async (round) => {
    const outcome = nextProposalId % 2 === 1 ? "pass" : "reject";
    const file = await writeProposalFile(nextProposalId, govMinDeposit.toString(), outcome, govParams.params);
    const submitted = await sendCli(`gov_submit_${nextProposalId}`, cliGovSubmitArgs(0, chainId, "traffic0", file));
    if (!submitted) {
      return;
    }
    const proposalId = nextProposalId;
    const proposal = await waitForProposal(proposalId);
    if (!proposal) {
      log("gov_err", { step: "submit_wait", proposalId });
      return;
    }
    proposals.push({
      id: proposalId,
      outcome,
      deposited: false,
      voted: false,
      status: proposal.status,
      round,
    });
    log("proposal_submitted", { proposalId, outcome, status: proposal.status });
    nextProposalId = proposalId + 1;
  };

  const driveProposal = async (proposal) => {
    const current = await queryProposal(proposal.id);
    const status = current?.proposal?.status;
    if (status && status !== proposal.status) {
      proposal.status = status;
      log("proposal_status", { proposalId: proposal.id, outcome: proposal.outcome, status });
    }
    if (!proposal.deposited) {
      await sendCli(`gov_deposit_${proposal.id}`, cliGovDepositArgs(0, chainId, "traffic1", proposal.id, GOV_EXTRA_DEPOSIT));
      proposal.deposited = true;
    }
    if (!proposal.voted && status === "PROPOSAL_STATUS_VOTING_PERIOD") {
      const option = proposal.outcome === "pass" ? 1 : 4;
      await sendEvm(`gov_vote_node0_${proposal.id}`, () => gov0.vote(wallet0.address, proposal.id, option, "", { gasLimit: GAS_LIMIT }));
      await sendEvm(`gov_vote_node1_${proposal.id}`, () => gov1.vote(wallet1.address, proposal.id, option, "", { gasLimit: GAS_LIMIT }));
      proposal.voted = true;
    }
  };

  let round = 0;
  for (;;) {
    round += 1;

    // 主流量全部选稳定写路径，避免脚本大部分时间都浪费在无意义失败上。
    await sendEvm("staking_delegate_node0_to_node1", () => staking0.delegate(wallet0.address, node1Valoper, STAKE_AMOUNT, { gasLimit: GAS_LIMIT }));
    await sleep(LOOP_DELAY_MS);

    await sendEvm("deposit_validator_rewards_pool_node1", () =>
      distribution1.depositValidatorRewardsPool(wallet1.address, node1Valoper, [{ denom: "atest", amount: DIST_AMOUNT }], { gasLimit: GAS_LIMIT }),
    );
    await sleep(LOOP_DELAY_MS);

    await sendEvm("fund_community_pool_node0", () =>
      distribution0.fundCommunityPool(wallet0.address, [{ denom: "atest", amount: DIST_AMOUNT }], {
        gasLimit: GAS_LIMIT,
      }),
    );
    await sleep(LOOP_DELAY_MS);

    await sendEvm("eth_transfer_node0_to_node1", () =>
      signer0.sendTransaction({
        to: wallet1.address,
        value: EVM_TRANSFER_AMOUNT,
      }),
    );
    await sleep(LOOP_DELAY_MS);

    if (round % 2 === 0) {
      await sendEvm("eth_transfer_node1_to_node0", () =>
        signer1.sendTransaction({
          to: wallet0.address,
          value: EVM_TRANSFER_AMOUNT,
        }),
      );
      await sleep(LOOP_DELAY_MS);
    }

    await sendCli("bank_send_traffic2_to_traffic3", cliBankSendArgs(0, chainId, "traffic2", traffic3Acc, CLI_AMOUNT));
    await sleep(LOOP_DELAY_MS);

    await sendCli("staking_delegate_traffic3_to_node0", cliDelegateArgs(0, chainId, "traffic3", node0Valoper, CLI_AMOUNT));

    if (proposals.length < GOV_PROPOSAL_LIMIT && (round - 1) % GOV_SUBMIT_INTERVAL === 0) {
      await sleep(LOOP_DELAY_MS);
      await submitProposal(round);
    }

    for (const proposal of proposals) {
      await sleep(LOOP_DELAY_MS);
      await driveProposal(proposal);
    }

    // 每 10 轮强行插入 1 次必然失败交易，持续覆盖异常路径但不压过正常流量。
    if (round % 10 === 0) {
      await sleep(LOOP_DELAY_MS);
      await sendCli("expected_fail_bank_send", cliBankSendArgs(0, chainId, "node0", FAIL_RECEIVER, CLI_AMOUNT), true);
    }

    try {
      const [height0, height1] = await Promise.all([provider0.getBlockNumber(), provider1.getBlockNumber()]);
      log("round", { round, height0, height1 });
    } catch (error) {
      log("round", { round, error: error.message });
    }
    await sleep(ROUND_DELAY_MS);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

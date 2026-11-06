// @ts-nocheck
import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";

import initTomlEditor, { edit as editToml, parse as parseToml, stringify as stringifyToml } from "@rainbowatcher/toml-edit-js";
import { HDNodeWallet } from "ethers";

const execFileAsync = util.promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const curDir = path.dirname(__filename);
const projectDir = path.resolve(curDir, "..");
const nodesDir = path.join(curDir, "nodes");
const PASS = "your-password";
const DEFAULT_APP_PORTS = {
  "api.address": 1317,
  "grpc.address": 9090,
  "grpc-web.address": 9191,
  "json-rpc.address": 8545,
  "json-rpc.ws-address": 8546,
  "json-rpc.metrics-address": 6065,
  "evm.geth-metrics-address": 8100,
};
const DEFAULT_TENDERMINT_PORTS = {
  "rpc.laddr": 26657,
  "p2p.laddr": 16656,
  "instrumentation.prometheus_listen_addr": 26660,
};
const HELP_TEXT = `Usage: node dev.ts [options]
  -n, --nohup <bool>         Start scripts use nohup (default: true)
      --init <bool>          Initialize chain data (default: true)
  -c, --compile <bool>       Compile binary before setup (default: false)
  -k, --keep <bool>          Reuse existing nodes directory (default: false)
  -v, --validators <num>     Validator count (default: 1)
      --cn, --commonNode <num> Common node count (default: 0)
  -s, --start <value>        all | no | 0,1,...
      --stop <value>         all | 0,1,...

Config priority:
  1. env.toml
  2. env.toml.example`;
const FLAG_ALIASES = new Map([
  ["n", "nohup"],
  ["nohup", "nohup"],
  ["init", "init"],
  ["c", "compile"],
  ["compile", "compile"],
  ["k", "keep"],
  ["keep", "keep"],
  ["v", "validators"],
  ["validators", "validators"],
  ["cn", "commonNode"],
  ["commonNode", "commonNode"],
  ["s", "start"],
  ["start", "start"],
  ["stop", "stop"],
]);
const FLAG_TYPES = {
  nohup: "boolean",
  init: "boolean",
  compile: "boolean",
  keep: "boolean",
  validators: "number",
  commonNode: "number",
  start: "string",
  stop: "string",
};
const STATUS_WAIT_TIMEOUT_MS = 8000;
const STATUS_POLL_INTERVAL_MS = 500;
const STATUS_READY_HEIGHT = 2;
const DEFAULT_PREMINE_AMOUNT = "10000000000000000000000000";
const GENTX_GAS_LIMIT = 200000n;
const scriptExt = () => "sh";
const daemonName = (config) => `${config.app.chainName}d`;
const nodeDir = (index) => path.join(nodesDir, `node${index}`);
const nodeHome = (config, index) => path.join(nodeDir(index), daemonName(config));
const nodeConfigDir = (config, index) => path.join(nodeHome(config, index), "config");
const nodeLogPath = (config, index) => path.join(nodesDir, `${daemonName(config)}${index}.log`);
const nodePidPath = (config, index) => path.join(nodesDir, `${daemonName(config)}${index}.pid`);
const validatorConfigAt = (config, index) => config.validatorConfigs?.[index] ?? null;
const validatorKeyName = (config, index) => validatorConfigAt(config, index)?.name?.trim() || `node${index}`;
const EVM_PORT_KEYS = new Set(["json-rpc.address", "json-rpc.ws-address", "json-rpc.metrics-address", "evm.geth-metrics-address"]);
const configPaths = (config, index) => {
  const dir = nodeConfigDir(config, index);
  return {
    app: path.join(dir, "app.toml"),
    comet: path.join(dir, "config.toml"),
    client: path.join(dir, "client.toml"),
    genesis: path.join(dir, "genesis.json"),
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statOrNull = (target) => stat(target).catch(() => null);
const exists = async (target) => Boolean(await statOrNull(target));
const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));
const writeJson = async (target, value) => writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
const validateValidatorConfigs = (config, validators) => {
  const names = new Set();
  for (let i = 0; i < validators; i++) {
    const name = validatorKeyName(config, i);
    if (names.has(name)) {
      throw new Error(`duplicate validator key name: ${name}`);
    }
    names.add(name);
  }
};
const resolveKeyring = (config) => config.app.keyring || "test";
const allNodeIndexes = (totalNodes) => Array.from({ length: totalNodes }, (_, i) => i);
const toIndex = (value) => Number(String(value).trim());
const isNodeIndex = (index, totalNodes) => Number.isInteger(index) && index >= 0 && index < totalNodes;
const isNonNegativeIndex = (index) => Number.isInteger(index) && index >= 0;

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const parseArgs = (argv) => {
  const options = {
    nohup: true,
    init: true,
    compile: false,
    keep: false,
    validators: 1,
    commonNode: 0,
    start: "all",
    stop: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (!arg.startsWith("-")) continue;

    const raw = arg.slice(arg.startsWith("--") ? 2 : 1);
    const [rawKey, inlineValue] = raw.split("=", 2);
    const key = FLAG_ALIASES.get(rawKey);
    if (!key) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    const type = FLAG_TYPES[key];
    let value = inlineValue;
    if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
      value = argv[++i];
    }

    if (type === "boolean") {
      options[key] = bool(value, value === undefined ? true : options[key]);
      continue;
    }
    if (type === "number") {
      options[key] = Number(value);
      continue;
    }
    options[key] = value ?? "";
  }

  return options;
};

const runtimeEnv = () => {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  return env;
};

const run = async (command, args, cwd = curDir) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: runtimeEnv(),
    maxBuffer: 1024 * 1024 * 32,
  });
  return { stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "" };
};

const runInput = (command, args, input, cwd = curDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: runtimeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      reject(Object.assign(new Error(`${command} ${args.join(" ")} failed`), { code, stdout, stderr }));
    });
    child.stdin.end(input);
  });

const runPass = (command, args, cwd = curDir) => runInput(command, args, `${PASS}\n`, cwd);
const keyInput = (keyring) => (keyring === "file" ? `${PASS}\n${PASS}\n` : "");
const addKey = (binary, name, home, keyring) => {
  const args = ["keys", "add", name, "--home", home, "--keyring-backend", keyring, "--output", "json"];
  const input = keyInput(keyring);
  return input ? runInput(binary, args, input) : run(binary, args);
};
const recoverKey = (binary, name, mnemonic, home, keyring) =>
  runInput(
    binary,
    ["keys", "add", name, "--recover", "--home", home, "--keyring-backend", keyring, "--output", "json"],
    `${mnemonic}\n${keyInput(keyring)}`,
  );
const keyAddress = async (binary, name, home, keyring, bech) => {
  const args = ["keys", "show", name];
  if (bech) {
    args.push("--bech", bech);
  }
  args.push("-a", "--home", home, "--keyring-backend", keyring);
  return (await run(binary, args)).stdout.split(/\s+/).pop();
};

const parseStatusHeights = (stdout) =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.match(/height=(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number);

const flatten = (obj, prefix = "", out = {}) => {
  for (const [key, value] of Object.entries(obj || {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else {
      out[next] = value;
    }
  }
  return out;
};

const omitKeys = (value, keys) => {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (!keys.includes(key)) {
      out[key] = entry;
    }
  }
  return out;
};

const setNested = (obj, keyPath, value) => {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] ||= {};
    current = current[parts[i]];
  }
  current[parts.at(-1)] = value;
};

const getNested = (obj, keyPath) => keyPath.split(".").reduce((current, key) => current?.[key], obj);
const normalizeSeg = (value) => value.replace(/[-_]/g, "");

const resolveTomlPath = (doc, keyPath) => {
  let current = doc;
  return keyPath
    .split(".")
    .map((seg) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return seg;
      }
      const keys = Object.keys(current);
      const hit = keys.find((key) => key === seg) ?? keys.find((key) => normalizeSeg(key) === normalizeSeg(seg)) ?? seg;
      current = current[hit];
      return hit;
    })
    .join(".");
};

const rootAssignment = (key, value) => stringifyToml({ [key]: value }, { finalNewline: false }).split(/\r?\n/)[0];

const setRootToml = (input, key, value) => {
  const assignment = rootAssignment(key, value);
  const valuePart = assignment.slice(assignment.indexOf("=") + 1).trim();
  const lines = input.split(/\r?\n/);
  const pattern = new RegExp(`^(\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*)([^#\\r\\n]*?)(\\s*(?:#.*)?)$`);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (match) {
      return [...lines.slice(0, i), `${match[1]}${valuePart}${match[3] ?? ""}`, ...lines.slice(i + 1)].join("\n");
    }
  }

  const at = lines.findIndex((line) => line.startsWith("["));
  if (at === -1) {
    return `${input}${input.endsWith("\n") || !input ? "" : "\n"}${assignment}\n`;
  }

  lines.splice(at, 0, assignment);
  return lines.join("\n");
};

const setToml = (input, keyPath, value) =>
  keyPath.includes(".") ? editToml(input, keyPath, value, { finalNewline: input.endsWith("\n") }) : setRootToml(input, keyPath, value);

const normalizeConfigValue = (value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
};

const applyTomlMap = (input, map) => {
  let output = input;
  const doc = parseToml(input);
  for (const [key, rawValue] of Object.entries(map || {})) {
    const value = normalizeConfigValue(rawValue);
    const resolved = resolveTomlPath(doc, key);
    output = setToml(output, resolved, value);
    setNested(doc, resolved, value);
  }
  return output;
};

const normalizeAddrPort = (value, port) => {
  const nextPort = String(port);
  if (typeof value === "number") {
    return Number(nextPort);
  }

  const raw = String(value ?? "");
  if (raw.startsWith("tcp://")) {
    const rest = raw.slice(6);
    const index = rest.lastIndexOf(":");
    if (index !== -1) {
      let host = rest.slice(0, index);
      if (!host || host === "127.0.0.1" || host === "localhost") {
        host = "0.0.0.0";
      }
      return `tcp://${host}:${nextPort}`;
    }
  }

  const index = raw.lastIndexOf(":");
  if (index !== -1) {
    let host = raw.slice(0, index);
    if (!host || host === "127.0.0.1" || host === "localhost") {
      host = "0.0.0.0";
    }
    return `${host}:${nextPort}`;
  }

  return raw;
};

const buildPortMap = (input, ports, index) => {
  const doc = parseToml(input);
  const map = {};
  for (const key of Object.keys(ports)) {
    map[key] = normalizeAddrPort(getNested(doc, key), Number(ports[key]) + (EVM_PORT_KEYS.has(key) ? index * 10 : index));
  }
  return map;
};

const normalizePortSection = (value, defaults) => {
  const flat = flatten(value || {});
  const out = { ...defaults };
  for (const [key, raw] of Object.entries(flat)) {
    const numeric = Number(raw);
    if (!Number.isNaN(numeric)) {
      out[key] = numeric;
    }
  }
  return out;
};

const normalizeConfigSection = (value, metaKeys = []) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return flatten(omitKeys(value, metaKeys));
};

const normalizeDeployConfig = (raw) => {
  const rootKeys = ["pre-mine-accounts", "private-keys", "pre-mine-per-account", "genesis-cfg"];
  for (const [index, validator] of (raw.validators ?? []).entries()) {
    for (const key of rootKeys) {
      if (Object.hasOwn(validator, key)) {
        throw new Error(`validators[${index}].${key} must be a top-level TOML key; move [[validators]] after the root configuration`);
      }
    }
  }
  const rawApp = raw.app ?? {};
  const rawTendermint = raw.tendermint ?? raw.cometbft ?? {};

  const appMetaKeys = ["prefix", "chain-name", "chainName", "chain_name", "chain-id", "chainId", "chain_id", "denoms", "keyring", "port", "cfg"];
  const tendermintMetaKeys = ["port", "cfg"];
  const appPortSource = raw["app-port"] ?? raw.appPort ?? rawApp.port;
  const tendermintPortSource = raw["tendermint-port"] ?? raw.tendermintPort ?? rawTendermint.port;
  const appCfgSource = raw.appCfg ?? raw["app-cfg"] ?? rawApp.cfg ?? rawApp;
  const tendermintCfgSource = raw.tendermintCfg ?? raw["tendermint-cfg"] ?? rawTendermint.cfg ?? rawTendermint;

  return {
    app: {
      prefix: raw.prefix ?? rawApp.prefix ?? "cosmos",
      chainName: raw["chain-name"] ?? raw.chainName ?? raw.chain_name ?? rawApp["chain-name"] ?? rawApp.chainName ?? rawApp.chain_name ?? "evm",
      chainId: raw["chain-id"] ?? raw.chainId ?? raw.chain_id ?? rawApp["chain-id"] ?? rawApp.chainId ?? rawApp.chain_id ?? "9001",
      denoms: raw.denoms ?? rawApp.denoms ?? ["atest"],
      keyring: raw.keyring ?? rawApp.keyring ?? "test",
      port: normalizePortSection(appPortSource, DEFAULT_APP_PORTS),
      cfg: normalizeConfigSection(appCfgSource, appMetaKeys),
    },
    tendermint: {
      port: normalizePortSection(tendermintPortSource, DEFAULT_TENDERMINT_PORTS),
      cfg: normalizeConfigSection(tendermintCfgSource, tendermintMetaKeys),
    },
    validatorConfigs: raw.validators ?? raw.validatorConfigs ?? [],
    preMineAccounts: raw["pre-mine-accounts"] ?? raw.preMineAccounts ?? [],
    privateKeys: raw["private-keys"] ?? raw.privateKeys ?? [],
    preMinePerAccount: raw["pre-mine-per-account"] ?? raw.preMinePerAccount ?? DEFAULT_PREMINE_AMOUNT,
    genesisCfg: raw["genesis-cfg"] ?? raw.genesisCfg ?? [],
  };
};

const loadConfig = async () => {
  const envPath = path.join(curDir, "env.toml");
  const envExamplePath = path.join(curDir, "env.toml.example");

  if (await exists(envPath)) {
    return normalizeDeployConfig(parseToml(await readFile(envPath, "utf8")));
  }

  if (await exists(envExamplePath)) {
    await copyFile(envExamplePath, envPath);
    return normalizeDeployConfig(parseToml(await readFile(envPath, "utf8")));
  }

  throw new Error("Missing config. Expected deploy/env.toml.");
};

const ensureBinary = async (daemon, shouldCompile) => {
  const localBinary = path.join(curDir, daemon);
  const builtBinary = path.join(projectDir, "build", daemon);
  const localStat = await statOrNull(localBinary);
  const builtStat = await statOrNull(builtBinary);
  const shouldRefreshLocal = !localStat || (builtStat && builtStat.mtimeMs > localStat.mtimeMs);

  if (shouldCompile || shouldRefreshLocal) {
    if (shouldCompile || !builtStat) {
      await execFileAsync("make", ["build"], {
        cwd: projectDir,
        env: runtimeEnv(),
        maxBuffer: 1024 * 1024 * 32,
      });
    }
    await copyFile(builtBinary, localBinary);
    await chmod(localBinary, 0o755);
  }

  return localBinary;
};

const toBech32 = async (binary, value) => {
  if (!value) {
    throw new Error("Empty address");
  }
  if (/^[a-z]+1/.test(value)) {
    return value;
  }
  if (/^0x/i.test(value)) {
    return (await run(binary, ["query", "evm", "0x-to-bech32", value])).stdout.split(/\s+/).pop();
  }

  return value;
};

const ceilFeeAmount = (price, gasLimit) => {
  const normalized = String(price ?? "0").trim();
  if (!normalized) {
    return 0n;
  }

  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal amount: ${normalized}`);
  }

  const [, whole, fraction = ""] = match;
  const numerator = BigInt(`${whole}${fraction}` || "0");
  const denominator = 10n ** BigInt(fraction.length);
  return (numerator * gasLimit + denominator - 1n) / denominator;
};

const gentxFee = (genesis, denom) => {
  const minGasPrice = genesis.app_state?.feemarket?.params?.min_gas_price;
  const amount = ceilFeeAmount(minGasPrice, GENTX_GAS_LIMIT);
  return amount > 0n ? `${amount}${denom}` : "";
};

const replaceExact = (value, from, to) => {
  if (Array.isArray(value)) {
    return value.map((item) => replaceExact(item, from, to));
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = replaceExact(value[key], from, to);
    }
    return value;
  }
  return value === from ? to : value;
};

const ensureAccount = (genesis, address) => {
  genesis.app_state.auth ||= {};
  genesis.app_state.auth.accounts ||= [];
  if (!genesis.app_state.auth.accounts.some((item) => item.address === address)) {
    genesis.app_state.auth.accounts.push({
      "@type": "/cosmos.auth.v1beta1.BaseAccount",
      address,
      pub_key: null,
      account_number: "0",
      sequence: "0",
    });
  }
};

const upsertBalance = (genesis, address, coins) => {
  genesis.app_state.bank ||= {};
  genesis.app_state.bank.balances ||= [];
  const existing = genesis.app_state.bank.balances.find((item) => item.address === address);
  if (existing) {
    existing.coins = coins;
    return;
  }
  genesis.app_state.bank.balances.push({ address, coins });
};

const addGenesisAccount = (genesis, address, denoms, amount) => {
  ensureAccount(genesis, address);
  const coins = denoms.map((denom) => ({ denom, amount: String(amount[denom] ?? "0") }));
  upsertBalance(genesis, address, coins);
};

const ensureMetadata = (bank, denoms) => {
  bank.denom_metadata ||= [];
  for (const denom of denoms) {
    if (bank.denom_metadata.some((item) => item.base === denom)) {
      continue;
    }
    const display = denom.startsWith("a") && denom.length > 1 ? denom.slice(1) : denom;
    bank.denom_metadata.push({
      description: `The native token for ${display}.`,
      denom_units: [
        { denom, exponent: 0, aliases: display !== denom ? [`atto${display}`] : [] },
        { denom: display, exponent: 18, aliases: [] },
      ],
      base: denom,
      display,
      name: display.toUpperCase(),
      symbol: display.toUpperCase(),
      uri: "",
      uri_hash: "",
    });
  }
};

const normalizeBalanceCoins = (bank) => {
  for (const balance of bank.balances ?? []) {
    const totals = new Map();
    for (const coin of balance.coins ?? []) {
      totals.set(coin.denom, (totals.get(coin.denom) ?? 0n) + BigInt(coin.amount ?? "0"));
    }
    balance.coins = [...totals.entries()].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
  }
};

const amountByDenoms = (denoms, amount) => Object.fromEntries(denoms.map((denom) => [denom, amount]));

const getKeySeedPath = (config, index) => path.join(nodeHome(config, index), "key_seed.json");

const hydrateNodeSeed = async (config, index) => {
  const keySeedPath = getKeySeedPath(config, index);
  const keySeed = await readJson(keySeedPath);
  const wallet = HDNodeWallet.fromPhrase(keySeed.secret);
  const next = {
    ...keySeed,
    privateKey: wallet.privateKey.replace("0x", ""),
    publicKey: wallet.publicKey.replace("0x", ""),
    address: wallet.address,
    bip39Address: await toBech32(path.join(curDir, daemonName(config)), wallet.address),
  };
  await writeJson(keySeedPath, next);
  return next;
};

const hydrateNodeSeeds = async (config, totalNodes) => {
  const seeds = [];
  for (let i = 0; i < totalNodes; i++) {
    seeds.push(await hydrateNodeSeed(config, i));
  }
  return seeds;
};

const resolvePreMineEntries = async (config) => {
  const defaultAmount = config.preMinePerAccount || DEFAULT_PREMINE_AMOUNT;
  const entries = [];
  const seen = new Set();

  for (const raw of config.preMineAccounts ?? []) {
    const source =
      typeof raw === "string" ? { address: raw, amount: defaultAmount } : { address: raw?.address ?? raw?.key, amount: raw?.amount ?? defaultAmount };
    if (!source.address) {
      continue;
    }
    const address = await toBech32(path.join(curDir, daemonName(config)), source.address);
    const dedupeKey = address.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    entries.push({ address, amount: source.amount });
  }

  return entries;
};

const applyGenesisCfg = (genesis, cfgEntries) => {
  for (const cfg of cfgEntries ?? []) {
    Function("genesis", `genesis.${cfg}`)(genesis);
  }
};

const durationToSeconds = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) {
    return null;
  }
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
};

const normalizeGovVotingPeriods = (genesis) => {
  const params = genesis.app_state?.gov?.params;
  if (!params?.voting_period) {
    return;
  }

  const votingSeconds = durationToSeconds(params.voting_period);
  const expeditedSeconds = durationToSeconds(params.expedited_voting_period);
  if (!votingSeconds) {
    return;
  }
  if (expeditedSeconds !== null && expeditedSeconds < votingSeconds) {
    return;
  }

  params.expedited_voting_period = `${Math.max(votingSeconds - 1, 1)}s`;
};

const recalcSupply = (bank) => {
  const totals = new Map();
  for (const balance of bank.balances ?? [])
    for (const coin of balance.coins ?? []) totals.set(coin.denom, (totals.get(coin.denom) ?? 0n) + BigInt(coin.amount ?? "0"));
  bank.supply = [...totals.entries()].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
};

const initNodeHome = async (binary, config, index) => {
  const home = nodeHome(config, index);
  await run(
    binary,
    ["init", `node${index}`, "--overwrite", "--chain-id", config.app.chainId, "--home", home, "--default-denom", config.app.denoms[0] ?? "atest"],
    projectDir,
  );
  return home;
};

const writeKeySeed = async (config, index, payload, secret = payload.mnemonic) => {
  await writeJson(getKeySeedPath(config, index), {
    name: validatorKeyName(config, index),
    type: payload.type,
    address: payload.address,
    pubkey: payload.pubkey,
    mnemonic: secret,
    secret,
  });
};

const initNodes = async (binary, config, options) => {
  const totalNodes = options.validators + options.commonNode;
  const keyring = resolveKeyring(config);
  for (let i = 0; i < totalNodes; i++) {
    const home = await initNodeHome(binary, config, i);
    const keyName = validatorKeyName(config, i);
    const mnemonic = validatorConfigAt(config, i)?.mnemonic?.trim();
    const output = mnemonic ? await recoverKey(binary, keyName, mnemonic, home, keyring) : await addKey(binary, keyName, home, keyring);
    await writeKeySeed(config, i, JSON.parse(output.stdout), mnemonic);
  }

  const sourceGenesisPath = configPaths(config, 0).genesis;
  for (let i = 1; i < totalNodes; i++) {
    await copyFile(sourceGenesisPath, configPaths(config, i).genesis);
  }

  await hydrateNodeSeeds(config, totalNodes);
};

const rebuildGentxs = async (binary, config, options) => {
  if (options.validators < 1) {
    return;
  }

  const totalNodes = options.validators + options.commonNode;
  const keyring = resolveKeyring(config);
  const stakeDenom = config.app.denoms[0] ?? "atest";
  const p2pPort = Number(config.tendermint.port["p2p.laddr"]);
  const gentxs = [];
  const gentxDir = path.join(nodesDir, "gentxs");

  await rm(gentxDir, { recursive: true, force: true });
  await mkdir(gentxDir, { recursive: true });

  for (let i = 0; i < options.validators; i++) {
    const home = nodeHome(config, i);
    const outputDocument = path.join(gentxDir, `node${i}.json`);
    const genesis = await readJson(configPaths(config, i).genesis);
    const fees = gentxFee(genesis, config.app.denoms[0] ?? "atest");
    const nodeId = (await run(binary, ["comet", "show-node-id", "--home", home])).stdout.split(/\s+/).pop();
    const pubkey = (await run(binary, ["comet", "show-validator", "--home", home])).stdout.trim();
    const args = [
      "genesis",
      "gentx",
      validatorKeyName(config, i),
      `100000000000000000000${stakeDenom}`,
      "--home",
      home,
      "--chain-id",
      config.app.chainId,
      "--keyring-backend",
      keyring,
      "--output-document",
      outputDocument,
      "--moniker",
      `node${i}`,
      "--node-id",
      nodeId,
      "--pubkey",
      pubkey,
      "--ip",
      "127.0.0.1",
      "--p2p-port",
      String(p2pPort + i),
    ];
    if (fees) {
      args.push("--gas", GENTX_GAS_LIMIT.toString(), "--fees", fees);
    }

    await run(binary, args);
    gentxs.push(await readJson(outputDocument));
  }

  for (let i = 0; i < totalNodes; i++) {
    const genesisPath = configPaths(config, i).genesis;
    const genesis = await readJson(genesisPath);
    genesis.app_state.genutil ||= {};
    genesis.app_state.genutil.gen_txs = gentxs;
    await writeJson(genesisPath, genesis);
  }
};

const applyGenesis = async (binary, config, options) => {
  const totalNodes = options.validators + options.commonNode;
  const keyring = resolveKeyring(config);
  const denoms = config.app.denoms ?? ["atest"];
  const defaultAmount = config.preMinePerAccount || DEFAULT_PREMINE_AMOUNT;
  const preMineEntries = await resolvePreMineEntries(config);
  const nodeEntries = [];
  for (let i = 0; i < totalNodes; i++) {
    nodeEntries.push({
      address: await keyAddress(binary, validatorKeyName(config, i), nodeHome(config, i), keyring),
      amount: defaultAmount,
    });
  }

  for (let i = 0; i < totalNodes; i++) {
    const genesisPath = configPaths(config, i).genesis;
    const genesis = await readJson(genesisPath);

    replaceExact(genesis, "stake", config.app.denoms[0] ?? "atest");
    if (genesis.app_state?.staking?.params) {
      genesis.app_state.staking.params.bond_denom = config.app.denoms[0] ?? "atest";
    }
    genesis.app_state.auth ||= {};
    genesis.app_state.bank ||= {};
    genesis.app_state.auth.accounts ||= [];
    genesis.app_state.bank.balances ||= [];
    ensureMetadata(genesis.app_state.bank, denoms);
    normalizeBalanceCoins(genesis.app_state.bank);

    for (const entry of preMineEntries) {
      addGenesisAccount(genesis, entry.address, denoms, amountByDenoms(denoms, entry.amount));
    }

    for (const entry of nodeEntries) {
      addGenesisAccount(genesis, entry.address, denoms, amountByDenoms(denoms, entry.amount));
    }

    applyGenesisCfg(genesis, config.genesisCfg);
    normalizeGovVotingPeriods(genesis);
    recalcSupply(genesis.app_state.bank);
    await writeJson(genesisPath, genesis);
  }

  await rebuildGentxs(binary, config, options);
  await run(binary, ["genesis", "validate", "--home", nodeHome(config, 0)]);
};

const getNodeIds = async (binary, config, totalNodes) => {
  const ids = [];
  for (let i = 0; i < totalNodes; i++) {
    ids.push((await run(binary, ["comet", "show-node-id", "--home", nodeHome(config, i)])).stdout.split(/\s+/).pop());
  }
  return ids;
};

const updateConfigs = async (binary, config, totalNodes) => {
  const nodeIds = await getNodeIds(binary, config, totalNodes);
  const p2pPort = Number(config.tendermint.port["p2p.laddr"]);
  const rpcPort = Number(config.tendermint.port["rpc.laddr"]);

  for (let i = 0; i < totalNodes; i++) {
    const { app: appPath, comet: cometPath, client: clientPath } = configPaths(config, i);

    const appToml = await readFile(appPath, "utf8");
    const appOverrides = {
      ...buildPortMap(appToml, config.app.port, i),
      ...(config.app.cfg || {}),
    };
    await writeFile(appPath, applyTomlMap(appToml, appOverrides));

    const peers = [];
    for (let j = 0; j < totalNodes; j++) {
      if (i !== j) {
        peers.push(`${nodeIds[j]}@127.0.0.1:${p2pPort + j}`);
      }
    }
    const cometToml = await readFile(cometPath, "utf8");
    const cometOverrides = {
      ...buildPortMap(cometToml, config.tendermint.port, i),
      ...(config.tendermint.cfg || {}),
      "p2p.persistent_peers": peers.join(","),
    };
    await writeFile(cometPath, applyTomlMap(cometToml, cometOverrides));

    const clientToml = await readFile(clientPath, "utf8");
    const clientOverrides = {
      "chain-id": config.app.chainId,
      "keyring-backend": resolveKeyring(config),
      output: "text",
      node: `tcp://localhost:${rpcPort + i}`,
      "broadcast-mode": "sync",
    };
    await writeFile(clientPath, applyTomlMap(clientToml, clientOverrides));
  }
};

const importPrivateKeys = async (binary, config) => {
  if (!Array.isArray(config.privateKeys) || config.privateKeys.length === 0) {
    return;
  }

  const home = nodeHome(config, 0);
  for (const entry of config.privateKeys) {
    if (!entry?.name || !entry?.key) {
      continue;
    }
    try {
      await runPass(binary, [
        "keys",
        "unsafe-import-eth-key",
        entry.name,
        entry.key.replace(/^0x/i, ""),
        "--home",
        home,
        "--keyring-backend",
        resolveKeyring(config),
      ]);
    } catch (error) {
      const message = String(error?.stderr || error?.message || "");
      if (!message.includes("cannot overwrite key")) {
        throw error;
      }
    }
  }
};

const nodeStartArgs = (config, index) => [
  "start",
  "--keyring-backend",
  resolveKeyring(config),
  "--api.enabled-unsafe-cors",
  "--json-rpc.enable-indexer=true",
  "--home",
  `./node${index}/${daemonName(config)}`,
];

const launchDetachedNode = async (config, index) => {
  const daemon = daemonName(config);
  const logPath = nodeLogPath(config, index);
  const pidPath = nodePidPath(config, index);
  const outFd = openSync(logPath, "a");
  const errFd = openSync(logPath, "a");
  const child = spawn(path.join(nodesDir, daemon), nodeStartArgs(config, index), {
    cwd: nodesDir,
    env: runtimeEnv(),
    detached: true,
    stdio: ["ignore", outFd, errFd],
  });
  closeSync(outFd);
  closeSync(errFd);

  await writeFile(pidPath, `${child.pid}\n`);
  child.unref();
};

const detachedStartScriptBody = (envPrefix, daemon, command, logFile, pidFile) => `if command -v setsid >/dev/null 2>&1; then
  setsid ${envPrefix}./${daemon} ${command} < /dev/null >>${logFile} 2>&1 &
else
  nohup ${envPrefix}./${daemon} ${command} < /dev/null >>${logFile} 2>&1 &
fi
echo $! > ${pidFile}
`;

const writeScripts = async (config, totalNodes, isNohup) => {
  const daemon = daemonName(config);
  const baseP2P = Number(config.tendermint.port["p2p.laddr"]);
  const baseRpc = Number(config.tendermint.port["rpc.laddr"]);
  let startAll = "#!/bin/bash\n";
  let stopAll = "#!/bin/bash\n";
  let statusScript = "#!/bin/bash\nset -e\n";

  for (let i = 0; i < totalNodes; i++) {
    const command = nodeStartArgs(config, i).join(" ");
    const logFile = `./${daemon}${i}.log`;
    const pidFile = `./${daemon}${i}.pid`;
    const envPrefix = 'env -i PATH="$PATH" HOME="$HOME" ';
    const startScript = `#!/bin/bash\n${
      isNohup ? detachedStartScriptBody(envPrefix, daemon, command, logFile, pidFile) : `${envPrefix}./${daemon} ${command}\n`
    }`;
    const stopScript = `#!/bin/bash\npid=\`lsof -iTCP:${baseP2P + i} -sTCP:LISTEN -t\`\nif [[ -n $pid ]]; then kill -15 $pid; fi\nrm -f ${pidFile}\n`;
    const startPath = path.join(nodesDir, `start${i}.${scriptExt()}`);
    const stopPath = path.join(nodesDir, `stop${i}.${scriptExt()}`);

    await writeFile(startPath, startScript);
    await writeFile(stopPath, stopScript);
    await chmod(startPath, 0o755);
    await chmod(stopPath, 0o755);

    startAll += `./start${i}.sh\n`;
    stopAll += `./stop${i}.sh\n`;
    statusScript += `height=$(./${daemon} status --node tcp://127.0.0.1:${baseRpc + i} --output json | sed -n 's/.*"latest_block_height":"\\([0-9]*\\)".*/\\1/p')\necho "node${i}: height=\${height}"\n`;
  }

  if (isNohup) {
    startAll += "sleep 3\n./status.sh\n";
  }

  const startAllPath = path.join(nodesDir, `startAll.${scriptExt()}`);
  const stopAllPath = path.join(nodesDir, `stopAll.${scriptExt()}`);
  const statusPath = path.join(nodesDir, `status.${scriptExt()}`);
  await writeFile(startAllPath, startAll);
  await writeFile(stopAllPath, stopAll);
  await writeFile(statusPath, statusScript);
  await chmod(startAllPath, 0o755);
  await chmod(stopAllPath, 0o755);
  await chmod(statusPath, 0o755);
};

const parseSelection = (value, totalNodes) =>
  value === "all"
    ? allNodeIndexes(totalNodes)
    : value
        .split(",")
        .map(toIndex)
        .filter((index) => isNodeIndex(index, totalNodes));

const copyBinaryToNodes = async (binary, config) => {
  const target = path.join(nodesDir, daemonName(config));
  await copyFile(binary, target);
  await chmod(target, 0o755);
};

const stopNodes = async (value) => {
  if (!value) {
    return;
  }
  if (value === "all") {
    const script = path.join(nodesDir, `stopAll.${scriptExt()}`);
    if (await exists(script)) {
      await run(script, [], nodesDir);
    }
    return;
  }

  for (const index of value.split(",").map(toIndex).filter(isNonNegativeIndex)) {
    const script = path.join(nodesDir, `stop${index}.${scriptExt()}`);
    if (await exists(script)) {
      await run(script, [], nodesDir);
    }
  }
};

const waitForStatusReady = async () => {
  const statusScript = path.join(nodesDir, `status.${scriptExt()}`);
  if (!(await exists(statusScript))) {
    return;
  }

  const deadline = Date.now() + STATUS_WAIT_TIMEOUT_MS;
  let lastStdout = "";
  while (Date.now() < deadline) {
    try {
      const { stdout } = await run(statusScript, [], nodesDir);
      if (stdout) {
        lastStdout = stdout;
        console.log(stdout);
        if (parseStatusHeights(stdout).some((height) => height >= STATUS_READY_HEIGHT)) {
          return;
        }
      }
    } catch {}
    await sleep(STATUS_POLL_INTERVAL_MS);
  }

  if (lastStdout) {
    console.log(lastStdout);
  }
};

const startNodes = async (value, totalNodes, config, useDetachedStart) => {
  if (!value || value.toLowerCase() === "no") {
    return;
  }

  if (useDetachedStart) {
    for (const index of parseSelection(value, totalNodes)) {
      await launchDetachedNode(config, index);
    }
    await waitForStatusReady();
    return;
  }

  if (value === "all") {
    await run(path.join(nodesDir, `startAll.${scriptExt()}`), [], nodesDir);
    return;
  }

  for (const index of parseSelection(value, totalNodes)) {
    await run(path.join(nodesDir, `start${index}.${scriptExt()}`), [], nodesDir);
  }
};

const refreshKeptNetwork = async (binary, config) => {
  if (!(await exists(nodesDir))) {
    throw new Error("nodes directory not found");
  }
  const startAllPath = path.join(nodesDir, `startAll.${scriptExt()}`);
  if (!(await exists(startAllPath))) {
    throw new Error("startAll script not found");
  }
  await copyBinaryToNodes(binary, config);
};

const initNetwork = async (binary, config, options) => {
  const totalNodes = options.validators + options.commonNode;
  if (options.validators < 1) {
    throw new Error("validators must be >= 1");
  }
  validateValidatorConfigs(config, options.validators);

  await rm(nodesDir, { recursive: true, force: true });
  await mkdir(nodesDir, { recursive: true });

  console.log(`Initializing ${totalNodes} local nodes...`);
  await initNodes(binary, config, options);
  await applyGenesis(binary, config, options);
  await updateConfigs(binary, config, totalNodes);
  await importPrivateKeys(binary, config);
  await writeScripts(config, totalNodes, options.nohup);
  await copyBinaryToNodes(binary, config);
};

const main = async () => {
  if (process.platform === "win32") {
    throw new Error("deploy/dev.ts does not support Windows");
  }

  const options = parseArgs(process.argv.slice(2));
  await initTomlEditor();
  const config = await loadConfig();
  const totalNodes = options.validators + options.commonNode;

  console.log(
    `validators:${options.validators}, commonNode:${options.commonNode}, init:${options.init}, compile:${options.compile}, start:${options.start}, stop:${options.stop}, keep:${options.keep}, nohup:${options.nohup}\n`,
  );

  if (options.stop) {
    await stopNodes(options.stop);
    return;
  }

  const stopAllPath = path.join(nodesDir, `stopAll.${scriptExt()}`);
  if (await exists(stopAllPath)) {
    try {
      await stopNodes("all");
      await sleep(300);
    } catch {}
  }

  const daemon = daemonName(config);
  const binary = await ensureBinary(daemon, options.compile || options.keep);

  if (options.keep) {
    await refreshKeptNetwork(binary, config);
    await startNodes(options.start, totalNodes, config, options.nohup);
    return;
  }

  if (options.init) {
    await initNetwork(binary, config, options);
  }

  await startNodes(options.start, totalNodes, config, options.nohup);
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

// @ts-nocheck
import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";
import initTomlEditor, { edit as editToml, parse as parseToml, stringify as stringifyToml } from "@rainbowatcher/toml-edit-js";

const execFileAsync = util.promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const curDir = path.dirname(__filename);
const projectDir = path.resolve(curDir, "..");
const nodesDir = path.join(curDir, "nodes");
const PASS = "your-password";
const RUNTIME_KEYRING = "file";
const APP_PORTS = {
  "api.address": 1317,
  "grpc.address": 9090,
  "grpc-web.address": 9191,
  "json-rpc.address": 8545,
  "json-rpc.ws-address": 8546,
  "json-rpc.metrics-address": 6065,
  "evm.geth-metrics-address": 8100,
};
const COMET_PORTS = {
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
      --stop <value>         all | 0,1,...`;
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
const EVM_PORT_KEYS = new Set(["json-rpc.address", "json-rpc.ws-address", "json-rpc.metrics-address", "evm.geth-metrics-address"]);
const GENTX_GAS_LIMIT = 200000n;
const STATUS_WAIT_TIMEOUT_MS = 8000;
const STATUS_POLL_INTERVAL_MS = 500;
const STATUS_READY_HEIGHT = 2;
const scriptExt = () => "sh";
const daemonName = (config) => `${config.app.chainName}d`;
const nodeDir = (index) => path.join(nodesDir, `node${index}`);
const nodeHome = (config, index) => path.join(nodeDir(index), daemonName(config));
const nodeConfigDir = (config, index) => path.join(nodeHome(config, index), "config");
const nodeLogPath = (config, index) => path.join(nodesDir, `${daemonName(config)}${index}.log`);
const nodePidPath = (config, index) => path.join(nodesDir, `${daemonName(config)}${index}.pid`);
const validatorConfigAt = (config, index) => config.validatorConfigs?.[index] ?? null;
const validatorKeyName = (config, index) => validatorConfigAt(config, index)?.name?.trim() || `node${index}`;
const configPaths = (config, index) => {
  const dir = nodeConfigDir(config, index);
  return {
    app: path.join(dir, "app.toml"),
    comet: path.join(dir, "config.toml"),
    client: path.join(dir, "client.toml"),
    genesis: path.join(dir, "genesis.json"),
  };
};
const resolveKeyring = (config) => config.app.keyring || "test";
const allNodeIndexes = (totalNodes) => Array.from({ length: totalNodes }, (_, i) => i);
const toIndex = (value) => Number(value.trim());
const isNodeIndex = (index, totalNodes) => Number.isInteger(index) && index >= 0 && index < totalNodes;
const isNonNegativeIndex = (index) => Number.isInteger(index) && index >= 0;
const statOrNull = (target) => stat(target).catch(() => null);
const selectedNodeIndexes = (value, totalNodes) =>
  value
    .split(",")
    .map(toIndex)
    .filter((i) => isNodeIndex(i, totalNodes));
const parsedIndexes = (value) => value.split(",").map(toIndex).filter(isNonNegativeIndex);

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const v = String(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
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
    if (!key) throw new Error(`Unknown flag: ${arg}`);
    const type = FLAG_TYPES[key];
    let value = inlineValue;
    if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("-")) value = argv[++i];

    if (type === "boolean") {
      options[key] = bool(value, value === undefined ? true : options[key]);
      continue;
    }
    if (type === "number") {
      options[key] = Number(value);
      continue;
    }
    if (type === "string") options[key] = value ?? "";
  }
  return options;
};

const exists = async (target) => Boolean(await statOrNull(target));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));
const writeJson = async (target, value) => writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
const copyIfMissing = async (from, to) => !(await exists(to)) && copyFile(from, to);
const validateValidatorConfigs = (config, validators) => {
  const names = new Set();
  for (let i = 0; i < validators; i++) {
    const name = validatorKeyName(config, i);
    if (names.has(name)) throw new Error(`duplicate validator key name: ${name}`);
    names.add(name);
  }
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
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, next, out);
    else out[next] = value;
  }
  return out;
};
const setNested = (obj, keyPath, value) => {
  const parts = keyPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] ||= {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
};
const getNested = (obj, keyPath) => keyPath.split(".").reduce((cur, key) => cur?.[key], obj);
const normalizeSeg = (value) => value.replace(/[-_]/g, "");
const resolveTomlPath = (doc, keyPath) => {
  let cur = doc;
  return keyPath
    .split(".")
    .map((seg) => {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) return seg;
      const keys = Object.keys(cur);
      const hit = keys.find((key) => key === seg) ?? keys.find((key) => normalizeSeg(key) === normalizeSeg(seg)) ?? seg;
      cur = cur[hit];
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
    if (match) return [...lines.slice(0, i), `${match[1]}${valuePart}${match[3] ?? ""}`, ...lines.slice(i + 1)].join("\n");
  }
  const at = lines.findIndex((line) => line.startsWith("["));
  if (at === -1) return `${input}${input.endsWith("\n") || !input ? "" : "\n"}${assignment}\n`;
  lines.splice(at, 0, assignment);
  return lines.join("\n");
};
const setToml = (input, keyPath, value) =>
  keyPath.includes(".") ? editToml(input, keyPath, value, { finalNewline: input.endsWith("\n") }) : setRootToml(input, keyPath, value);
const applyTomlMap = (input, map) => {
  let output = input;
  const doc = parseToml(input);
  for (const [key, value] of Object.entries(map || {})) {
    const resolved = resolveTomlPath(doc, key);
    output = setToml(output, resolved, value);
    setNested(doc, resolved, value);
  }
  return output;
};
const normalizeAddrPort = (value, port) => {
  const nextPort = String(port);
  if (typeof value === "number") return Number(nextPort);
  const raw = String(value ?? "");
  if (raw.startsWith("tcp://")) {
    const rest = raw.slice(6);
    const idx = rest.lastIndexOf(":");
    if (idx !== -1) {
      let host = rest.slice(0, idx);
      if (!host || host === "127.0.0.1" || host === "localhost") host = "0.0.0.0";
      return `tcp://${host}:${nextPort}`;
    }
  }
  const idx = raw.lastIndexOf(":");
  if (idx !== -1) {
    let host = raw.slice(0, idx);
    if (!host || host === "127.0.0.1" || host === "localhost") host = "0.0.0.0";
    return `${host}:${nextPort}`;
  }
  return raw;
};
const buildPortMap = (input, ports, index) => {
  const doc = parseToml(input);
  const map = {};
  for (const key of Object.keys(ports)) {
    const offset = EVM_PORT_KEYS.has(key) ? index * 10 : index;
    map[key] = normalizeAddrPort(getNested(doc, key), Number(ports[key]) + offset);
  }
  return map;
};

const loadConfig = async () => {
  const envPath = path.join(curDir, "env.toml");
  await copyIfMissing(path.join(curDir, "env.toml.example"), envPath);
  const raw = parseToml(await readFile(envPath, "utf8"));
  const app = raw.app ?? {};
  const cometbft = raw.cometbft ?? {};

  return {
    app: {
      prefix: raw.prefix ?? "cosmos",
      chainName: raw["chain-name"] ?? "evm",
      chainId: raw["chain-id"] ?? "9001",
      denoms: raw.denoms ?? ["atest"],
      keyring: raw.keyring ?? "test",
      port: APP_PORTS,
      cfg: flatten(app),
    },
    cometbft: { port: COMET_PORTS, cfg: flatten(cometbft) },
    validatorConfigs: raw.validators ?? [],
    preMineAccounts: raw["pre-mine-accounts"] ?? [],
    privateKeys: raw["private-keys"] ?? [],
    preMinePerAccount: raw["pre-mine-per-account"] ?? "10000000000000000000000000",
    genesisCfg: raw["genesis-cfg"] ?? [],
  };
};

const run = async (command, args, cwd = curDir) => {
  const { stdout, stderr } = await execFileAsync(command, args, { cwd, maxBuffer: 1024 * 1024 * 32 });
  return { stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "" };
};
const runInput = (command, args, input, cwd = curDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        : reject(Object.assign(new Error(`${command} ${args.join(" ")} failed`), { code, stdout, stderr })),
    );
    child.stdin.end(input);
  });
const runPass = (binary, args, cwd = curDir) => runInput(binary, args, `${PASS}\n`, cwd);
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

const ensureBinary = async (daemon, shouldCompile) => {
  const local = path.join(curDir, daemon);
  const built = path.join(projectDir, "build", daemon);
  if (shouldCompile || !(await exists(local))) {
    if (shouldCompile || !(await exists(built))) await execFileAsync("make", ["build"], { cwd: projectDir, maxBuffer: 1024 * 1024 * 16 });
    let source = built;
    if (!(await exists(source))) {
      const { stdout } = await execFileAsync("sh", ["-lc", `command -v ${daemon}`], { cwd: projectDir });
      source = stdout.trim();
      if (!source) throw new Error(`${daemon} not found`);
    }
    await copyFile(source, local);
    await chmod(local, 0o755);
  }
  return local;
};

const toBech32 = async (binary, address) => {
  if (!address) throw new Error("Empty address");
  if (/^[a-z]+1/.test(address)) return address;
  if (/^0x/i.test(address)) return (await run(binary, ["query", "evm", "0x-to-bech32", address])).stdout.split(/\s+/).pop();
  const hex = address.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const home = await mkdtemp(path.join(os.tmpdir(), "deploy-key-"));
    try {
      await runPass(binary, ["keys", "unsafe-import-eth-key", "tmp", hex, "--home", home, "--keyring-backend", "test"]);
      return (await run(binary, ["keys", "show", "tmp", "-a", "--home", home, "--keyring-backend", "test"])).stdout.split(/\s+/).pop();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
  return address;
};
const keyAddress = async (binary, name, home, keyring) =>
  (await run(binary, ["keys", "show", name, "-a", "--home", home, "--keyring-backend", keyring])).stdout.split(/\s+/).pop();
const amountByDenoms = (denoms, amount) => Object.fromEntries(denoms.map((denom) => [denom, amount]));
const runtimeEnv = () => {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  return env;
};
const ceilFeeAmount = (price, gasLimit) => {
  const normalized = String(price ?? "0").trim();
  if (!normalized) return 0n;
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid decimal amount: ${normalized}`);
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
  if (Array.isArray(value)) return value.map((item) => replaceExact(item, from, to));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = replaceExact(value[key], from, to);
    return value;
  }
  return value === from ? to : value;
};
const normalizeBalanceCoins = (bank) => {
  for (const balance of bank.balances ?? []) {
    const totals = new Map();
    for (const coin of balance.coins ?? []) totals.set(coin.denom, (totals.get(coin.denom) ?? 0n) + BigInt(coin.amount ?? "0"));
    balance.coins = [...totals.entries()].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
  }
};
const recalcSupply = (bank) => {
  const totals = new Map();
  for (const balance of bank.balances ?? [])
    for (const coin of balance.coins ?? []) totals.set(coin.denom, (totals.get(coin.denom) ?? 0n) + BigInt(coin.amount ?? "0"));
  bank.supply = [...totals.entries()].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
};
const ensureMetadata = (bank, denoms) => {
  bank.denom_metadata ||= [];
  for (const denom of denoms) {
    if (bank.denom_metadata.some((item) => item.base === denom)) continue;
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
const addGenesisAccount = (genesis, address, denoms, amount) => {
  genesis.app_state.auth.accounts ||= [];
  genesis.app_state.bank.balances ||= [];
  if (!genesis.app_state.auth.accounts.some((item) => item.address === address)) {
    genesis.app_state.auth.accounts.push({
      "@type": "/cosmos.auth.v1beta1.BaseAccount",
      address,
      pub_key: null,
      account_number: "0",
      sequence: "0",
    });
  }
  const coins = denoms.map((denom) => ({ denom, amount: String(amount[denom] ?? "0") }));
  const existing = genesis.app_state.bank.balances.find((item) => item.address === address);
  if (existing) existing.coins = coins;
  else genesis.app_state.bank.balances.push({ address, coins });
};

const initNodeHome = async (binary, config, index) => {
  const home = nodeHome(config, index);
  await run(binary, [
    "init",
    `node${index}`,
    "--overwrite",
    "--chain-id",
    config.app.chainId,
    "--home",
    home,
    "--default-denom",
    config.app.denoms[0] ?? "atest",
  ]);
  return home;
};
const syncGenesis = async (daemon, count, source = 0) => {
  const genesis = path.join(nodeDir(source), daemon, "config", "genesis.json");
  for (let i = 0; i < count; i++) {
    if (i !== source) await copyFile(genesis, path.join(nodeDir(i), daemon, "config", "genesis.json"));
  }
};
const initNodes = async (binary, config, totalNodes) => {
  const daemon = daemonName(config);
  const keyring = resolveKeyring(config);
  for (let i = 0; i < totalNodes; i++) {
    const home = await initNodeHome(binary, config, i);
    const keyName = validatorKeyName(config, i);
    const mnemonic = validatorConfigAt(config, i)?.mnemonic?.trim();
    if (mnemonic) await recoverKey(binary, keyName, mnemonic, home, keyring);
    else await addKey(binary, keyName, home, keyring);
  }
  await syncGenesis(daemon, totalNodes);
};
const rebuildGentxs = async (binary, config, totalNodes, validators) => {
  if (validators < 1) return;
  const daemon = daemonName(config);
  const keyring = resolveKeyring(config);
  const denom = config.app.denoms[0] ?? "atest";
  const gentxs = [];
  const gentxDir = path.join(nodesDir, "gentxs");
  const p2pPort = Number(config.cometbft.port["p2p.laddr"]);
  await rm(gentxDir, { recursive: true, force: true });
  await mkdir(gentxDir, { recursive: true });
  for (let i = 0; i < validators; i++) {
    const home = nodeHome(config, i);
    const out = path.join(gentxDir, `node${i}.json`);
    const genesis = await readJson(configPaths(config, i).genesis);
    const fees = gentxFee(genesis, denom);
    const nodeId = (await run(binary, ["comet", "show-node-id", "--home", home])).stdout.split(/\s+/).pop();
    const pubkey = (await run(binary, ["comet", "show-validator", "--home", home])).stdout.trim();
    const args = [
      "genesis",
      "gentx",
      validatorKeyName(config, i),
      `100000000000000000000${denom}`,
      "--home",
      home,
      "--chain-id",
      config.app.chainId,
      "--keyring-backend",
      keyring,
      "--output-document",
      out,
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
    if (fees) args.push("--gas", GENTX_GAS_LIMIT.toString(), "--fees", fees);
    await run(binary, args);
    gentxs.push(await readJson(out));
  }
  for (let i = 0; i < totalNodes; i++) {
    const genesisPath = configPaths(config, i).genesis;
    const genesis = await readJson(genesisPath);
    genesis.app_state.genutil.gen_txs = gentxs;
    await writeJson(genesisPath, genesis);
  }
};
const applyGenesis = async (binary, config, totalNodes, validators) => {
  const keyring = resolveKeyring(config);
  const denoms = config.app.denoms ?? ["atest"];
  const addresses = new Map();
  const amount = config.preMinePerAccount;

  for (const entry of config.preMineAccounts ?? []) {
    const address = typeof entry === "string" ? entry : (entry?.address ?? entry?.key);
    if (address) addresses.set(await toBech32(binary, address), typeof entry === "string" ? amount : (entry.amount ?? amount));
  }
  for (let i = 0; i < totalNodes; i++) {
    const home = nodeHome(config, i);
    const address = await keyAddress(binary, validatorKeyName(config, i), home, keyring);
    if (!addresses.has(address)) addresses.set(address, amount);
  }
  for (let i = 0; i < totalNodes; i++) {
    const genesisPath = configPaths(config, i).genesis;
    const genesis = await readJson(genesisPath);
    replaceExact(genesis, "stake", denoms[0] ?? "atest");
    ensureMetadata(genesis.app_state.bank, denoms);
    normalizeBalanceCoins(genesis.app_state.bank);
    for (const [address, balanceAmount] of addresses.entries()) {
      addGenesisAccount(genesis, address, denoms, amountByDenoms(denoms, balanceAmount));
    }
    for (const cfg of config.genesisCfg ?? []) Function("genesis", `genesis.${cfg}`)(genesis);
    recalcSupply(genesis.app_state.bank);
    await writeJson(genesisPath, genesis);
  }
  await rebuildGentxs(binary, config, totalNodes, validators);
  await run(binary, ["genesis", "validate", "--home", nodeHome(config, 0)]);
};

const getNodeIds = async (binary, daemon, totalNodes) => {
  const ids = [];
  for (let i = 0; i < totalNodes; i++) {
    ids.push((await run(binary, ["comet", "show-node-id", "--home", path.join(nodeDir(i), daemon)])).stdout.split(/\s+/).pop());
  }
  return ids;
};
const updateConfigs = async (binary, config, totalNodes) => {
  const daemon = daemonName(config);
  const p2pPort = Number(config.cometbft.port["p2p.laddr"]);
  const rpcPort = Number(config.cometbft.port["rpc.laddr"]);
  const nodeIds = await getNodeIds(binary, daemon, totalNodes);
  for (let i = 0; i < totalNodes; i++) {
    const { app: appPath, comet: cometPath, client: clientPath } = configPaths(config, i);
    const appToml = await readFile(appPath, "utf8");
    const appOverrides = { ...buildPortMap(appToml, config.app.port, i), ...(config.app.cfg || {}) };
    await writeFile(appPath, applyTomlMap(appToml, appOverrides));

    const peers = [];
    for (let j = 0; j < totalNodes; j++) if (i !== j) peers.push(`${nodeIds[j]}@127.0.0.1:${p2pPort + j}`);
    const cometToml = await readFile(cometPath, "utf8");
    const cometOverrides = {
      ...buildPortMap(cometToml, config.cometbft.port, i),
      ...(config.cometbft.cfg || {}),
      "p2p.persistent_peers": peers.join(","),
    };
    await writeFile(cometPath, applyTomlMap(cometToml, cometOverrides));

    const clientToml = await readFile(clientPath, "utf8");
    const clientOverrides = {
      "chain-id": config.app.chainId,
      "keyring-backend": RUNTIME_KEYRING,
      output: "text",
      node: `tcp://localhost:${rpcPort + i}`,
      "broadcast-mode": "sync",
    };
    await writeFile(clientPath, applyTomlMap(clientToml, clientOverrides));
  }
};
const importPrivateKeys = async (binary, config) => {
  if (!Array.isArray(config.privateKeys) || config.privateKeys.length === 0) return;
  const home = nodeHome(config, 0);
  for (const entry of config.privateKeys) {
    if (!entry?.name || !entry?.key) continue;
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
      if (!String(error.stderr || error.message || "").includes("cannot overwrite key")) throw error;
    }
  }
};

const nodeStartArgs = (config, index) => ["start", "--keyring-backend", resolveKeyring(config), "--home", `./node${index}/${daemonName(config)}`];

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

const writeScripts = async (config, totalNodes, isNohup) => {
  const daemon = daemonName(config);
  const keyring = resolveKeyring(config);
  const baseP2P = Number(config.cometbft.port["p2p.laddr"]);
  const baseRpc = Number(config.cometbft.port["rpc.laddr"]);
  const perNodeExt = scriptExt();
  const allScriptExt = scriptExt();
  let startAll = "#!/bin/bash\n";
  let stopAll = "#!/bin/bash\n";
  let statusScript = "#!/bin/bash\nset -e\n";

  for (let i = 0; i < totalNodes; i++) {
    const envPrefix = 'env -i PATH="$PATH" HOME="$HOME" ';
    const logFile = `./${daemon}${i}.log`;
    const pidFile = `./${daemon}${i}.pid`;
    const startScript = `#!/bin/bash\n${
      isNohup
        ? `setsid ${envPrefix}./${daemon} start --keyring-backend ${keyring} --home ./node${i}/${daemon} < /dev/null >>${logFile} 2>&1 &\necho $! > ${pidFile}\n`
        : `${envPrefix}./${daemon} start --keyring-backend ${keyring} --home ./node${i}/${daemon}\n`
    }`;
    const stopScript = `#!/bin/bash\npid=\`lsof -iTCP:${baseP2P + i} -sTCP:LISTEN -t\`\nif [[ -n $pid ]]; then kill -15 $pid; fi\nrm -f ${pidFile}\n`;
    const startPath = path.join(nodesDir, `start${i}.${perNodeExt}`);
    const stopPath = path.join(nodesDir, `stop${i}.${perNodeExt}`);

    await writeFile(startPath, startScript);
    await writeFile(stopPath, stopScript);
    startAll += `./start${i}.sh\n`;
    stopAll += `./stop${i}.sh\n`;
    statusScript += `height=$(./${daemon} status --node tcp://127.0.0.1:${baseRpc + i} --output json | sed -n 's/.*"latest_block_height":"\\([0-9]*\\)".*/\\1/p')\necho "node${i}: height=\${height}"\n`;
    await chmod(startPath, 0o755);
    await chmod(stopPath, 0o755);
  }
  if (isNohup) startAll += "sleep 3\n./status.sh\n";
  const startAllPath = path.join(nodesDir, `startAll.${allScriptExt}`);
  const stopAllPath = path.join(nodesDir, `stopAll.${allScriptExt}`);
  const statusPath = path.join(nodesDir, `status.${allScriptExt}`);
  await writeFile(startAllPath, startAll);
  await writeFile(stopAllPath, stopAll);
  await writeFile(statusPath, statusScript);
  await chmod(startAllPath, 0o755);
  await chmod(stopAllPath, 0o755);
  await chmod(statusPath, 0o755);
};

const parseSelection = (value, totalNodes) => (value === "all" ? allNodeIndexes(totalNodes) : selectedNodeIndexes(value, totalNodes));
const copyBinaryToNodes = async (binary, config) => {
  const daemon = daemonName(config);
  const target = path.join(nodesDir, daemon);

  await copyFile(binary, target);
  await chmod(target, 0o755);
};
const stopNodes = async (value) => {
  if (!value) return;
  const ext = scriptExt();
  if (value === "all") {
    const script = path.join(nodesDir, `stopAll.${ext}`);
    if (await exists(script)) await run(script, [], nodesDir);
    return;
  }
  for (const index of parsedIndexes(value)) {
    const script = path.join(nodesDir, `stop${index}.${scriptExt()}`);
    if (await exists(script)) await run(script, [], nodesDir);
  }
};
const waitForStatusReady = async () => {
  const statusScript = path.join(nodesDir, `status.${scriptExt()}`);
  if (!(await exists(statusScript))) return;

  const deadline = Date.now() + STATUS_WAIT_TIMEOUT_MS;
  let lastStdout = "";

  while (Date.now() < deadline) {
    try {
      const { stdout } = await run(statusScript, [], nodesDir);
      if (stdout) {
        lastStdout = stdout;
        const heights = parseStatusHeights(stdout);
        console.log(stdout);
        if (heights.some((height) => height >= STATUS_READY_HEIGHT)) {
          return;
        }
      }
    } catch {}

    await sleep(STATUS_POLL_INTERVAL_MS);
  }

  if (lastStdout) console.log(lastStdout);
};
const startNodes = async (value, totalNodes, config, useDetachedStart) => {
  if (!value || value.toLowerCase() === "no") return;
  if (useDetachedStart) {
    if (totalNodes === undefined) throw new Error("totalNodes is required when start is detached");
    console.log(`Starting ${totalNodes} local nodes...`);
    for (const index of parseSelection(value, totalNodes)) {
      await launchDetachedNode(config, index);
    }
    await waitForStatusReady();
    return;
  }
  const ext = scriptExt();
  if (value === "all") return run(path.join(nodesDir, `startAll.${ext}`), [], nodesDir);
  if (totalNodes === undefined) throw new Error("totalNodes is required when start is not all");
  for (const index of parseSelection(value, totalNodes)) {
    await run(path.join(nodesDir, `start${index}.${scriptExt()}`), [], nodesDir);
  }
};
const refreshKeptNetwork = async (binary, config) => {
  if (!(await exists(nodesDir))) throw new Error("nodes directory not found");

  const startAll = path.join(nodesDir, `startAll.${scriptExt()}`);

  if (!(await exists(startAll))) throw new Error("startAll script not found");

  await copyBinaryToNodes(binary, config);
};
const initNetwork = async (binary, config, options) => {
  const totalNodes = options.validators + options.commonNode;
  if (options.validators < 1) throw new Error("validators must be >= 1");
  validateValidatorConfigs(config, options.validators);

  await rm(nodesDir, { recursive: true, force: true });
  await mkdir(nodesDir, { recursive: true });
  console.log(`Initializing ${totalNodes} local nodes...`);
  await initNodes(binary, config, totalNodes);
  await applyGenesis(binary, config, totalNodes, options.validators);

  await updateConfigs(binary, config, totalNodes);
  await importPrivateKeys(binary, config);
  await writeScripts(config, totalNodes, options.nohup);
  await copyBinaryToNodes(binary, config);
};

const main = async () => {
  if (process.platform === "win32") throw new Error("deploy/dev.ts does not support Windows");
  const options = parseArgs(process.argv.slice(2));
  const totalNodes = options.validators + options.commonNode;
  await initTomlEditor();
  const config = await loadConfig();
  const daemon = daemonName(config);
  console.log(
    `validators:${options.validators}, commonNode:${options.commonNode}, init:${options.init}, compile:${options.compile}, start:${options.start}, stop:${options.stop}, keep:${options.keep}, nohup:${options.nohup}\n`,
  );
  if (options.stop) return stopNodes(options.stop);
  const stopAll = path.join(nodesDir, `stopAll.${scriptExt()}`);
  if (await exists(stopAll)) {
    try {
      await stopNodes("all");
      await sleep(300);
    } catch {}
  }
  const binary = await ensureBinary(daemon, options.compile || options.keep);
  if (options.keep) {
    await refreshKeptNetwork(binary, config);
    await startNodes("all", totalNodes, config, options.nohup);
    return;
  }
  if (options.init) {
    await initNetwork(binary, config, options);
  }
  await startNodes(options.start, totalNodes, config, options.nohup);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

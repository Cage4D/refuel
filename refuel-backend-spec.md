# Refuel: Backend Build Spec (one-pass handoff for Claude Code)

> **What you are building:** Refuel lets someone who holds **MUSD** on **Mezo testnet** but has **zero BTC** (Mezo's gas token) get a small amount of native BTC for gas. They sign one EIP-2612 permit, which costs no gas. A relayer submits it. The Refuel contract takes their MUSD, prices BTC using Mezo's own **PriceFeed**, and sends them native BTC.
>
> **Context:** This is a submission to the Mezo Buildathon on AKINDO (Wave 2, Track 2: Access & Distribution). The deadline is **15 Nov 2026, about 15:00 UTC**, so build in the order given in §11 and keep the scope tight. **Testnet only.** No mainnet deployment and no real funds.
>
> **Build it in one pass.** Where something below says **VERIFY**, check it against the chain first, then follow the stated fallback. Don't stop to ask.

---

## 1. Goals and non-goals

**Goals (all required)**
1. `Refuel.sol` deployed and **verified** on Mezo testnet (chainId **31611**), with Foundry tests passing.
2. A relayer API (Next.js route handlers, viem) that:
   - quotes a refuel,
   - returns the permit typed data for the user to sign,
   - checks the signature, simulates the call and submits it,
   - returns the tx hash and explorer link.
3. A minimal one-page UI that runs the 60-second demo (§9).
4. A demo script that does **real refuels to 3–5 different fresh wallets** on testnet. The resulting tx links go in the README.
5. A README with addresses, verified-contract link, tx links, architecture and the Mezo contracts used.

**Non-goals (do not build)**
- A database. On-chain events are the history.
- Mainnet, MEZO-token support (stretch only, §12), sponsor tanks, swapping MUSD to BTC through pools (stretch only), and auth or accounts.

---

## 2. Network and protocol constants

| Item | Value | Notes |
|---|---|---|
| Chain | Mezo testnet ("matsnet") | chainId `31611` |
| RPC | `https://rpc.test.mezo.org` | |
| Explorer | `https://explorer.test.mezo.org` | Blockscout-style. Tx link: `/tx/<hash>`, address link: `/address/<addr>` |
| Native gas token | **BTC, 18 decimals** | Contracts send it with `call{value: …}` like ETH |
| MUSD (testnet) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | **VERIFY** on the explorer: `symbol()=="MUSD"`, `decimals()==18`, and `DOMAIN_SEPARATOR()` exists (ERC20Permit). Make the address an env var. |
| TroveManager (testnet) | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | Used only to look up the PriceFeed address |
| BorrowerOperations (testnet) | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | Fallback PriceFeed lookup |
| PriceFeed (testnet) | **Resolve at deploy time** | Call `TroveManager.priceFeed()`. If that fails, call `BorrowerOperations.priceFeed()`. Log the address and assert it is non-zero and has code. (The mainnet PriceFeed is `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88`, for reference only.) |
| Faucet | `https://faucet.test.mezo.org` | Test BTC and MEZO |
| Getting MUSD | `https://testnet.mezo.org` | Swap BTC → MUSD in the dApp. Borrowing needs ≥1,800 MUSD of debt, so swapping is easier. |

**PriceFeed interface.** Declare it as non-view so it works whether the real function is view or not:

```solidity
interface IPriceFeed { function fetchPrice() external returns (uint256); } // USD per 1 BTC, 18 decimals
```

**VERIFY:** call `fetchPrice()` once with `cast call` to confirm it returns a value of about `1e22`–`1e24` (a BTC price in the tens of thousands of dollars, scaled by 1e18). If it reverts with `cast call`, use `cast send` in a test, and the contract will still work through the non-view interface.

All addresses go in env and in `contracts/deployments/31611.json`. Never hardcode them in the app.

---

## 3. Repo layout

```
refuel/
├─ contracts/                 # Foundry
│  ├─ src/Refuel.sol
│  ├─ src/interfaces/IPriceFeed.sol
│  ├─ test/Refuel.t.sol       # unit tests with mocks
│  ├─ test/RefuelFork.t.sol   # fork smoke test against Mezo testnet
│  ├─ test/mocks/MockPermitToken.sol, MockPriceFeed.sol
│  ├─ script/Deploy.s.sol     # resolves PriceFeed, deploys, writes deployments/31611.json
│  ├─ script/Fund.s.sol       # sends BTC float to the contract
│  ├─ deployments/31611.json
│  └─ foundry.toml
├─ app/                       # Next.js 15 App Router + TypeScript + viem + zod
│  ├─ src/app/page.tsx        # minimal demo UI (§9)
│  ├─ src/app/api/health/route.ts
│  ├─ src/app/api/config/route.ts
│  ├─ src/app/api/quote/route.ts
│  ├─ src/app/api/refuel/route.ts
│  ├─ src/app/api/refuels/route.ts
│  ├─ src/app/api/stats/route.ts
│  ├─ src/lib/chain.ts        # mezoTestnet chain def, public + wallet clients
│  ├─ src/lib/contracts.ts    # ABIs (generated from forge out/), addresses from env
│  ├─ src/lib/permit.ts       # typed-data builder + verification
│  ├─ src/lib/relayer.ts      # send mutex, simulate, submit, wait
│  ├─ src/lib/ratelimit.ts    # in-memory token bucket
│  ├─ src/lib/errors.ts       # error catalog (§8.3)
│  └─ src/lib/schemas.ts      # zod schemas shared by API and UI
├─ scripts/demo-fresh-wallets.ts   # §10
├─ .env.example
└─ README.md
```

Package manager: `pnpm`. Node 20+. Use `tsx` to run the scripts.

---

## 4. Smart contract: `Refuel.sol`

Solidity `^0.8.24`, OpenZeppelin v5 (`Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `IERC20Permit`).

### 4.1 State

```solidity
IERC20       public immutable musd;
IPriceFeed   public immutable priceFeed;

struct Limits {
  uint128 minAmountIn;      // default 1e18   (1 MUSD)
  uint128 maxAmountIn;      // default 5e18   (5 MUSD)
  uint64  cooldown;         // default 1 days, per owner
  uint64  maxRefuelsPerAddress; // default 3 (lifetime)
  uint128 dailyBtcCap;      // default 0.002 ether (global, per UTC day)
}
struct Fees {
  uint16  feeBps;           // default 200 (2%), hard cap 1000
  uint128 flatFee;          // default 0.05e18 MUSD; covers relayer gas
}
struct OracleBounds { uint128 minPrice; uint128 maxPrice; } // default 1_000e18 .. 1_000_000e18

Limits public limits; Fees public fees; OracleBounds public bounds;
mapping(address => uint64) public lastRefuelAt;
mapping(address => uint64) public refuelCount;
mapping(uint256 => uint256) public btcSentOnDay; // day = block.timestamp / 1 days
uint256 public totalRefuels; uint256 public totalBtcOut; uint256 public totalMusdIn;
```

### 4.2 Core function (permissionless: anyone can relay)

```solidity
function refuelWithPermit(
  address owner, uint256 amountIn, uint256 deadline,
  uint8 v, bytes32 r, bytes32 s
) external nonReentrant whenNotPaused returns (uint256 btcOut)
```

Steps, in this order:
1. `amountIn` must be within `[minAmountIn, maxAmountIn]`. Otherwise revert `AmountOutOfRange`.
2. Eligibility:
   - `refuelCount[owner] < maxRefuelsPerAddress`, else `TooManyRefuels`.
   - `block.timestamp >= lastRefuelAt[owner] + cooldown`, else `CooldownActive(nextAt)`.
3. Permit, made resistant to front-running:
   `try IERC20Permit(address(musd)).permit(owner, address(this), amountIn, deadline, v, r, s) {} catch {}`.
   Then require `musd.allowance(owner, address(this)) >= amountIn`, else `PermitFailed`.
4. Price: `price = priceFeed.fetchPrice()`. Require `bounds.minPrice <= price <= bounds.maxPrice`, else `OracleOutOfBounds(price)`.
5. Fee:
   - `fee = flatFee + amountIn * feeBps / 10_000`.
   - Require `fee < amountIn`.
   - `net = amountIn - fee`.
6. `btcOut = net * 1e18 / price`. (MUSD is treated as $1. Both values use 18 decimals.) Require `btcOut > 0`.
7. Caps:
   - `btcSentOnDay[today] + btcOut <= dailyBtcCap`, else `DailyCapReached`.
   - `address(this).balance >= btcOut`, else `InsufficientFloat`.
8. Effects (checks-effects-interactions):
   - Update `lastRefuelAt`, `refuelCount`, `btcSentOnDay`.
   - Update the totals.
9. `musd.safeTransferFrom(owner, address(this), amountIn)`.
10. `(bool ok,) = owner.call{value: btcOut}("")`. Require `ok`, else `BtcTransferFailed`.
11. `emit Refueled(owner, msg.sender, amountIn, fee, btcOut, price);`

BTC always goes to `owner`, the address that signed the permit. A relayer can't redirect it, and can pull no more than the permitted `amountIn`. This is the security argument; put it in the README.

### 4.3 Views (the API and UI use these)

```solidity
function quote(uint256 amountIn) external returns (uint256 btcOut, uint256 fee, uint256 price); // non-view because fetchPrice may be non-view; call via eth_call
function eligibility(address owner) external view returns (bool ok, uint8 reason, uint64 nextAt);
  // reason: 0 OK, 1 PAUSED, 2 COOLDOWN, 3 MAX_REFUELS, 4 FLOAT_EMPTY (balance < quote of minAmountIn is approximated by balance==0), 5 DAILY_CAP
function floatBalance() external view returns (uint256);
```

### 4.4 Admin (onlyOwner)

- `setLimits(Limits)`, `setFees(Fees)`. `setFees` reverts if `feeBps > 1000`.
- `setOracleBounds(OracleBounds)`.
- `pause()`, `unpause()`.
- `withdrawToken(IERC20 token, address to, uint256 amt)`: lets the owner take collected MUSD.
- `withdrawBtc(address payable to, uint256 amt)`.
- `receive() external payable` emits `Funded(msg.sender, msg.value)`.
- Each setter emits an event.

### 4.5 Custom errors and events

Errors: `AmountOutOfRange, TooManyRefuels, CooldownActive(uint64), PermitFailed, OracleOutOfBounds(uint256), FeeTooHigh, ZeroOut, DailyCapReached, InsufficientFloat, BtcTransferFailed`.

Events: `Refueled(address indexed owner, address indexed relayer, uint256 amountIn, uint256 fee, uint256 btcOut, uint256 price)`, `Funded`, `LimitsUpdated`, `FeesUpdated`, `OracleBoundsUpdated`.

NatSpec on every external function.

---

## 5. Contract tests (Foundry)

### `Refuel.t.sol` (mocks: an OZ `ERC20Permit` token and a settable price feed)

1. Happy path: a fresh owner with 0 BTC and 5 MUSD, with the permit signed via `vm.sign`, gets the exact `btcOut`. Check balances and the event.
2. The relayer is a third address. BTC goes to the owner, never the relayer.
3. The permit was front-run, so the allowance already exists. The refuel still succeeds.
4. Amount below the minimum or above the maximum reverts.
5. Cooldown: a second refuel within 24h reverts, and after `vm.warp` it succeeds.
6. `maxRefuelsPerAddress` is enforced.
7. The daily cap is enforced and resets the next day.
8. An oracle price of 0, below the minimum or above the maximum reverts.
9. Insufficient float reverts.
10. A paused contract reverts.
11. An expired permit or wrong signer reverts with `PermitFailed`.
12. The fee math matches a reference calculation. Fuzz `amountIn` within its bounds and assert `btcOut == (amountIn - fee) * 1e18 / price`.
13. Admin functions are owner-only, and `setFees` rejects `feeBps > 1000`.
14. Withdrawing BTC and tokens works for the owner and fails for anyone else.
15. Reentrancy: an owner contract that re-enters on `receive` is blocked by `nonReentrant`.

### `RefuelFork.t.sol` (runs only when `MEZO_RPC` is set)

- Fork `https://rpc.test.mezo.org`.
- Resolve the PriceFeed through TroveManager and assert `fetchPrice()` is within bounds.
- Deploy Refuel with the real MUSD and PriceFeed, and fund it with 0.01 BTC using `vm.deal`.
- Give a fresh signer MUSD with `deal(address(musd), owner, 5e18)`. If storage-slot dealing fails on the proxy, `vm.prank` a funded holder found via the explorer and transfer instead.
- Sign a permit using the real token's `DOMAIN_SEPARATOR`, then refuel and assert BTC was received.

Run: `forge test -vvv`. Every test must pass before deploying.

---

## 6. Deploy, fund, verify

`script/Deploy.s.sol`:
1. Read `MUSD_ADDRESS`, `TROVE_MANAGER`, `BORROWER_OPERATIONS` from env.
2. Resolve the PriceFeed (§2).
3. Deploy with the defaults from §4.1.
4. Write `deployments/31611.json`: `{ refuel, musd, priceFeed, deployBlock, deployer }`.

Commands (document them in the README):
```bash
forge script script/Deploy.s.sol --rpc-url $MEZO_RPC --private-key $DEPLOYER_PK --broadcast
forge script script/Fund.s.sol   --rpc-url $MEZO_RPC --private-key $DEPLOYER_PK --broadcast   # sends FLOAT_BTC (default 0.002 ether)
forge verify-contract <REFUEL> src/Refuel.sol:Refuel --chain-id 31611 --verifier sourcify \
  --constructor-args $(cast abi-encode "constructor(address,address)" $MUSD $PRICE_FEED)
```

If Sourcify fails, try `--verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/`. **VERIFY** that URL; if it's wrong, find the Blockscout API URL from the explorer's footer or API page. Verification is required (Wave 1 reviewers penalised unverified contracts).

After deploying, copy the ABI from `out/Refuel.sol/Refuel.json` into `app/src/lib/contracts.ts`. A small `pnpm abi` script that does this is fine.

---

## 7. Environment variables (`.env.example`)

```
# chain
MEZO_RPC=https://rpc.test.mezo.org
CHAIN_ID=31611
EXPLORER_URL=https://explorer.test.mezo.org
# contracts
MUSD_ADDRESS=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
TROVE_MANAGER=0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
BORROWER_OPERATIONS=0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
REFUEL_ADDRESS=
REFUEL_DEPLOY_BLOCK=
# keys (never commit, never log)
DEPLOYER_PK=
RELAYER_PK=            # separate key, funded with ~0.001 BTC for gas
DEMO_FUNDER_PK=        # holds MUSD + BTC, used by scripts/demo-fresh-wallets.ts
# api
ALLOWED_ORIGIN=http://localhost:3000
PERMIT_TTL_SECONDS=600
RELAYER_MIN_BALANCE_WEI=200000000000000   # 0.0002 BTC: refuse to relay below this
```

---

## 8. Relayer API (Next.js route handlers, Node runtime)

General rules:
- `export const runtime = "nodejs"`.
- Validate every input with zod.
- JSON responses only, with CORS set to `ALLOWED_ORIGIN`.
- Amounts travel as **decimal strings in wei**. Each response also includes formatted strings (`"0.000019 BTC"`, `"$1.90"`).
- Serialise every relayer transaction through one async mutex, so a single relayer key never has nonce clashes.

### 8.1 Endpoints

| Method & path | Request | Response |
|---|---|---|
| `GET /api/health` | — | `{ ok, chainId, relayer, relayerBalance, refuel, floatBalance, paused, priceUsd }` |
| `GET /api/config` | — | `{ chainId, explorerUrl, refuel, musd: { address, name, version, decimals }, limits, fees, permitTtlSeconds }` |
| `GET /api/quote?owner=0x…&amount=2` | `amount` in whole or decimal MUSD | `{ amountIn, fee, btcOut, priceUsd, formatted, eligibility: { ok, reason, nextAt }, musdBalance, btcBalance, permit: { domain, types, primaryType:"Permit", message:{ owner, spender: refuel, value, nonce, deadline } } }` |
| `POST /api/refuel` | `{ owner, amountIn, deadline, signature }` | `{ txHash, explorerTxUrl, btcOut, status: "confirmed" }` (`202` with `status:"submitted"` if not confirmed within 20 s) |
| `GET /api/refuels?limit=20` | — | Recent `Refueled` events: `[{ owner (shortened), btcOut, amountIn, txHash, explorerTxUrl, timestamp }]` |
| `GET /api/stats` | — | `{ totalRefuels, totalBtcOut, totalMusdIn, uniqueOwners }` (read from contract totals plus log scan from `REFUEL_DEPLOY_BLOCK`) |

### 8.2 `POST /api/refuel` pipeline (in order)

1. Rate limit with an in-memory token bucket: 5 requests per minute per IP and 3 per hour per `owner`. (Serverless instances are ephemeral. Accept that, note it in the README, and rely on the on-chain cooldown as the real limit.)
2. Parse the body with zod and normalise addresses with `getAddress`.
3. Check `deadline > now + 30s` and `deadline <= now + PERMIT_TTL_SECONDS + 60`.
4. Build the typed data. Read `nonces(owner)` from MUSD. For the domain, read `eip712Domain()` (EIP-5267) if the token has it; otherwise use `name()`, version `"1"`, `chainId`, and `verifyingContract = MUSD`. On first use, assert that the domain hash equals the token's `DOMAIN_SEPARATOR()` and cache it.
5. Run `verifyTypedData`. If the signer isn't `owner`, return `INVALID_SIGNATURE`.
6. Off-chain pre-checks:
   - MUSD balance ≥ `amountIn`.
   - `eligibility(owner)` returns ok.
   - Relayer balance ≥ `RELAYER_MIN_BALANCE_WEI`.
7. Split the signature into `v, r, s` and run `simulateContract(refuelWithPermit, …)` from the relayer account. Map revert names to the error catalog.
8. Inside the mutex, `writeContract`, then `waitForTransactionReceipt` with a 20 s timeout.
9. Decode the `Refueled` log from the receipt and return `btcOut` from it.
10. Idempotency: keep an in-memory `Map<signatureHash, txHash>` for 10 minutes. A repeat request returns the same `txHash`.

Never log private keys or full signatures. Log `{ owner, amountIn, txHash, ms }`.

### 8.3 Error catalog (`lib/errors.ts`; user-facing copy the UI can show as-is)

| Code | HTTP | Message |
|---|---|---|
| `INVALID_INPUT` | 400 | "Something's off with that request." |
| `INVALID_SIGNATURE` | 401 | "That signature doesn't match your wallet. Please sign again." |
| `PERMIT_EXPIRED` | 410 | "Your signature expired. Get a fresh quote." |
| `INSUFFICIENT_MUSD` | 422 | "You need at least {min} MUSD to refuel." |
| `AMOUNT_OUT_OF_RANGE` | 422 | "Refuel between {min} and {max} MUSD." |
| `COOLDOWN` | 429 | "You refueled recently. Try again {relativeTime}." |
| `MAX_REFUELS` | 429 | "This wallet has used all its refuels." |
| `DAILY_CAP` | 503 | "Today's refuel budget is used up. Try again tomorrow (UTC)." |
| `FLOAT_EMPTY` | 503 | "The refuel tank is empty right now." |
| `ORACLE_UNAVAILABLE` | 503 | "BTC price is unavailable right now. Try again shortly." |
| `RELAYER_LOW` | 503 | "The relayer is low on gas. Try again shortly." |
| `PAUSED` | 503 | "Refuel is paused." |
| `RATE_LIMITED` | 429 | "Slow down a little and try again in a minute." |
| `CHAIN_ERROR` | 502 | "The network didn't accept the transaction. Nothing was taken from your wallet." |

Every error body has the shape `{ error: { code, message, details? } }`.

---

## 9. Minimal UI (`app/src/app/page.tsx`, needed so the demo works)

Use viem plus an injected wallet (`window.ethereum`), no wagmi, to keep it small. Tailwind is fine. One screen, top to bottom:

1. **Headline:** "Got MUSD but no BTC for gas? Refuel." Subline: "Sign once, with no gas needed, and get enough BTC to use Mezo."
2. **Connect wallet.** If the wallet is on the wrong chain, call `wallet_addEthereumChain` with chain 31611: native currency `{ name:"Bitcoin", symbol:"BTC", decimals:18 }`, the RPC and explorer from config. Adding a chain costs no gas.
3. **Balances card:** BTC balance (highlighted red when 0) and MUSD balance.
4. **Amount picker:** preset chips for 1, 2 and 5 MUSD. The live quote shows "You get ≈ 0.0000xx BTC (≈ N transactions)", plus the fee and the BTC price "from Mezo PriceFeed".
5. **Refuel button:** call `eth_signTypedData_v4` with the permit from `/api/quote`, then `POST /api/refuel`. Show a spinner, then a success state with the explorer link and the updated BTC balance.
6. **"Now try it" button:** sends 0.1 MUSD to the user's own address, paid with their new BTC. This proves the wallet is no longer stuck.
7. **Footer:** a live feed from `/api/refuels`, the verified-contract link, and the "Testnet only" badge.

To estimate "≈ N transactions", divide `btcOut` by `gasPrice × 60,000`. Label it as an estimate.

Handle three edge cases: no wallet installed, the user rejects the signature, and each error code from §8.3.

---

## 10. Demo script: `scripts/demo-fresh-wallets.ts` (proves real usage)

`pnpm demo --count 4 --amount 2`:
1. Generate N fresh private keys and save them to `scripts/.demo-wallets.json`, which is gitignored.
2. From `DEMO_FUNDER_PK`, send each wallet `amount + 0.5` MUSD. The funder pays gas; the fresh wallets get **no BTC**.
3. For each wallet:
   - fetch `/api/quote`,
   - sign the permit locally with the wallet's key,
   - `POST /api/refuel`,
   - then send a small MUSD transfer from the fresh wallet using its new BTC.
4. Print a markdown table: wallet, refuel tx link, BTC received, follow-up tx link. Append the table to `README.md` under "On-chain proof".

The base URL defaults to `http://localhost:3000`, with `--api` to override it.

---

## 11. Build order and time budget (stick to this)

| # | Block | Time | Done when |
|---|---|---|---|
| 1 | Scaffold the repo, `.env.example`, foundry.toml (OZ v5 via forge install) | 15m | `forge build` and `pnpm dev` both run |
| 2 | `Refuel.sol` and mocks; unit tests 1–15 | 60m | `forge test` is green |
| 3 | Resolve PriceFeed, fork test, deploy, fund, verify | 30m | Verified address in `deployments/31611.json` |
| 4 | API: health, config, quote, refuel | 50m | A curl walkthrough succeeds against the live contract |
| 5 | Minimal UI | 40m | Full 60-second flow works in a browser |
| 6 | Demo script and README | 25m | 3–5 real refuels to fresh wallets, with links in the README |
| 7 | Deploy the app to Vercel with env vars set; smoke test in a private window | 15m | Live URL works end to end |

If you're short on time, cut in this order: `/api/stats`, the live feed, the "≈ N transactions" estimate. **Never cut:** verification, the demo-script proof, or the error handling.

---

## 12. Stretch (only if everything in §11 is done)

1. **MEZO support.** First check that MEZO implements EIP-2612 (`DOMAIN_SEPARATOR()` exists). If not, skip; a no-BTC user can't send an `approve` transaction. For pricing, quote via a Mezo pool's `getAmountOut` on a MEZO/MUSD or MEZO/BTC pool, with a TWAP if available. Keep amounts tiny and document the risk that spot prices can be manipulated.
2. **Float refill.** An owner-only `refill()` that swaps collected MUSD for BTC through a Mezo basic pool (Aerodrome-style router; pool factory `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248` per the docs, **VERIFY** for testnet). This makes the system self-sustaining and adds composability, which scored highest in Wave 1.
3. **Sponsor mode.** Apps deposit MUSD to cover users' fees.

---

## 13. README (required sections)

1. One-liner and the problem. Paraphrase, don't quote: Wave 1 grant recipients on the buildathon page reported getting MEZO but having no BTC for gas.
2. How it works: a sequence diagram (Mermaid) covering user signs permit → relayer → Refuel → PriceFeed → BTC to user.
3. Mezo integrations used: MUSD (ERC20Permit), PriceFeed (resolved through TroveManager), native BTC gas, deployment on Mezo testnet.
4. Security model: BTC only goes to the permit signer; pulls are bounded by the permit amount; cooldown, lifetime and daily caps; oracle bounds; pausable; Ownable2Step; ReentrancyGuard; known limits (in-memory rate limiting, a trusted owner for parameters).
5. Addresses: the verified-contract link, the relayer address, the deploy block.
6. On-chain proof: the table from the demo script.
7. Run it locally: the env vars and commands.
8. Status: **testnet only**, plus mainnet as the first milestone. Don't claim any mainnet deployment.
9. Roadmap, 3 milestones: mainnet with an audit-lite review; MEZO support plus float refill through Mezo pools; sponsor tanks for wallets and apps.

---

## 14. Definition of done (check every box)

- [ ] `forge test` is green, including fuzz tests; the fork test passes with `MEZO_RPC` set.
- [ ] Refuel is deployed on chain 31611 and **verified**, with its float funded.
- [ ] `/api/health` reports ok, with relayer and float balances above zero.
- [ ] A fresh wallet with 0 BTC refuels through the UI and then sends a transaction with its own gas.
- [ ] The demo script produced ≥3 refuels to **different** fresh addresses, with links in the README.
- [ ] No secrets in the repo, and the `.env*` files are gitignored.
- [ ] The app is live on Vercel. All links were checked in a private window.
- [ ] The README has every section in §13 and makes no mainnet claims.

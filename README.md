# Refuel

**Got MUSD but no BTC for gas? Sign one free permit and get enough native BTC to use Mezo.**

**Live demo:** https://refuel-self.vercel.app (Mezo testnet)

> **Status: testnet only.** Refuel runs on Mezo testnet (chainId 31611) with test funds. It is not deployed on mainnet. Mainnet is the first roadmap milestone below.

## The problem

On Mezo, BTC is the gas token. Wave 1 grant recipients on the buildathon page said they received tokens but had no BTC to pay gas, so they couldn't move them. The same thing happens to anyone who is sent MUSD by a friend, an app or an exchange. They hold value on Mezo but can't send a single transaction, not even an `approve`.

Refuel fixes this. The user signs an **EIP-2612 permit**, which costs no gas. A relayer submits it. The Refuel contract takes a small amount of their MUSD, prices BTC with **Mezo's own PriceFeed**, and sends native BTC to the user's wallet. One signature is enough to get the wallet working.

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor U as User (MUSD, 0 BTC)
    participant UI as Refuel UI
    participant API as Relayer API (Next.js)
    participant R as Refuel.sol
    participant M as MUSD (ERC20Permit)
    participant PF as Mezo PriceFeed

    U->>UI: pick 1 / 2 / 5 MUSD
    UI->>API: GET /api/quote?owner&amount
    API->>R: quote(amountIn) (eth_call)
    R->>PF: fetchPrice()
    API-->>UI: btcOut, fee, permit typed data (nonce, deadline)
    U->>UI: eth_signTypedData_v4 (free, no gas)
    UI->>API: POST /api/refuel {owner, amountIn, deadline, signature}
    API->>API: verify signature, pre-checks, simulate
    API->>R: refuelWithPermit(owner, amountIn, deadline, v, r, s) (relayer pays gas)
    R->>M: permit() (try/catch), then transferFrom(owner → Refuel, amountIn)
    R->>PF: fetchPrice()
    R-->>U: native BTC (call{value: btcOut})
    API-->>UI: txHash, explorer link, btcOut
    U->>M: first transaction, paid with the new BTC
```

`btcOut = (amountIn − fee) × 1e18 / price`, where `fee = flatFee + amountIn × feeBps / 10 000`. The defaults are a 0.05 MUSD flat fee (covers relayer gas) plus 2%. MUSD is treated as $1.

## Mezo integrations used

| Integration | How Refuel uses it |
|---|---|
| **MUSD (ERC20Permit)** | Gasless approval through EIP-2612 `permit`. The domain comes from EIP-5267 `eip712Domain()` and is checked against `DOMAIN_SEPARATOR()` before the first use. |
| **PriceFeed** | BTC/USD price for every quote and refuel. The address is found on-chain through `TroveManager.priceFeed()`, with `BorrowerOperations.priceFeed()` as a fallback, so it is never hardcoded. |
| **Native BTC gas** | Refuel holds a native BTC float and pays users with `call{value: …}`. |
| **Mezo testnet** | The contract is deployed and verified on chain 31611, and the relayer uses `rpc.test.mezo.org`. |

## Security model

- **BTC only goes to the permit signer.** `refuelWithPermit` always pays `owner`, the address that signed the permit. A relayer can't redirect the payout.
- **Pulls are capped by the permit.** The contract pulls exactly `amountIn` and requires `allowance ≥ amountIn`. A relayer can't take more than the user signed for.
- **Front-running the permit doesn't help an attacker.** The `permit` call is wrapped in `try/catch`. If someone submits the permit first, the allowance already exists and the refuel still goes through.
- **Rate limits on-chain:** a 1 MUSD to 5 MUSD range per refuel, a 24h cooldown per address, 3 refuels per address in total, and a global cap of 0.002 BTC per UTC day.
- **Oracle bounds:** the contract reverts if the price is outside $1,000 to $1,000,000, which also catches a zero or broken feed.
- **Admin controls:** the contract is `Pausable` and `Ownable2Step`, and `feeBps` has a hard cap of 10%.
- **`ReentrancyGuard`** protects `refuelWithPermit`, and the code follows checks-effects-interactions. A test checks that re-entering from `receive()` is blocked.
- **Known limits:**
  - API rate limiting (5 requests per minute per IP, 3 per hour per owner) is in-memory. Serverless instances are short-lived and don't share memory, so the on-chain cooldown and caps are the real limit.
  - The owner is trusted to set parameters and can withdraw the collected MUSD and the BTC float.
  - The relayer is a hot key holding a small gas balance.

## Addresses (Mezo testnet, chainId 31611)

| What | Address |
|---|---|
| Refuel (verified on [explorer](https://explorer.test.mezo.org/address/0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912?tab=contract) and [Sourcify](https://repo.sourcify.dev/31611/0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912)) | [`0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912`](https://explorer.test.mezo.org/address/0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912) |
| MUSD | [`0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`](https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503) |
| PriceFeed (resolved through TroveManager) | [`0x86bCF0841622a5dAC14A313a15f96A95421b9366`](https://explorer.test.mezo.org/address/0x86bCF0841622a5dAC14A313a15f96A95421b9366) |
| TroveManager | [`0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0`](https://explorer.test.mezo.org/address/0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0) |
| Relayer | [`0xA2945e0841D93fDE3738397F26c0E5de6C40eC10`](https://explorer.test.mezo.org/address/0xA2945e0841D93fDE3738397F26c0E5de6C40eC10) |
| Owner / deployer | [`0x4EA77A60204b20f9aB7b1E35Bb8922606C8A0362`](https://explorer.test.mezo.org/address/0x4EA77A60204b20f9aB7b1E35Bb8922606C8A0362) |
| Live app / relayer API | https://refuel-self.vercel.app ([health](https://refuel-self.vercel.app/api/health)) |
| Deploy block | [16793627](https://explorer.test.mezo.org/block/16793627) |

`contracts/deployments/31611.json` has the machine-readable copy.

## Run it locally

Requirements: Node 20+, pnpm, and Foundry.

```bash
git clone --recursive git@github.com:Cage4D/refuel.git && cd refuel
pnpm install
cp .env.example .env   # fill in the keys; .env is gitignored
```

| Env var | Purpose |
|---|---|
| `MEZO_RPC`, `CHAIN_ID`, `EXPLORER_URL` | Network |
| `MUSD_ADDRESS`, `TROVE_MANAGER`, `BORROWER_OPERATIONS` | Mezo contracts |
| `REFUEL_ADDRESS`, `REFUEL_DEPLOY_BLOCK` | Set these after deploying |
| `DEPLOYER_PK` | Deploys and funds the contract, and becomes its owner |
| `RELAYER_PK` | A separate hot key with about 0.001 BTC for gas |
| `DEMO_FUNDER_PK` | Holds MUSD and BTC for the demo script |
| `ALLOWED_ORIGIN`, `PERMIT_TTL_SECONDS`, `RELAYER_MIN_BALANCE_WEI` | API settings |

**Contracts**

```bash
cd contracts
forge test -vvv                                 # 25 unit tests, including fuzz
MEZO_RPC=https://rpc.test.mezo.org forge test --match-contract Fork -vv   # fork smoke test
set -a; . ../.env; set +a
forge script script/Deploy.s.sol --rpc-url $MEZO_RPC --private-key $DEPLOYER_PK --broadcast
forge script script/Fund.s.sol   --rpc-url $MEZO_RPC --private-key $DEPLOYER_PK --broadcast   # FLOAT_BTC, default 0.002
forge verify-contract <REFUEL> src/Refuel.sol:Refuel --chain-id 31611 --verifier sourcify \
  --constructor-args $(cast abi-encode "constructor(address,address)" $MUSD_ADDRESS <PRICE_FEED>)
# fallback: --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/
```

Mezo's PriceFeed reads a native oracle precompile that Foundry's local EVM can't execute. The fork test gets the live price from the node with `eth_call` and mocks only that one call. MUSD, the permit domain and the transfers are all real.

**App and API**

```bash
pnpm abi    # copy the ABI from contracts/out into app/src/lib/abi
pnpm dev    # http://localhost:3000
```

| Endpoint | What it does |
|---|---|
| `GET /api/health` | Relayer and float balances, paused state, price |
| `GET /api/config` | Chain, contract, MUSD domain, limits, fees |
| `GET /api/quote?owner=0x…&amount=2` | Quote, eligibility, balances, and permit typed data to sign |
| `POST /api/refuel` | `{ owner, amountIn, deadline, signature }` → `{ txHash, explorerTxUrl, btcOut, status }` |
| `GET /api/refuels?limit=20` | Recent `Refueled` events |
| `GET /api/stats` | Totals and unique owners |

Errors always have the shape `{ error: { code, message, details? } }`, and each `message` can be shown to users as-is. See `app/src/lib/errors.ts`.

**Demo with fresh wallets**

```bash
pnpm dev &
pnpm demo --count 4 --amount 2          # --api https://<deployment> to target a hosted API
```

The script creates new keys and saves them to `scripts/.demo-wallets.json`, which is gitignored. It sends each new wallet MUSD only, with no BTC. Each wallet then refuels through the API and sends a follow-up transaction paid with its new BTC. The results table is added to the end of this README.

**Deploying to Vercel:** set the Root Directory to `app` and add the env vars above, except `DEPLOYER_PK` and `DEMO_FUNDER_PK`.

## Roadmap

1. **Mainnet launch** after a light audit-style review. Add monitoring of the float and relayer balances, and use a multisig as owner.
2. **MEZO support and float refill.** Accept MEZO wherever it supports EIP-2612, priced through Mezo pools with a TWAP. Add an owner-only `refill()` that swaps collected MUSD back into BTC through Mezo pools so the float tops itself up.
3. **Sponsor tanks.** Wallets and apps deposit MUSD to cover their users' fees, so onboarding a new user costs that user nothing.

## On-chain proof

<!-- demo-proof -->

_Run 2026-11-15T09:56:08.583Z via `pnpm demo --count 1 --amount 2 --api https://refuel-self.vercel.app` (through the hosted relayer on Vercel)_

| Wallet | Refuel tx | BTC received | Follow-up tx (own gas) |
|---|---|---|---|
| [`0xeEb0dA…0842`](https://explorer.test.mezo.org/address/0xeEb0dAD08Ea8010A166b07Bc1F79f3142bee0842) | [0x0b9b6d74…](https://explorer.test.mezo.org/tx/0x0b9b6d749b94b03ae13d1c53299769bd35fe5adb8ab117d284542662ab1ca8f9) | 0.000029236867880329 | [0x7e55d9fa…](https://explorer.test.mezo.org/tx/0x7e55d9fa91583e64ef41cccfce65ade9555890efbbf4714dba08c1045545e68f) |


_Run 2026-11-15T09:44:36.148Z via `pnpm demo --count 4 --amount 2`_

| Wallet | Refuel tx | BTC received | Follow-up tx (own gas) |
|---|---|---|---|
| [`0x0A009A…4e45`](https://explorer.test.mezo.org/address/0x0A009AA8381b550FCfD7c7eb1320490F28B14e45) | [0xa263cbe6…](https://explorer.test.mezo.org/tx/0xa263cbe6f60490ae19e4bc26170ce680a4d0425b65c530e5c4b79716a4f9cae9) | 0.00002919967026601 | [0x86bfcad2…](https://explorer.test.mezo.org/tx/0x86bfcad2a98fd4b3ca8b5a6868d3c86e2d0c990e2d02be2b904175daf48ee829) |
| [`0x71c828…E20c`](https://explorer.test.mezo.org/address/0x71c8286e1eE89a07c80025A6f8B059Fc2566E20c) | [0xd46c3e71…](https://explorer.test.mezo.org/tx/0xd46c3e71b7445d71aa7146f1f8742e0ddeb480eb6a63183116567224e2888f3e) | 0.000029191592576006 | [0x0c67c51a…](https://explorer.test.mezo.org/tx/0x0c67c51a49cfea78e7eaf54e014b98cc87d293bcf993ba538168cff3ef48b684) |
| [`0xD32339…1c5e`](https://explorer.test.mezo.org/address/0xD3233982072CA4eF1c1B0B7f8b3B088367471c5e) | [0x672cc1b2…](https://explorer.test.mezo.org/tx/0x672cc1b2e9c169943d9c77e92fee407bc468f754ee1f3612b3c12351d7692a5d) | 0.000029184305536148 | [0xe8c65c90…](https://explorer.test.mezo.org/tx/0xe8c65c90d7c38b25ad49d82764c2d4de3848b75753798966cdc8619174d9f77f) |
| [`0x908dC9…cb25`](https://explorer.test.mezo.org/address/0x908dC9328239bC5A724B83F2BBA40F1e4C13cb25) | [0x2ae1cb22…](https://explorer.test.mezo.org/tx/0x2ae1cb22b059a30b0999b0a798ca809bf831ca2f82f30d15df43f070ffd6985e) | 0.000029182068372218 | [0xd88c5d4b…](https://explorer.test.mezo.org/tx/0xd88c5d4b27b83cf4858b6d1a68ec35e92b3f1c6d2ffda2ffe76c81e9f29ad69a) |


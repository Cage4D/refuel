# Refuel: frontend handoff

This document is for whoever builds or improves the Refuel frontend. It covers everything the UI needs to work with the backend, which is already built, deployed and tested on Mezo testnet. **You shouldn't need to change any backend code, the contract or the env setup.**

- **Repo:** `github.com/Cage4D/refuel` (branch `main`). The frontend lives in `app/`.
- **Live app and API:** https://refuel-self.vercel.app (Vercel project `refuel`, scope `cage4ds-projects`). Every push to `main` redeploys automatically.
- **Network:** Mezo testnet, chainId `31611`. Test funds only; nothing is on mainnet.
- **Deadline:** the Mezo Buildathon (AKINDO Wave 2) submission is due on **15 Nov 2026, around 15:00 UTC**.

---

## 1. What the product does

A user holds **MUSD** on Mezo but has **zero BTC**, which is Mezo's gas token, so they can't send any transaction. Refuel fixes this:

1. The user picks an amount (1, 2 or 5 MUSD) and **signs an EIP-2612 permit**. This is a wallet signature, not a transaction, so it costs no gas.
2. The frontend POSTs the signature to the relayer API.
3. The relayer submits `refuelWithPermit` on-chain and pays the gas. The contract takes the MUSD, prices BTC with Mezo's PriceFeed, and sends native BTC to the user.
4. The user now has gas. The "Now try it" step proves it by sending 0.1 MUSD to themselves, paid with their own BTC.

The 60-second demo flow: connect wallet → see 0 BTC (shown in red) → pick an amount → see the quote → sign → success with an explorer link → BTC balance updates → "Now try it" succeeds.

---

## 2. What already exists in `app/`

| File | What it is | Touch it? |
|---|---|---|
| `app/src/app/page.tsx` | **The current one-page UI.** It already covers the full flow and works against the live API. This is your starting point. | **Yes, this is your main file** |
| `app/src/app/layout.tsx`, `app/src/app/globals.css` | Root layout, fonts (Geist), theme tokens with light and dark mode (Bitcoin orange `#f7931a` accent) | Yes |
| `app/src/lib/schemas.ts` | **Shared TypeScript types for every API response** (`QuoteResponse`, `RefuelResponse`, `ConfigResponse`, `RefuelEvent`, `PermitTypedData`, `Eligibility`). Import these; don't redefine them. | Read only. If you change it, the API changes too. |
| `app/src/lib/errors.ts` | The error catalog (`ERRORS`), with user-facing messages that can be shown as-is. Safe to use in client code. | Read only |
| `app/src/lib/format.ts` | `formatBtc`, `formatMusd`, `formatUsd`, `relativeTime`, `shortAddr`. Safe to use in client code. | Can extend |
| `app/src/app/api/*`, `app/src/lib/{env,chain,contracts,permit,reads,relayer,ratelimit,http}.ts` | **The backend.** They import `server-only`, so importing them into a client component breaks the build. | **Don't touch** |
| `app/src/lib/abi/refuel.ts` | Generated contract ABI | Don't edit by hand |

Stack: **Next.js 15 App Router, React 19, TypeScript, Tailwind v4, viem.** There's no wagmi; the UI talks to `window.ethereum` (EIP-1193) directly to keep things small. Package manager is **pnpm 12** (pinned in the root `package.json`).

---

## 3. API contract

All endpoints are same-origin (`/api/...`). Everything returns JSON. **Amounts are decimal strings in wei** (18 decimals), and most responses also include display-ready strings under `formatted`.

Every error response has the same shape:

```ts
{ error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }
```

`message` is written for users, so show it as-is (see §5).

### `GET /api/config`
Load this once on page load. It tells you the chain to add, the contract link and the limits.
```jsonc
{
  "chainId": 31611,
  "rpcUrl": "https://rpc.test.mezo.org",
  "explorerUrl": "https://explorer.test.mezo.org",
  "refuel": "0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912",
  "refuelUrl": "https://explorer.test.mezo.org/address/0xb5D2…",   // the "verified contract" link
  "musd": { "address": "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503", "name": "Mezo USD", "version": "1", "decimals": 18 },
  "limits": { "minAmountIn": "1000000000000000000", "maxAmountIn": "5000000000000000000",
              "cooldown": 86400, "maxRefuelsPerAddress": 3, "dailyBtcCap": "2000000000000000" },
  "fees": { "feeBps": 200, "flatFee": "50000000000000000" },
  "permitTtlSeconds": 600
}
```

### `GET /api/quote?owner=0x…&amount=2`
`amount` is a human MUSD amount (`"1"`, `"2"`, `"1.5"`) between 1 and 5. Call it when the wallet connects, when the amount changes, and **again right before signing**, so the permit's nonce and deadline are fresh.
```jsonc
{
  "amountIn": "2000000000000000000",
  "fee": "90000000000000000",
  "btcOut": "29222573642182",
  "priceUsd": "65360.43",
  "gasPrice": "146",                       // wei; used for the "≈ N transactions" estimate
  "formatted": { "amountIn": "2 MUSD", "fee": "0.09 MUSD", "feeUsd": "$0.09",
                 "btcOut": "0.00002922 BTC", "priceUsd": "$65,360.43" },
  "eligibility": { "ok": true, "reason": 0, "code": null, "nextAt": 0 },
  "musdBalance": "…",                      // the user's MUSD balance in wei
  "btcBalance": "…",                       // the user's native BTC balance in wei
  "permit": {                              // EIP-712 typed data to sign, unchanged
    "domain": { "name": "Mezo USD", "version": "1", "chainId": 31611,
                "verifyingContract": "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" },
    "types": { "Permit": [ {"name":"owner","type":"address"}, {"name":"spender","type":"address"},
                           {"name":"value","type":"uint256"}, {"name":"nonce","type":"uint256"},
                           {"name":"deadline","type":"uint256"} ] },
    "primaryType": "Permit",
    "message": { "owner": "0x…", "spender": "0xb5D2…a912", "value": "2000000000000000000",
                 "nonce": "0", "deadline": "1794737000" }
  }
}
```

The quote also returns the user's balances, so you don't need an RPC call just to show them.

`eligibility.code` is `null` when `ok` is true. Otherwise it's one of `PAUSED`, `COOLDOWN`, `MAX_REFUELS`, `FLOAT_EMPTY` or `DAILY_CAP`. For `COOLDOWN`, `nextAt` is the unix time when the user can refuel again. **When `ok` is false, disable the Refuel button and show the message.**

### `POST /api/refuel`
```jsonc
// request
{ "owner": "0x…", "amountIn": "<quote.amountIn>", "deadline": "<quote.permit.message.deadline>", "signature": "0x…(65 bytes)" }
// 200: confirmed on-chain
{ "txHash": "0x…", "explorerTxUrl": "https://explorer.test.mezo.org/tx/0x…",
  "btcOut": "29222573642182", "formatted": { "btcOut": "0.00002922 BTC" }, "status": "confirmed" }
// 202: submitted but not confirmed within 20 s. btcOut may be null.
//      Wait for the receipt yourself (viem waitForTransactionReceipt).
{ "txHash": "0x…", "explorerTxUrl": "…", "btcOut": null, "status": "submitted" }
```
Re-sending the same signature returns the same `txHash`, so retries are safe. The request takes about 2–6 s, so show a spinner.

### `GET /api/refuels?limit=20`
This is the live feed, newest first. Poll it every 20 s or so.
```jsonc
[{ "owner": "0x908d…cb25", "btcOut": "…", "amountIn": "…",
   "formatted": { "btcOut": "0.00002918 BTC", "amountIn": "2 MUSD" },
   "txHash": "0x…", "explorerTxUrl": "…", "timestamp": 1794731678 }]
```

### `GET /api/stats`
```jsonc
{ "totalRefuels": "5", "totalBtcOut": "…", "totalMusdIn": "…", "uniqueOwners": 5,
  "formatted": { "totalBtcOut": "0.00014599 BTC", "totalMusdIn": "10 MUSD" } }
```

### `GET /api/health`
For monitoring and debugging: `{ ok, chainId, relayer, relayerBalance, refuel, floatBalance, paused, priceUsd }`. If `ok` is false, refuels will fail; consider showing a banner.

---

## 4. Wallet integration: the parts that are easy to get wrong

Everything below is already implemented in `page.tsx`. Keep it working if you rewrite.

1. **Adding the chain.** Call `wallet_switchEthereumChain` first. If that throws (the chain is unknown to the wallet), call `wallet_addEthereumChain`:
   ```js
   { chainId: "0x7b7b", chainName: "Mezo Testnet",
     nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
     rpcUrls: [config.rpcUrl], blockExplorerUrls: [config.explorerUrl] }
   ```
   `0x7b7b` is 31611 in hex. Adding a chain costs no gas.
2. **Signing the permit.** Use `eth_signTypedData_v4` with `params: [account, JSON.stringify(typedData)]`. MetaMask needs `EIP712Domain` in `types`, but the API doesn't send it, so add it yourself:
   ```js
   types: { EIP712Domain: [ {name:"name",type:"string"}, {name:"version",type:"string"},
                            {name:"chainId",type:"uint256"}, {name:"verifyingContract",type:"address"} ],
            ...quote.permit.types }
   ```
   Send the rest of `quote.permit` unchanged. Don't change field order or values, or the signature won't match (`INVALID_SIGNATURE`).
3. **Always re-quote right before signing.** The permit nonce changes after every refuel, and the deadline is only 10 minutes. A stale quote fails with `INVALID_SIGNATURE` or `PERMIT_EXPIRED`.
4. **"Now try it" needs an explicit gas limit.** Mezo enforces the EIP-7623 minimum gas for calldata, but `eth_estimateGas` returns slightly less than that minimum for an ERC-20 transfer, so the transaction gets rejected. Pass `gas: 100_000n` to the transfer. Gas costs about 146 wei, so this is effectively free.
5. **User rejection.** Wallets throw error code `4001` when the user cancels. Show "Signature cancelled. Nothing happened." rather than a scary error.
6. **No wallet installed.** If `window.ethereum` is undefined, show an install prompt (MetaMask link).
7. **Account changes.** Listen for `accountsChanged` and re-quote when it fires.
8. **The "≈ N transactions" figure** is `btcOut / (gasPrice × 60,000)`. Because Mezo gas is so cheap it comes out in the millions. Label it as an estimate; the current UI adds a footnote.

---

## 5. Error codes (from `app/src/lib/errors.ts`)

Show `error.message` from the API. If you need a message client-side, for example for eligibility, import `ERRORS` from `@/lib/errors` and fill in the `{min}`, `{max}` and `{relativeTime}` placeholders.

| Code | HTTP | When | Suggested UI |
|---|---|---|---|
| `INVALID_INPUT` | 400 | Bad request body | Generic error |
| `INVALID_SIGNATURE` | 401 | Signature doesn't match the owner, or the nonce is stale | "Sign again" and re-quote |
| `PERMIT_EXPIRED` | 410 | Deadline passed | Re-quote automatically |
| `INSUFFICIENT_MUSD` | 422 | Balance is below the amount | Suggest a smaller amount |
| `AMOUNT_OUT_OF_RANGE` | 422 | Outside 1–5 MUSD | Can't happen with the chips |
| `COOLDOWN` | 429 | Refueled within the last 24 h | Show the relative time; `details.nextAt` |
| `MAX_REFUELS` | 429 | 3 lifetime refuels used | Disable |
| `RATE_LIMITED` | 429 | Too many requests | Retry later |
| `DAILY_CAP` | 503 | Global 0.002 BTC per day budget used | "Try tomorrow (UTC)" |
| `FLOAT_EMPTY` | 503 | Contract is out of BTC | Banner |
| `ORACLE_UNAVAILABLE` | 503 | PriceFeed is down or out of bounds | Retry |
| `RELAYER_LOW` | 503 | Relayer is out of gas | Banner |
| `PAUSED` | 503 | Admin paused the contract | Banner |
| `CHAIN_ERROR` | 502 | Anything else on-chain | "Nothing was taken from your wallet." |

---

## 6. Running it locally

```bash
git clone --recursive git@github.com:Cage4D/refuel.git && cd refuel
pnpm install
cp .env.example .env
pnpm dev          # http://localhost:3000
```

The app reads env from the **repo-root** `.env`; `app/next.config.ts` force-loads it.

**Easiest option for frontend-only work:** skip the local backend and point at the live API. Every endpoint works same-origin on https://refuel-self.vercel.app. Locally you can either:
- **(a)** Get a `.env` from the project owner and run the full stack. The owner holds `RELAYER_PK`; never commit it.
- **(b)** Without a `RELAYER_PK`, `/api/config`, `/api/quote`, `/api/refuels` and `/api/stats` still work, as long as `REFUEL_ADDRESS` and `REFUEL_DEPLOY_BLOCK` are set. Only `POST /api/refuel` needs the relayer key.

`.env` values that are public and safe to share:
```
MEZO_RPC=https://rpc.test.mezo.org
CHAIN_ID=31611
EXPLORER_URL=https://explorer.test.mezo.org
MUSD_ADDRESS=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
REFUEL_ADDRESS=0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912
REFUEL_DEPLOY_BLOCK=16793627
ALLOWED_ORIGIN=http://localhost:3000
PERMIT_TTL_SECONDS=600
RELAYER_MIN_BALANCE_WEI=200000000000000
```

Checks before pushing: `pnpm typecheck` and `pnpm build`. A push to `main` deploys to production on Vercel.

---

## 7. Testing the real flow in a browser

You need a wallet with **MUSD but 0 BTC**:

1. Create a brand-new MetaMask account.
2. Ask the project owner to send it about 3 MUSD from the deployer wallet. Or swap testnet BTC for MUSD at https://testnet.mezo.org and then move the BTC out, but a fresh account is simpler.
3. Open https://refuel-self.vercel.app, connect, refuel 2 MUSD, then click "Now try it".

Each wallet gets **3 refuels in total, at most one per 24 h**, so use a new account for each full test. **The browser flow has not yet been clicked through with a real wallet**; it's the main thing left to verify.

---

## 8. Constraints, and ideas if there's time

- Keep it **one page** that runs the 60-second demo. Required items:
  - the headline "Got MUSD but no BTC for gas? Refuel." and the subline
  - connect wallet
  - balances, with BTC shown red when it's 0
  - 1/2/5 chips
  - a live quote showing the BTC amount, the "≈ N transactions" estimate, the fee, and the price labelled "from Mezo PriceFeed"
  - the Refuel button with spinner and success states
  - "Now try it"
  - a footer with the live feed, the verified-contract link and a **"Testnet only"** badge
- **Never claim mainnet.** Keep the testnet badge.
- **Polish ideas:**
  - a stats strip from `/api/stats`
  - a step indicator (Sign → Relay → Received)
  - confetti or a balance animation on success
  - a mobile layout pass
  - a "How it works" disclosure
  - an "Add MUSD to wallet" button (`wallet_watchAsset`)
- **Don't add:** wagmi, RainbowKit or similar heavy wallet libraries (unless you're sure they fit the deadline), a database, auth, or mainnet chains.

## 9. Key addresses (Mezo testnet)

| What | Address |
|---|---|
| Refuel (verified) | `0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912` |
| MUSD (ERC20Permit) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` |
| Relayer | `0xA2945e0841D93fDE3738397F26c0E5de6C40eC10` |
| BTC as ERC-20 (Mezo precompile; mirrors native balance) | `0x7b7C000000000000000000000000000000000000` |

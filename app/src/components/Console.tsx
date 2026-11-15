"use client";

import type { RefObject } from "react";
import { formatUnits } from "viem";
import { formatPrice } from "@/components/Hero";
import { ERRORS } from "@/lib/errors";
import { compactCount, relativeTime, shortAddr, weiDecimal } from "@/lib/format";
import { AMOUNTS, BANNER_CODES, FLOAT_FULL, GAS_PER_TX, type RefuelState } from "@/hooks/useRefuel";

type Props = { s: RefuelState; btcRef: RefObject<HTMLSpanElement | null> };

export function Console({ s, btcRef }: Props) {
  return (
    <div className="console">
      <WalletColumn s={s} btcRef={btcRef} />
      <OrderColumn s={s} />
    </div>
  );
}

// ---------------------------------------------------------------- wallet column

function WalletColumn({ s, btcRef }: Props) {
  const { account, quote, floatBalance, dailyLeftPct, config } = s;
  const btc = quote ? BigInt(quote.btcBalance) : null;
  const musd = quote ? BigInt(quote.musdBalance) : null;
  const btcText = btc === null ? "–" : btc === 0n ? "0" : weiDecimal(btc, 8);
  const cap = config ? BigInt(config.limits.dailyBtcCap) : FLOAT_FULL;
  const tankPct = floatBalance === null ? 0 : Math.min(100, (Number(floatBalance) / Number(FLOAT_FULL)) * 100);

  return (
    <div className="wallet">
      <div className="who">
        <span>{account ? "Connected" : "Not connected"}</span>
        {account && <span className="addr num">{shortAddr(account)}</span>}
      </div>

      <div className={`readout btc ${btc === 0n ? "zero" : btc === null ? "unknown" : ""}`}>
        <span className="label">BTC for gas</span>
        {/* shrink long balances to fit the column; 0 stays at full readout-xl size */}
        <span className="val num" style={{ ["--rfit" as string]: `${170 / Math.max(btcText.length + 2, 4)}cqw` }}>
          <span ref={btcRef}>{btcText}</span>
          <small>BTC</small>
        </span>
        {btc === 0n && <span className="hint">You can&apos;t send transactions yet.</span>}
      </div>

      <div className={`readout musd ${musd === null ? "unknown" : ""}`}>
        <span className="label">MUSD</span>
        <span className="val num">
          {musd === null ? "–" : Number(formatUnits(musd, 18)).toFixed(2)}
          <small>MUSD</small>
        </span>
      </div>

      <div className="gauge">
        <div
          className="track"
          role="meter"
          aria-label="Refuel tank level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(tankPct)}
        >
          <div className="fill" style={{ width: `${tankPct}%` }} />
        </div>
        <p>
          <span className="num">
            Tank: {floatBalance === null ? "–" : weiDecimal(floatBalance, 5)} of {weiDecimal(cap, 5)} BTC
          </span>
          {dailyLeftPct !== null && <span className="num">Daily budget left: {dailyLeftPct}%</span>}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- order column

type StepState = "todo" | "now" | "done";

function Steps({ at }: { at: 0 | 1 | 2 | 3 }) {
  const labels = ["Sign the permit", "Relayer sends it", "BTC received"];
  return (
    <ol className="steps" aria-label="Progress">
      {labels.map((l, i) => {
        const st: StepState = i < at ? "done" : i === at ? "now" : "todo";
        return (
          <li
            key={l}
            className={`${st === "todo" ? "" : st} ${i === 2 && at === 3 ? "last" : ""}`}
            aria-current={st === "now" ? "step" : undefined}
          >
            {l}
          </li>
        );
      })}
    </ol>
  );
}

function Status({ title, msg }: { title: string; msg: React.ReactNode }) {
  return (
    <div className="status">
      <div className="state-title">{title}</div>
      <p className="msg">{msg}</p>
    </div>
  );
}

const FINE = "Signing is free. 3 refuels per wallet, one every 24 hours. Testnet only.";

function OrderColumn({ s }: { s: RefuelState }) {
  return (
    <div className="order" aria-live="polite">
      <OrderBody s={s} />
    </div>
  );
}

function OrderBody({ s }: { s: RefuelState }) {
  const { config, configError, health, hasWallet, account, wrongChain, quote, quoteError, phase, tryPhase, amount } = s;

  // 1. no wallet connected
  if (!account) {
    return (
      <>
        <Status
          title="Connect a wallet to see your balances"
          msg="Refuel works with any browser wallet. We'll add Mezo testnet for you."
        />
        {configError && <p className="msg err">{configError}</p>}
        <div className="spacer" />
        {hasWallet === false ? (
          <>
            <a className="btn btn-primary btn-lg" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install MetaMask
            </a>
            <p className="fine">No wallet found in this browser. Install one, then reload this page.</p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={s.connect}
              disabled={!config || s.connecting}
            >
              {s.connecting ? "Check your wallet…" : "Connect wallet"}
            </button>
            <p className="fine">
              No wallet?{" "}
              <a className="link" style={{ fontSize: "inherit" }} href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                Install MetaMask
              </a>
            </p>
          </>
        )}
        {s.connectError && <p className="msg err">{s.connectError}</p>}
      </>
    );
  }

  // 2. wrong network
  if (wrongChain && phase.kind !== "signing" && phase.kind !== "relaying") {
    return (
      <>
        <Status
          title="Switch to Mezo testnet"
          msg="Your wallet is on another network. Switching is free and takes one click."
        />
        <div className="spacer" />
        <button type="button" className="btn btn-primary btn-lg" onClick={s.switchChain}>
          Switch to Mezo testnet
        </button>
        {s.connectError && <p className="msg err">{s.connectError}</p>}
      </>
    );
  }

  // 4. waiting for signature
  if (phase.kind === "signing") {
    return (
      <>
        <Steps at={0} />
        <Status
          title="Check your wallet"
          msg="Approve the signature request. It's free and doesn't send a transaction."
        />
        <div className="spacer" />
        <button type="button" className="btn btn-primary btn-lg" disabled>
          Waiting for signature…
        </button>
        <button type="button" className="link self-start" onClick={s.cancel}>
          Cancel
        </button>
      </>
    );
  }

  // 5. relayer in flight
  if (phase.kind === "relaying") {
    return (
      <>
        <Steps at={1} />
        <Status title="Sending your refuel" msg="The relayer is paying the gas. This takes 2 to 6 seconds." />
        <div className="spacer" />
        <button type="button" className="btn btn-primary btn-lg" aria-busy="true" disabled>
          <span className="spin" aria-hidden="true" />
          Refueling
        </button>
      </>
    );
  }

  // 6. success
  if (phase.kind === "done") {
    const btcNum = phase.btcOut.replace(/\s*BTC$/, "");
    return (
      <>
        <Steps at={3} />
        <div className="status">
          <span className="msg">You received</span>
          <div className="big">
            {btcNum}
            <br />
            BTC
          </div>
          <a className="link" href={phase.res.explorerTxUrl} target="_blank" rel="noreferrer">
            View transaction on the explorer
          </a>
        </div>
        <div className="spacer" />
        {tryPhase.kind === "done" && config ? (
          <p className="msg" style={{ marginTop: 0 }}>
            Sent with your own gas.{" "}
            <a className="link" style={{ fontSize: "inherit" }} href={`${config.explorerUrl}/tx/${tryPhase.hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline btn-lg"
              onClick={s.tryIt}
              disabled={tryPhase.kind === "sending"}
            >
              {tryPhase.kind === "sending" && <span className="spin" aria-hidden="true" />}
              {tryPhase.kind === "sending" ? "Sending" : "Now try it: send 0.1 MUSD to yourself"}
            </button>
            <p className="fine">Your wallet pays this one with its own BTC.</p>
          </>
        )}
        {tryPhase.kind === "error" && <p className="msg err">{tryPhase.message}</p>}
      </>
    );
  }

  // 9. service banner: health not ok, an eligibility code from the service, or a service error from the relayer
  const eligCode = quote && !quote.eligibility.ok ? quote.eligibility.code : null;
  const bannerMsg =
    phase.kind === "error" && phase.code && BANNER_CODES.includes(phase.code)
      ? phase.message
      : eligCode && BANNER_CODES.includes(eligCode)
        ? ERRORS[eligCode].message
        : health && !health.ok
          ? healthMessage(health)
          : null;

  // 7. per-wallet limits
  const limit =
    eligCode === "COOLDOWN" ? (
      <Status
        title="You refueled recently"
        msg={`Try again ${relativeTime(quote!.eligibility.nextAt)}. Each wallet gets 3 refuels, one every 24 hours.`}
      />
    ) : eligCode === "MAX_REFUELS" ? (
      <Status title="This wallet has used all its refuels" msg="Each wallet gets 3 refuels, one every 24 hours." />
    ) : null;

  const musd = quote ? BigInt(quote.musdBalance) : null;
  const lowMusd = quote !== null && musd !== null && musd < BigInt(quote.amountIn);
  const canRefuel = !!quote && quote.eligibility.ok && !lowMusd && !bannerMsg && !limit;

  // 3 / 8 / 9 / 7: the order form
  return (
    <>
      {bannerMsg && <div className="banner">{bannerMsg}</div>}
      {limit}
      {phase.kind === "cancelled" && (
        <Status title="Signature cancelled" msg="Nothing happened, and nothing left your wallet." />
      )}

      {!limit && (
        <>
          <h3>How much MUSD to swap for gas?</h3>
          <div className="chips" role="group" aria-label="Amount">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                className="chip"
                aria-pressed={amount === a}
                onClick={() => s.chooseAmount(a)}
              >
                {a}
                <span>MUSD</span>
              </button>
            ))}
          </div>
          <Quote s={s} />
          <Steps at={0} />
        </>
      )}

      {limit && <div className="spacer" />}
      <button type="button" className="btn btn-primary btn-lg" onClick={s.refuel} disabled={!canRefuel}>
        Sign and refuel
      </button>
      {lowMusd && !limit && <p className="msg err">{ERRORS.INSUFFICIENT_MUSD.message.replace("{min}", amount)}</p>}
      {phase.kind === "error" && !(phase.code && BANNER_CODES.includes(phase.code)) && (
        <p className="msg err">{phase.message}</p>
      )}
      {quoteError && !quote && <p className="msg err">{quoteError}</p>}
      <p className="fine">{FINE}</p>
    </>
  );
}

function Quote({ s }: { s: RefuelState }) {
  const { quote, quoteError } = s;
  if (!quote) {
    return (
      <dl className="quote">
        <dt>{quoteError ? "No quote right now" : "Getting a quote…"}</dt>
        <dd />
      </dl>
    );
  }
  const cost = BigInt(quote.gasPrice) * GAS_PER_TX;
  const txs = cost > 0n ? BigInt(quote.btcOut) / cost : null;
  return (
    <dl className="quote">
      <div className="get" style={{ display: "contents" }}>
        <dt>You get</dt>
        <dd>{quote.formatted.btcOut}</dd>
      </div>
      {txs !== null && (
        <>
          <dt>Enough for about</dt>
          <dd>{compactCount(txs)} transactions*</dd>
        </>
      )}
      <dt>Fee</dt>
      <dd>{quote.formatted.fee}</dd>
      <dt>BTC price, from Mezo PriceFeed</dt>
      <dd>{formatPrice(quote.priceUsd)}</dd>
      <div className="muted">
        *Estimate at today&apos;s gas price of {quote.gasPrice} wei and 60,000 gas per transaction.
      </div>
    </dl>
  );
}

function healthMessage(h: NonNullable<RefuelState["health"]>) {
  if (h.paused) return ERRORS.PAUSED.message;
  if (BigInt(h.floatBalance) === 0n) return ERRORS.FLOAT_EMPTY.message;
  if (h.priceUsd === null) return ERRORS.ORACLE_UNAVAILABLE.message;
  return ERRORS.RELAYER_LOW.message;
}

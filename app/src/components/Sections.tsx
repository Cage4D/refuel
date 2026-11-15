"use client";

import { useEffect, useRef } from "react";
import type { ConfigResponse, RefuelEvent } from "@/lib/schemas";
import { shortAddr, timeAgo, weiDecimal } from "@/lib/format";
import type { Stats } from "@/hooks/useRefuel";
import { TestnetBadge } from "@/components/Nav";

const PRICE_FEED = "0x86bCF0841622a5dAC14A313a15f96A95421b9366";
const REFUEL = "0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912";
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const GITHUB = "https://github.com/Cage4D/refuel";

/** Adds `in` to the element once it scrolls into view (immediately with reduced motion). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

const STEPS = [
  {
    title: "You sign a permit",
    tag: "Free",
    body: (
      <>
        An EIP-2612 signature lets Refuel take the MUSD amount you picked. It&apos;s a signature, not a transaction, so
        it costs nothing.
      </>
    ),
  },
  {
    title: "The relayer sends it",
    tag: "Relayer pays gas",
    body: (
      <>
        Our relayer submits <code>refuelWithPermit</code> and pays the gas. It can&apos;t change where the BTC goes:
        only to the wallet that signed.
      </>
    ),
  },
  {
    title: "BTC lands in your wallet",
    tag: "Native BTC",
    body: (
      <>
        The contract prices BTC with Mezo&apos;s PriceFeed and sends native BTC. Your next transaction pays its own
        gas.
      </>
    ),
  },
];

export function HowItWorks() {
  const ref = useReveal<HTMLOListElement>();
  return (
    <section id="how" className="section glow-section">
      <div className="wrap">
        <hr className="rule" />
        <h2 className="h2 after-rule">
          One signature, <span className="hl">no gas</span>
        </h2>
        <ol className="how reveal" ref={ref}>
          {STEPS.map((st, i) => (
            <li key={st.title} style={{ ["--i" as string]: i }}>
              <div className="n" aria-hidden="true">
                {i + 1}
              </div>
              <span className="tag">
                <i aria-hidden="true" />
                {st.tag}
              </span>
              <h3>{st.title}</h3>
              <p>{st.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Developers({ config }: { config: ConfigResponse | null }) {
  const refuel = config?.refuel ?? REFUEL;
  const refuelUrl = config?.refuelUrl ?? `https://explorer.test.mezo.org/address/${REFUEL}`;
  const explorer = config?.explorerUrl ?? "https://explorer.test.mezo.org";
  const ref = useReveal<HTMLDivElement>();
  const contracts = [
    { k: "Refuel", v: refuel, href: refuelUrl, verified: true },
    { k: "MUSD", v: config?.musd.address ?? MUSD, href: `${explorer}/address/${config?.musd.address ?? MUSD}` },
    { k: "PriceFeed", v: PRICE_FEED, href: `${explorer}/address/${PRICE_FEED}` },
  ];
  return (
    <section id="developers" className="section glow-section glow-left">
      <div className="wrap">
        <hr className="rule" />
        <h2 className="h2 after-rule">
          Built on <span className="hl">Mezo&apos;s</span> own contracts
        </h2>
        <div className="dev reveal" ref={ref}>
          <div>
            <h3>What it touches</h3>
            <p>
              Refuel reads Mezo&apos;s PriceFeed, pulls MUSD through its built-in permit, and pays out native BTC. The
              contract is verified, so you can read every line.
            </p>
            <ul className="contracts">
              {contracts.map((c, i) => (
                <li key={c.k} style={{ ["--i" as string]: i }}>
                  <span className="ck">
                    <i aria-hidden="true" />
                    {c.k}
                    {c.verified && <span className="verified">Verified</span>}
                  </span>
                  <a className="cv num" href={c.href} target="_blank" rel="noreferrer">
                    {c.v}
                  </a>
                </li>
              ))}
              <li style={{ ["--i" as string]: 3 }}>
                <span className="ck">
                  <i aria-hidden="true" />
                  Network
                </span>
                <span className="cv">Mezo testnet, chain {config?.chainId ?? 31611}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3>Refuel your own users</h3>
            <p>Quote, have the user sign, then post the signature. Same API this page uses.</p>
            <div className="term">
              <div className="term-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>refuel api</span>
              </div>
              <pre className="code">
                <span className="c"># 1. quote and get the permit to sign</span>
                {"\n"}
                <span className="m">GET</span>
                {"  /api/quote?owner=0x…&amount=2\n"}
                <span className="c"># 2. send the signature</span>
                {"\n"}
                <span className="m">POST</span>
                {" /api/refuel\n{ "}
                <span className="k">&quot;owner&quot;</span>: <span className="s">&quot;0x…&quot;</span>,{" "}
                <span className="k">&quot;amountIn&quot;</span>: <span className="s">&quot;2000000000000000000&quot;</span>
                {",\n  "}
                <span className="k">&quot;deadline&quot;</span>: <span className="s">&quot;1794737000&quot;</span>,{" "}
                <span className="k">&quot;signature&quot;</span>: <span className="s">&quot;0x…&quot;</span>
                {" }"}
                <span className="caret" aria-hidden="true" />
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Feed({ stats, events }: { stats: Stats | null; events: RefuelEvent[] }) {
  const rows = events.slice(0, 8);
  return (
    <section id="feed" className="section">
      <div className="wrap">
        <hr className="rule" />
        <h2 className="h2 after-rule">Wallets refueled so far</h2>
        <div className="stats">
          <div className="stat">
            <div className="v num">{stats ? stats.totalRefuels : "–"}</div>
            <div className="k">Refuels</div>
          </div>
          <div className="stat">
            <div className="v num">{stats ? stats.uniqueOwners : "–"}</div>
            <div className="k">Wallets unstuck</div>
          </div>
          <div className="stat">
            <div className="v btc num">{stats ? weiDecimal(BigInt(stats.totalBtcOut), 6) : "–"}</div>
            <div className="k">BTC sent</div>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="empty-feed">No refuels yet.</p>
        ) : (
          <div className="feed-wrap">
          <table className="feed-table">
            <thead>
              <tr>
                <th scope="col">Wallet</th>
                <th scope="col">Paid</th>
                <th scope="col">Received</th>
                <th scope="col" className="hide-sm">When</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.txHash}>
                  <td>{shortAddr(e.owner)}</td>
                  <td>{e.formatted.amountIn}</td>
                  <td className="btc">{e.formatted.btcOut}</td>
                  <td className="hide-sm">{timeAgo(e.timestamp)}</td>
                  <td>
                    <a href={e.explorerTxUrl} target="_blank" rel="noreferrer">
                      {shortAddr(e.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function Footer({ config }: { config: ConfigResponse | null }) {
  return (
    <footer className="footer">
      <div className="wrap">
        <TestnetBadge label="Testnet only" />
        <span>Built for the Mezo Buildathon</span>
        <span className="sp">
          <a href={config?.refuelUrl ?? `https://explorer.test.mezo.org/address/${REFUEL}`} target="_blank" rel="noreferrer">
            Verified contract
          </a>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}

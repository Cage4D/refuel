import type { ConfigResponse, RefuelEvent } from "@/lib/schemas";
import { shortAddr, timeAgo, weiDecimal } from "@/lib/format";
import type { Stats } from "@/hooks/useRefuel";
import { TestnetBadge } from "@/components/Nav";

const PRICE_FEED = "0x86bCF0841622a5dAC14A313a15f96A95421b9366";
const REFUEL = "0xb5D2f0E4A19bfdd422Ec285BD82F951583D5a912";
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const GITHUB = "https://github.com/Cage4D/refuel";

export function HowItWorks() {
  return (
    <section id="how" className="section">
      <div className="wrap">
        <hr className="rule" />
        <h2 className="h2 after-rule">One signature, no gas</h2>
        <ol className="how">
          <li>
            <div className="n" aria-hidden="true">1</div>
            <h3>You sign a permit</h3>
            <p>
              An EIP-2612 signature lets Refuel take the MUSD amount you picked. It&apos;s a signature, not a
              transaction, so it costs nothing.
            </p>
          </li>
          <li>
            <div className="n" aria-hidden="true">2</div>
            <h3>The relayer sends it</h3>
            <p>
              Our relayer submits <code>refuelWithPermit</code> and pays the gas. It can&apos;t change where the BTC
              goes: only to the wallet that signed.
            </p>
          </li>
          <li>
            <div className="n" aria-hidden="true">3</div>
            <h3>BTC lands in your wallet</h3>
            <p>
              The contract prices BTC with Mezo&apos;s PriceFeed and sends native BTC. Your next transaction pays its
              own gas.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}

export function Developers({ config }: { config: ConfigResponse | null }) {
  const refuel = config?.refuel ?? REFUEL;
  const refuelUrl = config?.refuelUrl ?? `https://explorer.test.mezo.org/address/${REFUEL}`;
  return (
    <section id="developers" className="section">
      <div className="wrap">
        <hr className="rule" />
        <h2 className="h2 after-rule">Built on Mezo&apos;s own contracts</h2>
        <div className="dev">
          <div>
            <h3>What it touches</h3>
            <p>
              Refuel reads Mezo&apos;s PriceFeed, pulls MUSD through its built-in permit, and pays out native BTC. The
              contract is verified, so you can read every line.
            </p>
            <dl className="kv num">
              <dt>Refuel</dt>
              <dd>
                <a href={refuelUrl} target="_blank" rel="noreferrer">
                  {refuel}
                </a>
              </dd>
              <dt>MUSD</dt>
              <dd>{config?.musd.address ?? MUSD}</dd>
              <dt>PriceFeed</dt>
              <dd>{PRICE_FEED}</dd>
              <dt>Network</dt>
              <dd>Mezo testnet, chain {config?.chainId ?? 31611}</dd>
            </dl>
          </div>
          <div>
            <h3>Refuel your own users</h3>
            <p>Quote, have the user sign, then post the signature. Same API this page uses.</p>
            <pre className="code">
              <span className="c"># 1. quote and get the permit to sign</span>
              {"\nGET  /api/quote?owner=0x…&amount=2\n"}
              <span className="c"># 2. send the signature</span>
              {`\nPOST /api/refuel\n{ "owner": "0x…", "amountIn": "2000000000000000000",\n  "deadline": "1794737000", "signature": "0x…" }`}
            </pre>
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

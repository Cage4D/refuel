import { shortAddr } from "@/lib/format";

export function BrandMark() {
  return (
    <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="none" stroke="#ecece6" strokeWidth="1.2" />
      <path d="M1 13.5 A10 10 0 0 0 21 13.5 Z" fill="#f7931a" />
    </svg>
  );
}

export function TestnetBadge({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`badge ${className}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

type Props = { account: string | null; hasWallet: boolean | null; onConnect: () => void };

export function Nav({ account, hasWallet, onConnect }: Props) {
  return (
    <header className="wrap nav">
      <a className="brand" href="#" aria-label="Refuel home">
        <BrandMark />
        Refuel
      </a>
      <nav className="nav-links" aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#developers">For developers</a>
        <a href="#feed">Live feed</a>
      </nav>
      <div className="nav-actions">
        <TestnetBadge label="Mezo testnet" className="hide-sm" />
        {account ? (
          <a className="btn btn-outline btn-sm num" href="#refuel">
            {shortAddr(account)}
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              document.getElementById("refuel")?.scrollIntoView({ block: "start" });
              if (hasWallet) onConnect();
            }}
          >
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}

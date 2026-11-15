"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { weiDecimal } from "@/lib/format";

const ParticleSphere = dynamic(() => import("@/components/ParticleSphere"), { ssr: false });

type Props = {
  floatBalance: bigint | null;
  priceUsd: string | null;
  showNotes: boolean;
  tankFill: number;
  burstKey: number;
  streamTarget: RefObject<HTMLSpanElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
};

export function formatPrice(decimal: string) {
  const n = Number(decimal);
  return Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : decimal;
}

export function Hero({ floatBalance, priceUsd, showNotes, tankFill, burstKey, streamTarget, stageRef }: Props) {
  return (
    <div className="wrap hero">
      <div className="hero-copy">
        <h1 className="display-xl">
          Got MUSD but
          <br /> no BTC for gas?
          <br /> Refuel.
        </h1>
        <p className="lead">
          Sign once, with no gas needed, and get enough BTC to use Mezo. The relayer pays for the transaction; you pay a
          few cents in MUSD.
        </p>
        <div className="hero-cta">
          <ShinyButton
            label="Refuel my wallet"
            onClick={() => document.getElementById("refuel")?.scrollIntoView({ block: "start" })}
          />
          <a className="link" href="#how">
            How it works
          </a>
        </div>
      </div>

      <div className="stage" ref={stageRef}>
        <ParticleSphere
          className="absolute inset-0 h-full w-full"
          fill={tankFill}
          burstKey={burstKey}
          streamTarget={streamTarget}
        />
        {showNotes && (
          <>
            <svg className="leader" viewBox="0 0 700 760" preserveAspectRatio="none" aria-hidden="true">
              <path d="M120 170 C 170 160, 210 190, 250 235" />
              <circle cx="250" cy="235" r="2.5" />
              <path d="M560 690 C 540 660, 520 640, 480 620" />
              <circle cx="480" cy="620" r="2.5" />
            </svg>
            {floatBalance !== null && (
              <p className="note" style={{ left: "2%", top: "15%" }}>
                <b className="btc num">{weiDecimal(floatBalance, 5)} BTC</b>in the tank right now
              </p>
            )}
            {priceUsd && (
              <p className="note" style={{ right: "6%", bottom: "2%", textAlign: "right" }}>
                <b className="num">{formatPrice(priceUsd)}</b>BTC price from Mezo PriceFeed
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

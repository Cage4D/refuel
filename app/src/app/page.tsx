"use client";

import { useEffect, useRef, useState } from "react";
import { Console } from "@/components/Console";
import { Cursor } from "@/components/Cursor";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Developers, Feed, Footer, HowItWorks } from "@/components/Sections";
import { useRefuel } from "@/hooks/useRefuel";

export default function Home() {
  const s = useRefuel();
  const btcRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [burstKey, setBurstKey] = useState(0);
  // keep the sphere at its last known level if health fails
  const [tankFill, setTankFill] = useState(0);
  useEffect(() => {
    if (s.health) setTankFill(s.tankFill);
  }, [s.health, s.tankFill]);

  // Success moment: fire the sphere's stream toward the BTC readout, but only when
  // the sphere is on screen (it's paused, and the stream invisible, otherwise).
  useEffect(() => {
    if (s.successCount === 0) return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) setBurstKey((k) => k + 1);
  }, [s.successCount]);

  return (
    <>
      <Nav account={s.account} hasWallet={s.hasWallet} onConnect={s.connect} />
      <main>
        <Hero
          floatBalance={s.floatBalance}
          priceUsd={s.health?.priceUsd ?? null}
          showNotes={!s.healthFailed && !!s.health}
          tankFill={tankFill}
          burstKey={burstKey}
          streamTarget={btcRef}
          stageRef={stageRef}
        />

        <section id="refuel" className="section">
          <div className="wrap">
            <h2 className="h2">Fill up in under a minute</h2>
            <p className="sub">Pick an amount and sign. Your wallet never needs BTC to start.</p>
            <Console s={s} btcRef={btcRef} />
          </div>
        </section>

        <HowItWorks />
        <Developers config={s.config} />
        <Feed stats={s.stats} events={s.events} />
      </main>
      <Footer config={s.config} />
      <Cursor />
    </>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PartTree } from "@/components/organigram/PartTree";
import { UnitDetail } from "@/components/organigram/UnitDetail";
import { Icicle } from "@/components/organigram/layouts/Icicle";
import { SectionTreemap } from "@/components/organigram/layouts/SectionTreemap";
import { Sunburst } from "@/components/organigram/layouts/Sunburst";
import { dataUrl, fmt } from "@/lib/organigram";
import type { Unit } from "@/types/organigram";

const YEAR = 2026;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

function Layout({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="text-xl font-bold text-foreground">
        <span className="text-muted-foreground">{n} · </span>
        {title}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

export default function Home() {
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [selected, setSelected] = useState<Unit | null>(null);

  useEffect(() => {
    fetch(dataUrl(YEAR))
      .then((r) => r.json())
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  return (
    <main className="mx-auto max-w-[1400px] bg-background px-4 py-6 sm:px-6">
      <Image
        src={`${basePath}/images/UN_Logo_Stacked_Colour_English.svg`}
        alt="UN Logo"
        width={200}
        height={48}
        className="mb-6 h-9 w-auto select-none sm:h-10"
        draggable={false}
      />
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">UN Secretariat organigrams</h1>
        <p className="mt-1 text-foreground">
          Organizational units and their posts, from the Programme Budget for {YEAR}.
        </p>
        {units && (
          <p className="mt-1 text-sm text-muted-foreground">
            {fmt(units.length)} units · {fmt(units.reduce((s, u) => s + u.posts_total, 0))} posts ·{" "}
            {new Set(units.map((u) => u.section)).size} sections. Coloured by budget part; area /
            length = posts. Layout comparison ↓
          </p>
        )}
      </header>

      {units === null ? (
        <p className="text-muted-foreground">Loading organigram data…</p>
      ) : (
        <>
          <Layout n={1} title="Part → Section treemap" hint="Sections grouped into ordered part columns; click a section to zoom to its units.">
            <SectionTreemap units={units} onSelectUnit={setSelected} />
          </Layout>
          <Layout n={2} title="Icicle — Part | Section | Unit" hint="Click a part to focus its sections, then a section to see its units at full size.">
            <Icicle units={units} onSelectUnit={setSelected} />
          </Layout>
          <Layout n={3} title="Sunburst" hint="Rings: parts → sections → units, angle ∝ posts. Click a segment to zoom in; click the centre to zoom out.">
            <div className="flex justify-center">
              <Sunburst units={units} onSelectUnit={setSelected} />
            </div>
          </Layout>

          <h2 className="mb-3 mt-4 text-xl font-bold text-foreground">Reporting structure</h2>
          <PartTree units={units} onSelect={setSelected} />
        </>
      )}

      {selected && <UnitDetail unit={selected} year={YEAR} onClose={() => setSelected(null)} />}
    </main>
  );
}

"use client";

import { useState } from "react";
import StationAutocomplete from "@/components/StationAutocomplete";
import type { Station } from "@/lib/railradar";

export default function Home() {
  const [home, setHome] = useState<Station | null>(null);
  const [college, setCollege] = useState<Station | null>(null);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 p-6 dark:bg-black">
      <main className="w-full max-w-md space-y-6 pt-16">
        <h1 className="text-xl font-semibold">
          Class Commute (autocomplete smoke test)
        </h1>
        <StationAutocomplete
          label="Home station"
          placeholder="e.g. Borivali"
          value={home}
          onChange={setHome}
        />
        <StationAutocomplete
          label="College station"
          placeholder="e.g. Churchgate"
          value={college}
          onChange={setCollege}
        />
        <pre className="rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          {JSON.stringify({ home, college }, null, 2)}
        </pre>
      </main>
    </div>
  );
}

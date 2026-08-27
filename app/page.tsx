"use client";

import { useId, useState } from "react";
import StationAutocomplete from "@/components/StationAutocomplete";
import BufferStepper from "@/components/BufferStepper";
import ResultCard from "@/components/ResultCard";
import type { Station } from "@/lib/railradar";
import type { TrainResult } from "@/lib/bestTrain";

interface BestTrainResponse {
  from: { code: string; name: string };
  to: { code: string; name: string };
  best: TrainResult;
  alternatives: TrainResult[];
}

interface FieldErrors {
  home?: boolean;
  college?: boolean;
  time?: boolean;
}

type Status = "idle" | "loading" | "success" | "error";

export default function Home() {
  const [home, setHome] = useState<Station | null>(null);
  const [college, setCollege] = useState<Station | null>(null);
  const [swapCount, setSwapCount] = useState(0);
  const [classStartTime, setClassStartTime] = useState("");
  const [bufferMinutes, setBufferMinutes] = useState(20);

  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [result, setResult] = useState<BestTrainResponse | null>(null);

  const timeInputId = useId();

  function swapStations() {
    setHome(college);
    setCollege(home);
    setSwapCount((c) => c + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors: FieldErrors = {
      home: !home,
      college: !college,
      time: !classStartTime,
    };
    setFieldErrors(errors);
    if (errors.home || errors.college || errors.time) return;

    setStatus("loading");
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const res = await fetch("/api/best-train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCode: home!.code,
          toCode: college!.code,
          classStartTime,
          bufferMinutes,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
        setErrorKind(data.kind ?? null);
        return;
      }

      setResult(data);
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage(
        "Couldn't reach the server. Check your connection and try again."
      );
      setErrorKind("NETWORK");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 pb-16">
      <header className="w-full max-w-md pt-10 pb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Class Commute
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          The latest local that still gets you there on time.
        </p>
      </header>

      <main className="w-full max-w-md">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="relative space-y-4">
            <StationAutocomplete
              key={`home-${swapCount}`}
              label="Home station"
              placeholder="e.g. Borivali"
              value={home}
              onChange={(s) => {
                setHome(s);
                if (s) setFieldErrors((f) => ({ ...f, home: false }));
              }}
              invalid={fieldErrors.home}
            />

            <div className="flex justify-center">
              <button
                type="button"
                onClick={swapStations}
                aria-label="Swap home and college stations"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition-transform hover:text-teal-600 active:scale-90 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 3v11M6 14 3 11m3 3 3-3M14 17V6m0 0 3 3m-3-3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <StationAutocomplete
              key={`college-${swapCount}`}
              label="College station"
              placeholder="e.g. Churchgate"
              value={college}
              onChange={(s) => {
                setCollege(s);
                if (s) setFieldErrors((f) => ({ ...f, college: false }));
              }}
              invalid={fieldErrors.college}
            />
          </div>

          {(fieldErrors.home || fieldErrors.college) && (
            <p className="text-xs text-red-600" role="alert">
              Please pick both stations from the suggestions.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={timeInputId}
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Class start time
              </label>
              <input
                id={timeInputId}
                type="time"
                value={classStartTime}
                onChange={(e) => {
                  setClassStartTime(e.target.value);
                  if (e.target.value) setFieldErrors((f) => ({ ...f, time: false }));
                }}
                aria-invalid={fieldErrors.time || undefined}
                className={`h-12 w-full rounded-xl border bg-white px-3 text-base tabular-nums text-neutral-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/30 dark:bg-neutral-900 dark:text-neutral-100 ${
                  fieldErrors.time
                    ? "border-red-500"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              />
              {fieldErrors.time && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  Required
                </p>
              )}
            </div>

            <BufferStepper value={bufferMinutes} onChange={setBufferMinutes} />
          </div>

          <button
            type="submit"
            disabled={status === "loading"}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-teal-700 text-base font-semibold text-white transition-colors hover:bg-teal-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "loading" ? "Finding your train…" : "Find my train"}
          </button>
        </form>

        <div aria-live="polite" className="mt-6 space-y-3">
          {status === "loading" && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800"
                />
              ))}
            </div>
          )}

          {status === "error" && errorMessage && (
            <div
              role="alert"
              className={`rounded-2xl border p-4 text-sm ${
                errorKind === "RATE_LIMIT"
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300"
              }`}
            >
              {errorMessage}
            </div>
          )}

          {status === "success" && result && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {result.from.name} → {result.to.name}
              </p>
              <ResultCard train={result.best} variant="best" />

              {result.alternatives.length > 0 && (
                <div className="pt-2">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Earlier backups
                  </h2>
                  <div className="space-y-2">
                    {result.alternatives.map((alt) => (
                      <ResultCard key={alt.trainNumber} train={alt} variant="alt" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

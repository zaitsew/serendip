"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const SOURCES: Array<[string, string]> = [["serendip", "Serendip"], ["netflix", "Netflix home"], ["zapping", "TV zapping"], ["other", "Other"]];

interface Evening { day: string; watched: string; source: string; enjoyment: number | null; minutesToChoose: number | null }

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LogForm({ initialDay }: { initialDay: string | null }) {
  const [day, setDay] = useState(() => initialDay ?? today());
  const [watched, setWatched] = useState("");
  const [source, setSource] = useState("serendip");
  const [enjoyment, setEnjoyment] = useState<number | null>(null);
  const [minutes, setMinutes] = useState("");
  const [list, setList] = useState<Evening[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/evening").then((r) => r.json()).then((b: { evenings: Evening[] }) => setList(b.evenings)).catch(() => undefined);
  }, []);
  useEffect(() => {
    fetch("/api/evening").then((r) => r.json()).then((b: { evenings: Evening[] }) => setList(b.evenings)).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/evening", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day, watched, source, enjoyment, minutesToChoose: minutes === "" ? null : Number(minutes) }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ ok: false, text: (body as { error?: string }).error ?? "Could not save." }); return; }
    setMsg({ ok: true, text: "Logged." });
    setWatched(""); setEnjoyment(null); setMinutes("");
    load();
  };

  return (
    <main className="page">
      <header>
        <h1>Evening log</h1>
        <p className="muted">One line per evening. After ten of them we can tell whether zapping here beats the Netflix home screen.</p>
      </header>
      <nav className="nav"><Link href="/">Home</Link><Link href="/tv">Channels</Link></nav>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="day">Evening</label>
          <input id="day" type="date" suppressHydrationWarning value={day} onChange={(e) => setDay(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="watched">What did you watch?</label>
          <input id="watched" type="text" value={watched} onChange={(e) => setWatched(e.target.value)} required maxLength={200} />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600 }}>From where?</legend>
          <div className="row">
            {SOURCES.map(([v, n]) => (
              <label key={v} className={`chip${source === v ? " on" : ""}`}>
                <input type="radio" name="source" value={v} checked={source === v} onChange={() => setSource(v)} />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600 }}>Enjoyment</legend>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`btn${enjoyment === n ? " btn-primary" : ""}`} aria-pressed={enjoyment === n} onClick={() => setEnjoyment(n)}>{n}</button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="mins">Minutes it took to choose</label>
          <input id="mins" type="number" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn btn-primary" type="submit">Save evening</button>
          {msg ? <span className={`notice ${msg.ok ? "notice-good" : "notice-error"}`} role="status">{msg.text}</span> : null}
        </div>
      </form>
      <section className="card" aria-label="Past evenings">
        <h2>Past evenings</h2>
        {list.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <ul className="list">
            {list.map((e) => (
              <li key={e.day}>
                <span>{e.day} · {e.watched}</span>
                <span className="muted">{e.source}{e.enjoyment ? ` · ${e.enjoyment}/5` : ""}{e.minutesToChoose != null ? ` · ${e.minutesToChoose} min` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

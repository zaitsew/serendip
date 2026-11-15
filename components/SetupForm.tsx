"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Brief { id: number; title: string; year: number | null }
interface Hit extends Brief { genres: string[] }
interface Provider { id: number; name: string }
interface State {
  mode: "tmdb" | "sample";
  providers: Provider[];
  prefs: { providers: number[]; languages: string[]; subtitles: boolean };
  configured: boolean;
  loved: Brief[];
  disliked: Brief[];
  counts: { seeds: number; seen: number };
  unmatched: Array<{ title: string; year: number | null; source: string }>;
}
interface Report { read: number; matched: number; seeds: number; skippedEpisodes?: number; unmatched: Array<{ title: string; year: number | null }>; truncated: boolean }

const LANGUAGES: Array<[string, string]> = [
  ["en", "English"], ["es", "Spanish"], ["ca", "Catalan"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
  ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["cn", "Cantonese"], ["ru", "Russian"], ["pl", "Polish"],
];
const MAX_LOVED = 15;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Error ${r.status}`);
  return body as T;
}

function FilmPicker({ label, role, items, max, onChange }: { label: string; role: "seed" | "dislike"; items: Brief[]; max?: number; onChange: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.results)).catch((e: Error) => setMsg(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const mark = async (filmId: number, remove = false) => {
    setMsg(null);
    try {
      await api("/api/marks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filmId, role, remove }) });
      if (!remove) { setQ(""); setHits([]); }
      onChange();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const shownHits = q.trim().length >= 2 ? hits : [];
  const full = max !== undefined && items.length >= max;
  return (
    <section className="card" aria-label={label}>
      <h2>{label}{max ? ` (${items.length} of ${max})` : ""}</h2>
      <div className="field">
        <label htmlFor={`q-${role}`}>Search a film</label>
        <input id={`q-${role}`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arrival, Parasite…" disabled={full} autoComplete="off" />
      </div>
      {msg ? <p className="notice notice-error" role="alert">{msg}</p> : null}
      {shownHits.length ? (
        <div className="hits">
          {shownHits.map((h) => (
            <button key={h.id} type="button" className="btn hit" onClick={() => mark(h.id)}>
              {h.title}{h.year ? ` (${h.year})` : ""}{h.genres.length ? ` · ${h.genres.join(", ")}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="list">
        {items.map((f) => (
          <li key={f.id}>
            <span>{f.title}{f.year ? ` (${f.year})` : ""}</span>
            <button type="button" className="btn" onClick={() => mark(f.id, true)} aria-label={`Remove ${f.title}`}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Importer({ title, hint, url, accept, onDone }: { title: string; hint: string; url: string; accept: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true); setErr(null); setReport(null);
    try {
      const form = new FormData();
      form.set("file", file);
      setReport(await api<Report>(url, { method: "POST", body: form }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <input type="file" accept={accept} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} aria-label={title} />
      {busy ? <p className="notice">Matching titles with TMDB. This can take a minute.</p> : null}
      {err ? <p className="notice notice-error" role="alert">{err}</p> : null}
      {report ? (
        <div className="notice notice-good" role="status">
          <p>Read {report.read}, matched {report.matched}{report.seeds ? `, ${report.seeds} taste seeds` : ""}{report.skippedEpisodes ? `, skipped ${report.skippedEpisodes} episode lines` : ""}.{report.truncated ? " Only the first 2000 were matched." : ""}</p>
          {report.unmatched.length ? (
            <details>
              <summary>{report.unmatched.length} not matched</summary>
              <ul className="list">{report.unmatched.map((u, i) => <li key={i}><span>{u.title}{u.year ? ` (${u.year})` : ""}</span></li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function SetupForm() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [providers, setProviders] = useState<number[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [subtitles, setSubtitles] = useState(true);

  const load = useCallback(async () => {
    try {
      setS(await api<State>("/api/state"));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api<State>("/api/state")
      .then((st) => { setS(st); setProviders(st.prefs.providers); setLanguages(st.prefs.languages); setSubtitles(st.prefs.subtitles); })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setErr(null); setSaved(false);
    try {
      await api("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ providers, languages, subtitles }) });
      setSaved(true);
      void load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (err && !s) return <main className="page"><p className="notice notice-error" role="alert">{err}</p></main>;
  if (!s) return <main className="page"><p>Loading…</p></main>;

  return (
    <main className="page">
      <header>
        <h1>Setup</h1>
        <p className="muted">Services in Spain, languages, and the films you love. {s.mode === "sample" ? "You are on the sample catalog, so only 32 films exist." : null}</p>
      </header>
      <nav className="nav"><Link href="/">Home</Link><Link href="/tv">Channels</Link></nav>

      <section className="card" aria-label="Services">
        <h2>Your services in Spain</h2>
        <div className="row">
          {s.providers.slice(0, 40).map((p) => (
            <label key={p.id} className={`chip${providers.includes(p.id) ? " on" : ""}`}>
              <input type="checkbox" checked={providers.includes(p.id)} onChange={() => setProviders(toggle(providers, p.id))} />
              {p.name}
            </label>
          ))}
        </div>
      </section>

      <section className="card" aria-label="Languages">
        <h2>Languages you watch in</h2>
        <div className="row">
          {LANGUAGES.map(([code, name]) => (
            <label key={code} className={`chip${languages.includes(code) ? " on" : ""}`}>
              <input type="checkbox" checked={languages.includes(code)} onChange={() => setLanguages(toggle(languages, code))} />
              {name}
            </label>
          ))}
        </div>
        <label className="chip">
          <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
          Also show films in other languages (with subtitles)
        </label>
      </section>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save} disabled={providers.length === 0}>Save services and languages</button>
        {saved ? <span className="notice notice-good" role="status">Saved. <Link href="/tv">Open the channels</Link></span> : null}
        {err ? <span className="notice notice-error" role="alert">{err}</span> : null}
      </div>

      <FilmPicker label="Films you love" role="seed" items={s.loved} max={MAX_LOVED} onChange={() => load()} />
      <FilmPicker label="Films you did not like (optional)" role="dislike" items={s.disliked} onChange={() => load()} />

      <Importer title="Letterboxd export (ZIP)" hint="On Letterboxd: Settings, Data, Export your data. Ratings of 4 or more and your likes become taste seeds; everything watched counts as seen." url="/api/import/letterboxd" accept=".zip,application/zip" onDone={() => load()} />
      <Importer title="Netflix viewing activity (CSV)" hint="On Netflix: Account, Profile, Viewing activity, Download all. Titles become already seen; series episodes are skipped." url="/api/import/netflix" accept=".csv,text/csv" onDone={() => load()} />

      <p className="muted">{s.counts.seeds} taste seeds and {s.counts.seen} films seen so far.</p>
    </main>
  );
}

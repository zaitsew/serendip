"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MAX_FIELDS } from "../src/core/detour";

export interface Bar { label: string; share: number }
interface ChannelBar { channel: string; share: number }
export interface Cluster {
  mode: "topics" | "channels" | "none";
  watched: number;
  analyzed: number;
  headline: string | null;
  topics: Bar[];
  categories: Bar[];
  channels: ChannelBar[];
  needsAnalysis: boolean;
}
interface Pick { key: string; videoId: string | null; title: string; channel: string; field: string; why: string; seconds: number | null; placeholder: boolean }
interface Saved { videoId: string; title: string | null; channelTitle: string | null; field: string | null }
export interface DetourState {
  keyed: boolean;
  oauth: { configured: boolean; connected: boolean; redirectUri: string | null; playlist: { at: number; ok: boolean; added: number; removed: number; error: string | null } | null };
  cluster: Cluster;
  fields: string[];
  suggestions: Array<{ label: string; query: string; share: number | null }>;
  picks: { sample: boolean; day: string | null; builtAt: number | null; note: string | null; items: Pick[] };
  budget: { used: number; limit: number; units: number };
  saved: Saved[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Error ${r.status}`);
  return body as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function Bars({ rows }: { rows: Array<{ label: string; share: number }> }) {
  return (
    <ul className="bars" aria-label="Share of your history">
      {rows.map((r) => (
        <li key={r.label} className="bar">
          <span className="bar-label" title={r.label}>{r.label}</span>
          <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} /></span>
          <span className="bar-pct">{pct(r.share)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ClusterCard({ cluster, keyed }: { cluster: Cluster; keyed: boolean }) {
  if (cluster.mode === "none") return <p className="muted">No history imported yet.</p>;
  return (
    <div className="stack">
      {cluster.headline ? <p className="headline">{cluster.headline}</p> : null}
      {cluster.mode === "topics" ? (
        <>
          <Bars rows={cluster.topics} />
          {cluster.categories.length ? (
            <details>
              <summary>YouTube categories</summary>
              <Bars rows={cluster.categories} />
            </details>
          ) : null}
          <p className="muted">One video can count in several topics, so the shares add up to more than 100 %.{cluster.needsAnalysis ? " Some videos are not analysed yet." : ""}</p>
        </>
      ) : (
        <>
          <Bars rows={cluster.channels.map((c) => ({ label: c.channel, share: c.share }))} />
          <p className="muted">{keyed ? "Topics are not read yet. Press Analyze." : "Clustered by channel only. Add YOUTUBE_API_KEY to read topics (docs/GETTING-STARTED.md)."}</p>
        </>
      )}
    </div>
  );
}

interface TakeoutReport { rows: number; videos: number; channels: number; skipped: { ads: number; music: number; removed: number; other: number }; analysis: { calls: number; fetched: number; cached: number; missing: number; stoppedBy: string | null } | null }

export function TakeoutImporter({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<TakeoutReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true); setErr(null); setReport(null);
    try {
      const form = new FormData();
      form.set("file", file);
      setReport(await api<TakeoutReport>("/api/import/takeout", { method: "POST", body: form }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} aria-label="YouTube watch-history.json" />
      {busy ? <p className="notice">Reading the history. With a YouTube key this also fetches topics and can take a minute.</p> : null}
      {err ? <p className="notice notice-error" role="alert">{err}</p> : null}
      {report ? (
        <p className="notice notice-good" role="status">
          Read {report.rows.toLocaleString("en-US")} rows: {report.videos.toLocaleString("en-US")} videos from {report.channels.toLocaleString("en-US")} channels. Ignored {report.skipped.ads} ads, {report.skipped.music} YouTube Music, {report.skipped.removed} removed videos, {report.skipped.other} other rows.
          {report.analysis ? ` Topics fetched for ${report.analysis.fetched} videos (${report.analysis.calls} API calls).` : ""}
          {report.analysis?.stoppedBy ? ` Stopped early: ${report.analysis.stoppedBy}.` : ""}
        </p>
      ) : null}
    </>
  );
}

/** The /setup section: import the history and see the cluster. */
export function TakeoutSection() {
  const [s, setS] = useState<DetourState | null>(null);
  const load = useCallback(() => { api<DetourState>("/api/detour/state").then(setS).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="card" aria-label="YouTube history">
      <h2>YouTube watch history (Takeout)</h2>
      <p className="muted">Upload <code>watch-history.json</code> from Google Takeout (YouTube, history, JSON). It shows the cluster your recommendations are stuck in. <Link href="/detour">Open the Detour page</Link></p>
      <TakeoutImporter onDone={load} />
      {s && s.cluster.mode !== "none" ? <ClusterCard cluster={s.cluster} keyed={s.keyed} /> : null}
      {s && !s.keyed ? <p className="notice" role="status">Sample: add YOUTUBE_API_KEY</p> : null}
    </section>
  );
}

function FieldsEditor({ state, onSaved }: { state: DetourState; onSaved: () => void }) {
  const [fields, setFields] = useState<string[]>(state.fields);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const full = fields.length >= MAX_FIELDS;
  const has = (f: string) => fields.some((x) => x.toLowerCase() === f.toLowerCase());
  const add = (f: string) => { const t = f.trim(); if (t.length >= 2 && !has(t) && !full) setFields([...fields, t]); };
  const save = async () => {
    setSaving(true); setMsg(null);
    try { const r = await api<{ fields: string[] }>("/api/detour/fields", jsonInit("PUT", { fields })); setFields(r.fields); setMsg("Saved."); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <section className="card" aria-label="Fields you want instead">
      <h2>Fields you want instead ({fields.length} of {MAX_FIELDS})</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(text); setText(""); }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="physics, architecture history…" aria-label="Add a field" disabled={full} maxLength={60} style={{ flex: 1, minWidth: "12rem" }} />
        <button className="btn" type="submit" disabled={full || text.trim().length < 2}>Add</button>
      </form>
      <div className="row">
        {fields.map((f) => (
          <label key={f} className="chip on">
            <input type="checkbox" checked onChange={() => setFields(fields.filter((x) => x !== f))} />
            {f}
          </label>
        ))}
      </div>
      <h3>Suggested: under 2 % of your history</h3>
      <div className="row">
        {state.suggestions.map((s) => (
          <label key={s.label} className={`chip${has(s.query) ? " on" : ""}`}>
            <input type="checkbox" checked={has(s.query)} disabled={!has(s.query) && full} onChange={() => (has(s.query) ? setFields(fields.filter((x) => x.toLowerCase() !== s.query.toLowerCase())) : add(s.query))} />
            {s.label}{s.share !== null ? ` (${pct(s.share)})` : ""}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>Save fields</button>
        {msg ? <span className="notice" role="status">{msg}</span> : null}
      </div>
    </section>
  );
}

export function DetourView({ connectStatus }: { connectStatus: { kind: string; reason: string | null } | null }) {
  const [s, setS] = useState<DetourState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { api<DetourState>("/api/detour/state").then(setS).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (name: string, fn: () => Promise<string>) => {
    setBusy(name); setMsg(null);
    try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); load(); }
  };

  if (err && !s) return <main className="page"><p className="notice notice-error" role="alert">{err}</p></main>;
  if (!s) return <main className="page"><p>Loading…</p></main>;

  const connectNote = connectStatus?.kind === "connected" ? "YouTube is connected."
    : connectStatus?.kind === "localhost" ? "Open Serendip at http://localhost:3000/detour on the Mac itself, then press Connect YouTube. Google refuses redirects to a LAN address."
    : connectStatus?.kind === "not_configured" ? "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first."
    : connectStatus?.kind === "error" ? `Could not connect: ${connectStatus.reason ?? "unknown error"}` : null;

  return (
    <main className="page">
      <header>
        <h1>Detour</h1>
        <p className="muted">Videos from fields you do not watch, filtered so they are not more of the same.</p>
      </header>
      <nav className="nav"><Link href="/">Home</Link><Link href="/tv">Channels</Link><Link href="/setup">Setup</Link></nav>

      {!s.keyed ? <p className="flag" role="status">Sample — add YOUTUBE_API_KEY</p> : null}

      <section className="card" aria-label="Your cluster">
        <h2>The cluster you are stuck in</h2>
        <ClusterCard cluster={s.cluster} keyed={s.keyed} />
        <TakeoutImporter onDone={load} />
        {s.keyed && s.cluster.needsAnalysis ? (
          <button className="btn" type="button" disabled={busy !== null} onClick={() => run("analyze", async () => { const r = await api<{ fetched: number; calls: number }>("/api/detour/analyze", jsonInit("POST", {})); return `Fetched topics for ${r.fetched} videos in ${r.calls} calls.`; })}>Analyze topics</button>
        ) : null}
      </section>

      <FieldsEditor key={s.fields.join("|")} state={s} onSaved={load} />

      <section className="card" aria-label="Today's detour">
        <h2>Today&apos;s Detour</h2>
        {s.picks.sample ? <p className="muted">Six labelled sample cards. They do not play.</p> : null}
        {s.keyed && s.fields.length === 0 ? <p className="muted">Name at least one field above to get picks.</p> : null}
        <ul className="picks">
          {s.picks.items.map((p) => (
            <li key={p.key} className={`pick${p.placeholder ? " sample" : ""}`}>
              <span className="pick-title">{p.videoId ? <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(p.videoId)}`} target="_blank" rel="noreferrer">{p.title}</a> : p.title}</span>
              <span className="muted">{p.channel}{p.seconds ? ` · ${Math.round(p.seconds / 60)} min` : ""}</span>
              <span className="pick-why">{p.why}</span>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={busy !== null || !s.keyed || s.fields.length === 0} onClick={() => run("refresh", async () => { const r = await api<{ status: string; picks: number; searchCalls: number; note: string | null }>("/api/detour/refresh", jsonInit("POST", {})); return r.note ?? `${r.status}: ${r.picks} picks, ${r.searchCalls} searches.`; })}>Refresh now</button>
          <span className="muted">Searches today: {s.budget.used} of {s.budget.limit} (about {s.budget.units.toLocaleString("en-US")} quota units).</span>
        </div>
        {s.picks.note ? <p className="notice" role="status">{s.picks.note}</p> : null}
        {msg ? <p className="notice" role="status">{msg}</p> : null}
      </section>

      <section className="card" aria-label="YouTube playlist">
        <h2>Play it on the TV&apos;s YouTube app</h2>
        <p className="muted">Optional. Connect YouTube and Serendip keeps a private playlist called &ldquo;Serendip Detour&rdquo; with today&apos;s picks.</p>
        {connectNote ? <p className={`notice${connectStatus?.kind === "connected" ? " notice-good" : connectStatus?.kind === "error" ? " notice-error" : ""}`} role="status">{connectNote}</p> : null}
        {!s.oauth.configured ? (
          <p className="muted">Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env to enable this (docs/GETTING-STARTED.md, step 6).</p>
        ) : s.oauth.connected ? (
          <>
            <p className="notice notice-good" role="status">Connected.{s.oauth.playlist ? ` Last sync: ${s.oauth.playlist.ok ? `${s.oauth.playlist.added} added, ${s.oauth.playlist.removed} removed` : `failed (${s.oauth.playlist.error})`}.` : " The playlist is written at the next daily refresh."}</p>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => run("disconnect", async () => { const r = await api<{ revoked: boolean }>("/api/youtube/disconnect", jsonInit("POST", {})); return r.revoked ? "Disconnected and revoked at Google." : "Disconnected here. Google did not confirm the revoke: remove Serendip at myaccount.google.com/permissions."; })}>Disconnect YouTube</button>
          </>
        ) : (
          <>
            <a className="btn btn-primary" href="/api/youtube/connect">Connect YouTube</a>
            <p className="muted">Do this one step from the Mac&apos;s own browser at http://localhost:3000 (Google refuses LAN addresses as the redirect). Redirect URI: <code>{s.oauth.redirectUri}</code></p>
          </>
        )}
      </section>

      {s.saved.length ? (
        <section className="card" aria-label="Saved videos">
          <h2>Saved</h2>
          <ul className="list">
            {s.saved.map((v) => (
              <li key={v.videoId}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`} target="_blank" rel="noreferrer">{v.title ?? v.videoId}</a><span className="muted">{v.channelTitle}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { countryName, formatRuntime } from "../src/core/why";
import { trailerEmbed } from "../src/core/watch";
import { initialZap, SHEET_ACTIONS, zap, type SheetAction, type ZapInput, type ZapState } from "../src/core/zap";

interface FeedPick {
  id: number;
  title: string;
  year: number | null;
  runtime: number | null;
  genres: string[];
  country: string | null;
  line: string;
  trailerKey: string | null;
  backdrop: string | null;
  poster: string | null;
  sample: boolean;
  why: string;
  outside: boolean;
  service: string;
  watchUrl: string;
}
interface FeedChannel { id: string; name: string; blurb: string; picks: FeedPick[] }
interface Feed { mode: "tmdb" | "sample"; needsSetup: boolean; channels: FeedChannel[] }

const LABEL: Record<SheetAction, (p: FeedPick) => string> = {
  watch: (p) => `Watch on ${p.service}`,
  save: () => "Save for later",
  seen: () => "Already seen",
  dismiss: () => "Not for me",
};

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function device(): "tv" | "touch" | "desktop" {
  if (/TV|AFT|BRAVIA|SmartTV|MiTV|Xiaomi/i.test(navigator.userAgent)) return "tv";
  return window.matchMedia("(pointer: coarse)").matches ? "touch" : "desktop";
}

function Media({ pick, trailerOn }: { pick: FeedPick; trailerOn: boolean }) {
  const h = hue(pick.title);
  const image = pick.backdrop ?? pick.poster;
  return (
    <div className="media" aria-hidden="true">
      {image ? (
        <div className="media-img" style={{ backgroundImage: `url(${image})` }} />
      ) : (
        <div className="media-card" style={{ background: `linear-gradient(135deg, hsl(${h} 55% 24%), hsl(${(h + 60) % 360} 60% 10%))` }}>
          <span>{pick.genres[0] ?? ""}</span>
        </div>
      )}
      {trailerOn && pick.trailerKey ? <iframe key={pick.id} src={trailerEmbed(pick.trailerKey, pick.id)} allow="autoplay; encrypted-media" title="" tabIndex={-1} /> : null}
    </div>
  );
}

function Strip({ channels, active }: { channels: FeedChannel[]; active: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  return (
    <div className="strip strip-scroll" ref={ref} role="tablist" aria-label="Channels">
      {channels.map((c, i) => (
        <span key={c.id} role="tab" aria-selected={i === active} className={`strip-item${i === active ? " on" : ""}`}>
          <span className="n">{i + 1}</span>
          {c.name}
        </span>
      ))}
    </div>
  );
}

export function TvApp({ variant }: { variant: "a" | "b" }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<FeedChannel[]>([]);
  const [state, dispatchZap] = useReducer((s: ZapState, i: ZapInput) => zap(s, i).state, initialZap([]));
  const router = useRouter();
  const [trailerFor, setTrailerFor] = useState<number | null>(null);
  const [askDay, setAskDay] = useState<string | null>(null);
  const shown = useRef(new Set<number>());
  const latest = useRef({ state, channels, askDay });
  useEffect(() => {
    latest.current = { state, channels, askDay };
  });

  useEffect(() => {
    let alive = true;
    fetch("/api/feed")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Error ${r.status}`);
        return body as Feed;
      })
      .then((f) => {
        if (!alive) return;
        setFeed(f);
        setChannels(f.channels);
        dispatchZap({ type: "counts", counts: f.channels.map((c) => c.picks.length) });
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the channels."));
    post("/api/event", { type: "open", variant, device: device() });
    const y = localDay(-1);
    fetch(`/api/evening?yesterday=${y}`).then((r) => r.json()).then((b: { ask?: boolean }) => alive && b.ask && setAskDay(y)).catch(() => undefined);
    return () => { alive = false; };
  }, [variant]);

  const channel = channels[state.channel];
  const pick = channel?.picks[state.position[state.channel] ?? 0];

  // Count a film as shown once per session, and start its trailer after you stop zapping.
  useEffect(() => {
    if (!pick) return;
    if (!shown.current.has(pick.id)) {
      shown.current.add(pick.id);
      post("/api/event", { type: "pick_shown", filmId: pick.id });
    }
    const id = pick.id;
    const t = setTimeout(() => setTrailerFor(id), 400);
    return () => clearTimeout(t);
  }, [pick?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback((action: SheetAction) => {
    const { state: s, channels: chs } = latest.current;
    const p = chs[s.channel]?.picks[s.position[s.channel] ?? 0];
    if (!p) return;
    if (action === "watch") {
      if (!window.open(p.watchUrl, "_blank", "noopener")) window.location.assign(p.watchUrl);
      return;
    }
    post("/api/action", { filmId: p.id, action });
    setChannels((cs) => cs.map((c, i) => (i === s.channel ? { ...c, picks: c.picks.filter((x) => x.id !== p.id) } : c)));
    dispatchZap({ type: "removeCurrent" });
  }, []);

  const input = useCallback((i: ZapInput) => {
    const { state: s } = latest.current;
    const r = zap(s, i);
    dispatchZap(i);
    if (r.effect?.type === "action") run(r.effect.action);
  }, [run]);

  const dismissPrompt = useCallback(() => {
    const day = latest.current.askDay;
    if (day) fetch(`/api/evening?day=${day}`, { method: "DELETE" }).catch(() => undefined);
    setAskDay(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { askDay: day, state: s } = latest.current;
      if (day && s.sheet === null) {
        if (e.key === "Enter") { e.preventDefault(); router.push(`/log?day=${day}`); return; }
        if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack") { e.preventDefault(); dismissPrompt(); return; }
      }
      if (/^(Arrow(Up|Down|Left|Right)|Enter| |Escape|Backspace|GoBack|BrowserBack|Select|[1-9])$/.test(e.key)) {
        e.preventDefault();
        input({ type: "key", key: e.key });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input, dismissPrompt, router]);

  // Touch: swipe up or down zaps, left or right changes channel, a tap opens the actions.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touch.current = { x: t.clientX, y: t.clientY };
    swiped.current = false;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    const start = touch.current;
    touch.current = null;
    if (!t || !start) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 48) return;
    swiped.current = true;
    if (latest.current.state.sheet !== null) return;
    input({ type: "swipe", dir: Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "up" : "down") : dx < 0 ? "left" : "right" });
  };
  const onClick = (e: React.MouseEvent) => {
    if (swiped.current) { swiped.current = false; return; }
    if ((e.target as HTMLElement).closest(".sheet, .prompt")) return;
    input({ type: "tap" });
  };

  const meta = useMemo(() => {
    if (!pick) return "";
    return [pick.year, pick.country ? countryName(pick.country) : null, formatRuntime(pick.runtime), pick.genres[0]].filter(Boolean).join(" · ");
  }, [pick]);

  if (error) return <div className="tv"><div className="tv-state"><p role="alert">{error}</p><a className="btn" href="/setup">Open setup</a></div></div>;
  if (!feed) return <div className="tv"><div className="tv-state"><p>Tuning the channels…</p></div></div>;
  if (feed.needsSetup) return <div className="tv"><div className="tv-state"><p>Pick your services first.</p><a className="btn btn-primary" href="/setup">Open setup</a></div></div>;
  if (!pick || !channel) return <div className="tv"><div className="tv-state"><p>Nothing to show on your services yet.</p><a className="btn" href="/setup">Change setup</a></div></div>;

  const pos = state.position[state.channel] ?? 0;
  const foot = <p className="tv-foot">This product uses the TMDB API but is not endorsed or certified by TMDB. Availability data by JustWatch.</p>;
  const info = (
    <div className="info">
      <p className="tv-meta"><span className={`tv-badge${pick.outside ? " outside" : ""}`}>{channel.name}</span>{meta}</p>
      <h1 className="tv-title">{pick.title}</h1>
      <p className="tv-line">{pick.line}</p>
      <p className="tv-why">{pick.why}</p>
      <p className="tv-hint">▲▼ next film   ◀▶ channel   OK actions   {pos + 1} / {channel.picks.length}</p>
      {variant === "a" ? foot : null}
    </div>
  );

  return (
    <div className={`tv tv-${variant}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onClick={onClick} data-variant={variant}>
      {variant === "a" ? (
        <>
          <Media pick={pick} trailerOn={trailerFor === pick.id} />
          <div className="top"><Strip channels={channels} active={state.channel} /></div>
          {info}
        </>
      ) : (
        <>
          <Media pick={pick} trailerOn={trailerFor === pick.id} />
          {info}
          <div className="bottom"><Strip channels={channels} active={state.channel} />{foot}</div>
        </>
      )}

      {askDay && state.sheet === null ? (
        <div className="prompt" role="dialog" aria-label="Evening log">
          <span>What did you watch yesterday?</span>
          <span className="row">
            <a className="btn btn-primary" href={`/log?day=${askDay}`}>Log it (OK)</a>
            <button className="btn" onClick={dismissPrompt} type="button">Skip (Back)</button>
          </span>
        </div>
      ) : null}

      {state.sheet !== null ? (
        <div className="sheet-back">
          <div className="sheet" role="menu" aria-label={`Actions for ${pick.title}`}>
            <div className="sheet-title">{pick.title}</div>
            {SHEET_ACTIONS.map((a, i) => (
              <button key={a} role="menuitem" type="button" className={`sheet-item${i === state.sheet ? " sel" : ""}`} onClick={(e) => { e.stopPropagation(); input({ type: "choose", action: a }); }}>
                {LABEL[a](pick)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

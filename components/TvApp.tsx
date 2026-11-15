"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { countryName, formatRuntime } from "../src/core/why";
import { detourEmbed } from "../src/core/detour";
import { trailerEmbed } from "../src/core/watch";
import { initialZap, SHEET_ACTIONS, zap, type SheetAction, type ZapInput, type ZapState } from "../src/core/zap";

interface FeedPick {
  /** Stable identity across channels: "f:<tmdb id>" for a film, "v:<video id>" for a Detour video. */
  key: string;
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
  /** Present on Detour picks. `videoId` is null on the labelled sample cards, which never play. */
  video?: { videoId: string | null; channel: string; field: string; placeholder: boolean };
}
interface FeedChannel { id: string; name: string; blurb: string; picks: FeedPick[] }
interface Feed { mode: "tmdb" | "sample"; needsSetup: boolean; channels: FeedChannel[] }

const LABEL: Record<SheetAction, (p: FeedPick) => string> = {
  watch: (p) => (p.video ? (p.video.placeholder ? "Watch (sample, does not play)" : "Watch here, full screen") : `Watch on ${p.service}`),
  save: () => "Save for later",
  seen: () => "Already seen",
  dismiss: (p) => (p.video ? "Not for me (mute channel 90 days)" : "Not for me"),
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
  const vid = pick.video?.videoId ?? null;
  return (
    <div className="media" aria-hidden="true">
      {image ? (
        <div className="media-img" style={{ backgroundImage: `url(${image})` }} />
      ) : (
        <div className="media-card" style={{ background: `linear-gradient(135deg, hsl(${h} 55% 24%), hsl(${(h + 60) % 360} 60% 10%))` }}>
          <span>{pick.video?.placeholder ? "Sample" : (pick.genres[0] ?? "")}</span>
        </div>
      )}
      {trailerOn && vid ? <iframe key={pick.key} src={detourEmbed(vid, "preview")} allow="autoplay; encrypted-media" title="" tabIndex={-1} /> : null}
      {trailerOn && !vid && pick.trailerKey ? <iframe key={pick.key} src={trailerEmbed(pick.trailerKey, pick.id)} allow="autoplay; encrypted-media" title="" tabIndex={-1} /> : null}
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
  const [trailerFor, setTrailerFor] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null); // video id shown full screen, with sound
  const [askDay, setAskDay] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = useRef(new Set<string>());
  const latest = useRef({ state, channels, askDay, playing });
  useEffect(() => {
    latest.current = { state, channels, askDay, playing };
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
    if (!shown.current.has(pick.key)) {
      shown.current.add(pick.key);
      if (pick.video) { if (pick.video.videoId) post("/api/event", { type: "detour_shown", videoId: pick.video.videoId }); }
      else post("/api/event", { type: "pick_shown", filmId: pick.id });
    }
    const id = pick.key;
    const t = setTimeout(() => setTrailerFor(id), 400);
    return () => clearTimeout(t);
  }, [pick?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const run = useCallback(async (action: SheetAction) => {
    const { state: s, channels: chs } = latest.current;
    const p = chs[s.channel]?.picks[s.position[s.channel] ?? 0];
    if (!p) return;
    if (p.video) {
      const v = p.video;
      if (action === "watch") {
        if (v.videoId) { post("/api/event", { type: "detour_watch", videoId: v.videoId }); setPlaying(v.videoId); } else flash("Sample card: nothing plays. Add YOUTUBE_API_KEY.");
        return;
      }
      // Sample cards have no real id, so there is nothing to store: they just leave the channel.
      if (v.videoId) {
        let saved = false;
        try { saved = (await fetch("/api/detour/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: v.videoId, action }) })).ok; } catch { saved = false; }
        if (!saved) { flash("Could not save that. The video is still here; try again."); return; }
      }
      const at = latest.current.channels.map((c) => c.picks.findIndex((x) => x.key === p.key));
      setChannels((cs) => cs.map((c) => ({ ...c, picks: c.picks.filter((x) => x.key !== p.key) })));
      dispatchZap({ type: "removeFilm", indices: at });
      return;
    }
    if (action === "watch") {
      // One window.open call: with "noopener" it returns null even when the tab opened, so drop the opener by hand.
      const w = window.open(p.watchUrl, "_blank");
      if (w) { try { w.opener = null; } catch { /* cross-origin already */ } } else window.location.assign(p.watchUrl);
      return;
    }
    let ok = false;
    try {
      ok = (await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filmId: p.id, action }) })).ok;
    } catch { ok = false; }
    if (!ok) {
      flash("Could not save that. The film is still here; try again.");
      return;
    }
    // Saved, seen or not for me: the film leaves every channel it was in, not just this one.
    const indices = latest.current.channels.map((c) => c.picks.findIndex((x) => x.key === p.key));
    setChannels((cs) => cs.map((c) => ({ ...c, picks: c.picks.filter((x) => x.key !== p.key) })));
    dispatchZap({ type: "removeFilm", indices });
  }, [flash]);

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
      // A focused link or button keeps its own Enter and Space (the "Open setup" link on the fallback screens).
      if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement | null)?.closest?.("a, button, input, select, textarea")) return;
      const { askDay: day, state: s, playing: on } = latest.current;
      if (on) {
        // The full-screen player owns the keys; Back closes it. Everything else goes to the video.
        if (/^(Escape|Backspace|GoBack|BrowserBack)$/.test(e.key)) { e.preventDefault(); setPlaying(null); }
        return;
      }
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
  // Keep keyboard focus on the player's parent element. When a tap or the embed itself moves focus into the
  // iframe (window blur with the iframe active), take it back so Escape / GoBack still reach our handler.
  const playerEl = useRef<HTMLDivElement | null>(null);
  const keepPlayerFocus = useCallback((el: HTMLDivElement | null) => {
    playerEl.current = el;
    el?.focus();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const reclaim = () => {
      setTimeout(() => {
        const el = playerEl.current;
        if (el && document.activeElement instanceof HTMLIFrameElement) el.focus();
      }, 0);
    };
    window.addEventListener("blur", reclaim);
    return () => window.removeEventListener("blur", reclaim);
  }, [playing]);
  const onClick = (e: React.MouseEvent) => {
    if (swiped.current) { swiped.current = false; return; }
    if ((e.target as HTMLElement).closest(".sheet, .prompt, .player")) return;
    input({ type: "tap" });
  };

  const meta = useMemo(() => {
    if (!pick) return "";
    return [pick.year, pick.country ? countryName(pick.country) : null, pick.runtime || !pick.video ? formatRuntime(pick.runtime) : null, pick.genres[0]].filter(Boolean).join(" · ");
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
      {pick.video?.placeholder ? <p className="tv-sample" role="status">Sample: add YOUTUBE_API_KEY</p> : null}
      <p className="tv-hint">▲▼ next film   ◀▶ channel   OK actions   {pos + 1} / {channel.picks.length}</p>
      {variant === "a" ? foot : null}
    </div>
  );

  return (
    <div className={`tv tv-${variant}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onClick={onClick} data-variant={variant}>
      {variant === "a" ? (
        <>
          <Media pick={pick} trailerOn={trailerFor === pick.key} />
          <div className="top"><Strip channels={channels} active={state.channel} /></div>
          {info}
        </>
      ) : (
        <>
          <Media pick={pick} trailerOn={trailerFor === pick.key} />
          {info}
          <div className="bottom"><Strip channels={channels} active={state.channel} />{foot}</div>
        </>
      )}

      {notice ? <div className="toast" role="alert">{notice}</div> : null}

      {playing ? (
        <div className="player" role="dialog" aria-label="Video player" tabIndex={0} ref={keepPlayerFocus}>
          {/* Focus stays on the parent: a focused iframe swallows the remote's keys and Back could not close the player. */}
          <iframe src={detourEmbed(playing, "watch")} allow="autoplay; encrypted-media; fullscreen" allowFullScreen title="Detour video" tabIndex={-1} />
          <button className="btn player-close" type="button" onClick={(e) => { e.stopPropagation(); setPlaying(null); }}>Back to the channels</button>
        </div>
      ) : null}

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

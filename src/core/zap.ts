/**
 * The remote-control state machine of /tv. Pure: keys in, state and an optional effect out.
 *
 *   Up / Down      previous / next film in the channel (zapping, wraps round)
 *   Left / Right   previous / next channel
 *   1 to 9         jump to that channel
 *   Enter          open the action sheet; Enter again runs the highlighted action
 *   Escape, Back   close the sheet
 */

export const SHEET_ACTIONS = ["watch", "save", "seen", "dismiss"] as const;
export type SheetAction = (typeof SHEET_ACTIONS)[number];

export interface ZapState {
  /** Films left in each channel. */
  counts: number[];
  channel: number;
  /** Position in each channel, remembered while you visit another one. */
  position: number[];
  /** Highlighted action in the sheet, or null when the sheet is closed. */
  sheet: number | null;
}

export type ZapInput =
  | { type: "key"; key: string }
  | { type: "swipe"; dir: "up" | "down" | "left" | "right" }
  | { type: "tap" }
  | { type: "choose"; action: SheetAction }
  | { type: "removeCurrent" }
  | { type: "counts"; counts: number[] };

export type ZapEffect = { type: "action"; action: SheetAction } | null;

export const initialZap = (counts: number[]): ZapState => ({ counts, channel: firstWithFilms(counts, 0, 1), position: counts.map(() => 0), sheet: null });

function firstWithFilms(counts: number[], from: number, step: 1 | -1): number {
  const n = counts.length;
  for (let i = 0; i < n; i++) {
    const c = (((from + i * step) % n) + n) % n;
    if ((counts[c] ?? 0) > 0) return c;
  }
  return 0;
}

const wrap = (i: number, n: number) => (n <= 0 ? 0 : ((i % n) + n) % n);

function moveFilm(s: ZapState, d: 1 | -1): ZapState {
  const n = s.counts[s.channel] ?? 0;
  const position = [...s.position];
  position[s.channel] = wrap((position[s.channel] ?? 0) + d, n);
  return { ...s, position };
}

function moveChannel(s: ZapState, d: 1 | -1): ZapState {
  if (s.counts.every((c) => c === 0)) return s;
  return { ...s, channel: firstWithFilms(s.counts, s.channel + d, d) };
}

const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);
const key = (k: string): "up" | "down" | "left" | "right" | "ok" | "back" | number | null => {
  if (k === "ArrowUp") return "up";
  if (k === "ArrowDown") return "down";
  if (k === "ArrowLeft") return "left";
  if (k === "ArrowRight") return "right";
  if (k === "Enter" || k === " " || k === "Select") return "ok";
  if (BACK_KEYS.has(k)) return "back";
  if (/^[1-9]$/.test(k)) return Number(k);
  return null;
};

export function zap(s: ZapState, input: ZapInput): { state: ZapState; effect: ZapEffect } {
  const none = (state: ZapState) => ({ state, effect: null as ZapEffect });

  if (input.type === "counts") {
    const channel = (input.counts[s.channel] ?? 0) > 0 ? s.channel : firstWithFilms(input.counts, s.channel, 1);
    return none({ ...s, counts: input.counts, channel, position: input.counts.map((c, i) => Math.min(s.position[i] ?? 0, Math.max(0, c - 1))) });
  }
  if (input.type === "removeCurrent") {
    const counts = [...s.counts];
    counts[s.channel] = Math.max(0, (counts[s.channel] ?? 0) - 1);
    const position = [...s.position];
    position[s.channel] = counts[s.channel] ? Math.min(position[s.channel] ?? 0, counts[s.channel]! - 1) : 0;
    const channel = counts[s.channel] ? s.channel : firstWithFilms(counts, s.channel, 1);
    return none({ ...s, counts, position, channel, sheet: null });
  }
  if (input.type === "choose") return { state: { ...s, sheet: null }, effect: { type: "action", action: input.action } };
  if (input.type === "tap") return none(s.sheet === null ? { ...s, sheet: 0 } : { ...s, sheet: null });

  let k: ReturnType<typeof key>;
  if (input.type === "swipe") k = input.dir === "up" ? "down" : input.dir === "down" ? "up" : input.dir === "left" ? "right" : "left"; // a swipe up pulls the next film in
  else k = key(input.key);
  if (k === null) return none(s);

  if (s.sheet !== null) {
    if (k === "back") return none({ ...s, sheet: null });
    if (k === "up") return none({ ...s, sheet: wrap(s.sheet - 1, SHEET_ACTIONS.length) });
    if (k === "down") return none({ ...s, sheet: wrap(s.sheet + 1, SHEET_ACTIONS.length) });
    if (k === "ok") return { state: { ...s, sheet: null }, effect: { type: "action", action: SHEET_ACTIONS[s.sheet]! } };
    return none(s);
  }
  if (typeof k === "number") return (s.counts[k - 1] ?? 0) > 0 ? none({ ...s, channel: k - 1 }) : none(s);
  if (k === "down") return none(moveFilm(s, 1));
  if (k === "up") return none(moveFilm(s, -1));
  if (k === "right") return none(moveChannel(s, 1));
  if (k === "left") return none(moveChannel(s, -1));
  if (k === "ok") return none({ ...s, sheet: 0 });
  return none(s);
}

import { describe, expect, it } from "vitest";
import { initialZap, zap, type ZapInput, type ZapState } from "../src/core/zap";

const press = (s: ZapState, ...keys: string[]) => keys.reduce((st, key) => zap(st, { type: "key", key }).state, s);

describe("zap", () => {
  const s0 = initialZap([3, 2, 0, 4]);

  it("starts on the first channel with films", () => {
    expect(initialZap([0, 2]).channel).toBe(1);
  });

  it("Down and Up zap films and wrap round", () => {
    expect(press(s0, "ArrowDown").position[0]).toBe(1);
    expect(press(s0, "ArrowDown", "ArrowDown", "ArrowDown").position[0]).toBe(0);
    expect(press(s0, "ArrowUp").position[0]).toBe(2);
  });

  it("Left and Right switch channel, skip empty ones, and remember the position", () => {
    const s1 = press(s0, "ArrowDown", "ArrowRight");
    expect(s1.channel).toBe(1);
    expect(press(s1, "ArrowRight").channel).toBe(3);
    expect(press(s1, "ArrowDown", "ArrowLeft").position[1]).toBe(1);
    expect(press(s1, "ArrowLeft").position[0]).toBe(1);
  });

  it("number keys jump to a channel that has films", () => {
    expect(press(s0, "4").channel).toBe(3);
    expect(press(s0, "3").channel).toBe(0);
    expect(press(s0, "9").channel).toBe(0);
  });

  it("Enter opens the sheet, arrows move inside it, Escape and Backspace close it", () => {
    const open = press(s0, "Enter");
    expect(open.sheet).toBe(0);
    expect(press(open, "ArrowDown").sheet).toBe(1);
    expect(press(open, "ArrowUp").sheet).toBe(3);
    expect(press(open, "ArrowDown").position[0]).toBe(0); // the film does not zap behind the sheet
    expect(press(open, "Escape").sheet).toBeNull();
    expect(press(open, "Backspace").sheet).toBeNull();
  });

  it("Enter in the sheet runs the highlighted action", () => {
    const r = zap(press(s0, "Enter", "ArrowDown", "ArrowDown"), { type: "key", key: "Enter" });
    expect(r.effect).toEqual({ type: "action", action: "seen" });
    expect(r.state.sheet).toBeNull();
    expect(zap(press(s0, "Enter"), { type: "key", key: "Enter" }).effect).toEqual({ type: "action", action: "watch" });
  });

  it("touch: swipe up zaps to the next film, swipe left to the next channel, tap opens", () => {
    const up: ZapInput = { type: "swipe", dir: "up" };
    expect(zap(s0, up).state.position[0]).toBe(1);
    expect(zap(s0, { type: "swipe", dir: "down" }).state.position[0]).toBe(2);
    expect(zap(s0, { type: "swipe", dir: "left" }).state.channel).toBe(1);
    expect(zap(s0, { type: "tap" }).state.sheet).toBe(0);
  });

  it("removing the current film keeps the position and moves on when a channel empties", () => {
    const s = zap(press(s0, "ArrowDown"), { type: "removeCurrent" }).state;
    expect(s.counts[0]).toBe(2);
    expect(s.position[0]).toBe(1);
    const last = zap(zap(initialZap([1, 2]), { type: "removeCurrent" }).state, { type: "key", key: "ArrowDown" }).state;
    expect(last.channel).toBe(1);
  });

  it("ignores unknown keys", () => {
    expect(press(s0, "q")).toEqual(s0);
  });
});

describe("removeFilm across channels", () => {
  it("drops the film everywhere and keeps your place in each channel", () => {
    const s0 = { counts: [4, 4], channel: 0, position: [1, 3], sheet: null };
    const { state } = zap(s0, { type: "removeFilm", indices: [1, 0] });
    expect(state.counts).toEqual([3, 3]);
    expect(state.position).toEqual([1, 2]); // channel 1 shifted under you
    const last = zap({ counts: [1, 2], channel: 0, position: [0, 0], sheet: 0 }, { type: "removeFilm", indices: [0, -1] }).state;
    expect(last).toMatchObject({ counts: [0, 2], channel: 1, sheet: null });
  });
});

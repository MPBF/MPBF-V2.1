import { describe, expect, it } from "@jest/globals";

import { createLatestRequestGate, fetchAllPages, LIST_PAGE_SIZE, runLatestRequest } from "../client/src/lib/listing";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("client list request helpers", () => {
  it("fetches every page instead of silently stopping at 200 rows", async () => {
    const source = Array.from({ length: 450 }, (_, index) => index + 1);
    const offsets: number[] = [];

    const rows = await fetchAllPages((offset, limit) => {
      offsets.push(offset);
      return Promise.resolve(source.slice(offset, offset + limit));
    });

    expect(rows).toHaveLength(450);
    expect(rows[0]).toBe(1);
    expect(rows[449]).toBe(450);
    expect(offsets).toEqual([0, LIST_PAGE_SIZE, LIST_PAGE_SIZE * 2]);
  });

  it("ignores a superseded request even when it resolves last", async () => {
    const gate = createLatestRequestGate();
    const older = deferred<string>();
    const newer = deferred<string>();
    const applied: string[] = [];
    const applyWhenCurrent = async (request: Promise<string>) => {
      const ticket = gate.begin();
      const value = await request;
      if (gate.isCurrent(ticket)) applied.push(value);
    };

    const olderLoad = applyWhenCurrent(older.promise);
    const newerLoad = applyWhenCurrent(newer.promise);
    newer.resolve("new search");
    await newerLoad;
    older.resolve("old search");
    await olderLoad;

    expect(applied).toEqual(["new search"]);
  });

  it("invalidates a request when its owning route unmounts or changes", () => {
    const gate = createLatestRequestGate();
    const ticket = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(ticket)).toBe(false);
  });

  it("settles a failed list as an error, then allows a successful retry", async () => {
    const gate = createLatestRequestGate();
    const state = {
      busy: false,
      resultKey: "previous search",
      rows: ["stale row"],
      error: "",
    };
    const load = async (operation: Promise<string[]>) => {
      const request = gate.begin();
      const key = "current search";
      state.busy = true;
      state.resultKey = "";
      state.error = "";
      await runLatestRequest(gate, request, operation, {
        onSuccess: (rows) => {
          state.rows = rows;
          state.resultKey = key;
        },
        onError: (error) => {
          state.rows = [];
          state.resultKey = key;
          state.error = error.message;
        },
        onSettled: () => { state.busy = false; },
      });
    };

    await load(Promise.reject(new Error("Network unavailable")));
    expect(state).toEqual({
      busy: false,
      resultKey: "current search",
      rows: [],
      error: "Network unavailable",
    });

    await load(Promise.resolve(["fresh row"]));
    expect(state).toEqual({
      busy: false,
      resultKey: "current search",
      rows: ["fresh row"],
      error: "",
    });
  });
});
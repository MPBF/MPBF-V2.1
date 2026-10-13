import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { hrApi } from "../client/src/lib/hr-api";

jest.mock("../client/src/i18n", () => ({
  translateError: (message: string) => `translated:${message}`,
}));

afterEach(() => { jest.restoreAllMocks(); });

describe("shared HR transport retains both pages' contract", () => {
  test("uses the same-origin HR endpoint, cookie credentials and JSON headers", async () => {
    const body = [{id: 12}];
    const request = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => body,
    } as Response);
    await expect(hrApi("/employees")).resolves.toEqual(body);
    expect(request).toHaveBeenCalledWith("/api/hr/employees", {
      credentials: "include", headers: {"Content-Type": "application/json"},
    });
  });
  test("preserves caller method, body and cancellation signal", async () => {
    const signal = new AbortController().signal;
    const request = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => ({id: 3}),
    } as Response);
    await hrApi("/permissions", {method: "POST", body: '{"minutes":10}', signal});
    expect(request).toHaveBeenCalledWith("/api/hr/permissions", {
      credentials: "include", headers: {"Content-Type": "application/json"},
      method: "POST", body: '{"minutes":10}', signal,
    });
  });
  test("translates backend errors and never returns them as successful data", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, json: async () => ({message: "forbidden"}),
    } as Response);
    await expect(hrApi("/employees")).rejects.toThrow("translated:forbidden");
  });
  test("keeps the previous translated fallback for a non-JSON error response", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, json: async () => {throw new SyntaxError("not JSON");},
    } as unknown as Response);
    await expect(hrApi("/employees")).rejects.toThrow("translated:تعذر تنفيذ الطلب");
  });
  test("propagates network failures", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(hrApi("/employees")).rejects.toThrow("offline");
  });
});

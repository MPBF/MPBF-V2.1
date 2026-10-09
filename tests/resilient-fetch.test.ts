import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NetworkRequestError, resilientFetch } from "../client/src/lib/resilient-fetch";

describe("safe network recovery", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock<typeof fetch>;
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
  it("preserves the URL, credentials and request headers", async () => {
    const response = new Response("[]");
    fetchMock.mockResolvedValue(response);
    expect(await resilientFetch("/api/self/messages", { credentials: "include", headers: { Accept: "application/json" } })).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/self/messages", expect.objectContaining({ credentials: "include", headers: { Accept: "application/json" }, signal: expect.any(AbortSignal) }),
    ]);
  });
  it("recovers a read after a temporary fetch failure", async () => {
    const response = new Response("[]");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(response);
    const result = resilientFetch("/api/self/attendance");
    await jest.advanceTimersByTimeAsync(750);
    expect(await result).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([502, 503, 504])("recovers transient read HTTP status %i", async status => {
    const response = new Response("[]");
    fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status })).mockResolvedValue(response);
    const result = resilientFetch("/api/self/recipients");
    await jest.advanceTimersByTimeAsync(750);
    expect(await result).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 409])("does not retry HTTP status %i", async status => {
    const response = new Response("{}", { status });
    fetchMock.mockResolvedValue(response);
    expect(await resilientFetch("/api/self/requests")).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("bounds failed reads to three attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const rejected = expect(resilientFetch("/api/self/violations")).rejects.toBeInstanceOf(NetworkRequestError);
    await jest.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("returns the last HTTP error for the API to report", async () => {
    const response = new Response("Unavailable", { status: 503 });
    fetchMock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
    const result = resilientFetch("/api/self/attendance");
    await jest.runAllTimersAsync();
    expect((await result).status).toBe(response.status);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("never repeats a failed %s write", async method => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(resilientFetch("/api/self/attendance", { method, body: "{}" })).rejects.toBeInstanceOf(NetworkRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not retry a write even if the server returns 503", async () => {
    const response = new Response("{}", { status: 503 });
    fetchMock.mockResolvedValue(response);
    expect(await resilientFetch("/api/self/messages", { method: "POST", body: "{}" })).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts hung reads and bounds their retries", async () => {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const rejected = expect(resilientFetch("/api/self/attendance")).rejects.toBeInstanceOf(NetworkRequestError);
    await jest.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("cancels a retry when the caller leaves the page", async () => {
    const controller = new AbortController();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const rejected = expect(resilientFetch("/api/self/attendance", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not start a request with an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resilientFetch("/api/self/attendance", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not hide or retry a programming error", async () => {
    fetchMock.mockRejectedValue(new RangeError("Invalid request configuration"));
    await expect(resilientFetch("/api/self/attendance")).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

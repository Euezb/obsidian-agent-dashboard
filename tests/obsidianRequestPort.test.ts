import { describe, expect, it, vi } from "vitest";
import { createObsidianRequestPort, RequestTimeoutError } from "../src/infrastructure/ObsidianRequestPort";

describe("createObsidianRequestPort", () => {
  it("maps only request options and feed response fields", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      text: "body",
      json: { ok: true },
      headers: {
        authorization: "secret",
        "Retry-After": "120",
        "X-RateLimit-Remaining": "0",
        "x-ratelimit-reset": "1782723720",
      },
      arrayBuffer: new ArrayBuffer(0),
    });
    const port = createObsidianRequestPort(request);

    const result = await port({ url: "https://example.com", headers: { Accept: "text/xml" } });

    expect(request).toHaveBeenCalledWith({ url: "https://example.com", headers: { Accept: "text/xml" } });
    expect(result).toEqual({
      status: 200,
      text: "body",
      json: { ok: true },
      retryAfter: "120",
      rateLimitRemaining: "0",
      rateLimitReset: "1782723720",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not reject HTML or XML responses when Obsidian's json getter throws", async () => {
    const response = { status: 200, text: "<rss><channel /></rss>" };
    Object.defineProperty(response, "json", {
      get: () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    });
    const port = createObsidianRequestPort(vi.fn().mockResolvedValue(response));

    await expect(port({ url: "https://example.com/feed.xml" })).resolves.toEqual({
      status: 200,
      text: "<rss><channel /></rss>",
    });
  });

  it("rejects with a timeout error when the request never settles", async () => {
    vi.useFakeTimers();
    try {
      const port = createObsidianRequestPort(() => new Promise<never>(() => undefined), 100);
      const pending = port({ url: "https://example.com/slow" });
      const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

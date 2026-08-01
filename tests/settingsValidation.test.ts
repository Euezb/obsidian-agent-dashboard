import { describe, expect, it } from "vitest";
import {
  normalizeCodexExecutableInput,
  normalizeGithubSecretName,
  normalizeTtlMinutes,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
} from "../src/settings/settingsValidation";

describe("settings validation", () => {
  it.each([
    [String.raw`Daily\Journal`, "Daily/Journal"],
    ["  Dashboard/cache  ", "Dashboard/cache"],
  ])("normalizes a safe Vault-relative folder", (input, expected) => {
    expect(normalizeVaultRelativeFolder(input)).toBe(expected);
  });

  it.each([
    "", "/absolute", String.raw`\rooted`, String.raw`C:\Vault\cache`,
    String.raw`\\server\share`, "Dashboard/../outside", "Dashboard/./cache",
    "Dashboard//cache", "Dashboard/cache.", "Dashboard/CON", "Dashboard/ca?che",
  ])("rejects unsafe Vault folder %j", (input) => {
    expect(normalizeVaultRelativeFolder(input)).toBeNull();
  });

  it.each([
    [0, 15], [15, 15], [60.9, 60], [1440, 1440], [2000, 1440],
  ])("clamps TTL %s to %s", (input, expected) => {
    expect(normalizeTtlMinutes(input)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects non-finite TTL %s", (input) => {
    expect(normalizeTtlMinutes(input)).toBeNull();
  });

  it("trims and deduplicates RSS URLs while preserving order", () => {
    expect(parseRssFeedLines(" https://example.com/a \n\nhttp://example.com/b\nhttps://example.com/a "))
      .toEqual({ ok: true, feeds: ["https://example.com/a", "http://example.com/b"] });
  });

  it.each(["ftp://example.com/feed", "not a url", "https://example.com\nfile:///secret"])(
    "rejects the complete RSS edit when any line is invalid",
    (input) => expect(parseRssFeedLines(input)).toEqual({ ok: false, feeds: [] }),
  );

  it("accepts only the PATH sentinel or a safe absolute Windows exe path", () => {
    expect(normalizeCodexExecutableInput(" codex ")).toBe("codex");
    expect(normalizeCodexExecutableInput(String.raw` C:\Tools\Codex\codex.exe `))
      .toBe(String.raw`C:\Tools\Codex\codex.exe`);
    expect(normalizeCodexExecutableInput("codex.cmd")).toBeNull();
    expect(normalizeCodexExecutableInput(String.raw`C:\Tools\..\codex.exe`)).toBeNull();
    expect(normalizeCodexExecutableInput(String.raw`\\server\codex.exe`)).toBeNull();
  });

  it("accepts only SecretStorage-compatible key names", () => {
    expect(normalizeGithubSecretName(" github-token ")).toBe("github-token");
    expect(normalizeGithubSecretName("")).toBe("");
    expect(normalizeGithubSecretName("GitHub Token")).toBeNull();
    expect(normalizeGithubSecretName("github_token")).toBeNull();
  });
});

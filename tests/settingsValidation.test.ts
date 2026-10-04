import { describe, expect, it } from "vitest";
import {
  missingVaultFolders,
  normalizeGithubSecretName,
  normalizePanelWidth,
  normalizeTtlMinutes,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
  parseVaultFolderLines,
} from "../src/settings/settingsValidation";

describe("missingVaultFolders", () => {
  it("reports only the paths the Vault does not contain", () => {
    expect(missingVaultFolders(["代办事项", "Daily"], (path) => path === "Daily"))
      .toEqual(["代办事项"]);
  });

  it("reports nothing for the whole-Vault scope", () => {
    expect(missingVaultFolders([], () => false)).toEqual([]);
  });

  it("keeps the typed order when several folders are missing", () => {
    expect(missingVaultFolders(["B", "A", "C"], (path) => path === "C")).toEqual(["B", "A"]);
  });
});

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

  it.each([
    [0, 0], [-5, 0], [300.4, 300], [100, 240], [240, 240], [640, 640], [5000, 1200],
  ])("clamps a dragged notes-column width %s to %s", (input, expected) => {
    expect(normalizePanelWidth(input)).toBe(expected);
  });

  it("rejects a non-finite notes-column width", () => {
    expect(normalizePanelWidth(Number.NaN)).toBeNull();
    expect(normalizePanelWidth(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("trims and deduplicates RSS URLs while preserving order", () => {
    expect(parseRssFeedLines(" https://example.com/a \n\nhttp://example.com/b\nhttps://example.com/a "))
      .toEqual({ ok: true, feeds: ["https://example.com/a", "http://example.com/b"] });
  });

  it.each(["ftp://example.com/feed", "not a url", "https://example.com\nfile:///secret"])(
    "rejects the complete RSS edit when any line is invalid",
    (input) => expect(parseRssFeedLines(input)).toEqual({ ok: false, feeds: [] }),
  );


  it("accepts only SecretStorage-compatible key names", () => {
    expect(normalizeGithubSecretName(" github-token ")).toBe("github-token");
    expect(normalizeGithubSecretName("")).toBe("");
    expect(normalizeGithubSecretName("GitHub Token")).toBeNull();
    expect(normalizeGithubSecretName("github_token")).toBeNull();
  });

  it("parses one Vault-relative task folder per line and deduplicates case-insensitively", () => {
    expect(parseVaultFolderLines(" Daily \n\nProjects\\Plans\ndaily\n  \nInbox "))
      .toEqual({ ok: true, folders: ["Daily", "Projects/Plans", "Inbox"] });
    expect(parseVaultFolderLines("")).toEqual({ ok: true, folders: [] });
  });

  it.each([
    "/absolute",
    String.raw`C:\Vault`,
    "../outside",
    "Daily\n../outside",
    "Daily/\n\nCON",
  ])("rejects the complete task folder edit when any line is unsafe", (input) => {
    expect(parseVaultFolderLines(input)).toEqual({ ok: false, folders: [] });
  });
});

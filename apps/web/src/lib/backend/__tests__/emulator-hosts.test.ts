import { afterEach, describe, it, expect, vi } from "vitest";

import {
  assertThrowawayEmulator,
  emulatorHosts,
} from "./emulator-hosts";

describe("emulatorHosts", () => {
  it("defaults to the standard ports", () => {
    expect(emulatorHosts({})).toEqual({
      firestore: "127.0.0.1:8080",
      auth: "127.0.0.1:9099",
      firestorePort: 8080,
      authPort: 9099,
      storage: "127.0.0.1:19199",
      storagePort: 19199,
    });
  });

  it("reads both hosts from the environment", () => {
    expect(
      emulatorHosts({
        FIRESTORE_EMULATOR_HOST: "localhost:18080",
        FIREBASE_AUTH_EMULATOR_HOST: "localhost:19099",
        FIREBASE_STORAGE_EMULATOR_HOST: "localhost:19290",
      }),
    ).toEqual({
      firestore: "localhost:18080",
      auth: "localhost:19099",
      firestorePort: 18080,
      authPort: 19099,
      storage: "localhost:19290",
      storagePort: 19290,
    });
  });
});

const BOTH = {
  FIRESTORE_EMULATOR_HOST: "fs:1",
  FIREBASE_AUTH_EMULATOR_HOST: "au:2",
};

/** A fake emulator pair: records every request, answers the two inspection calls. */
function fakeEmulators(data: { collectionIds?: string[]; userInfo?: unknown[]; objects?: string[] }) {
  const calls: { method: string; url: string }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ method: init?.method ?? "GET", url: u });
    if (u.endsWith(":listCollectionIds"))
      return new Response(JSON.stringify({ collectionIds: data.collectionIds }));
    if (u.endsWith("/accounts:query"))
      return new Response(JSON.stringify({ userInfo: data.userInfo }));
    if (u.endsWith("/o")) return new Response(JSON.stringify({ items: (data.objects ?? []).map((name) => ({ name })) }));
    return new Response("ok");
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("assertThrowawayEmulator", () => {
  it("passes on empty emulators, asking each host with a POST", async () => {
    const { f, calls } = fakeEmulators({});
    await expect(assertThrowawayEmulator(BOTH, f)).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        method: "POST",
        url: "http://fs:1/v1/projects/demo-alter-ego/databases/(default)/documents:listCollectionIds",
      },
      {
        method: "POST",
        url: "http://au:2/identitytoolkit.googleapis.com/v1/projects/demo-alter-ego/accounts:query",
      },
      { method: "GET", url: "http://127.0.0.1:19199/v0/b/demo-alter-ego.appspot.com/o" },
    ]);
  });

  it("refuses Firestore data, even one that looks marked by an earlier run", async () => {
    const { f } = fakeEmulators({ collectionIds: ["users", "test_sentinel"] });
    await expect(assertThrowawayEmulator(BOTH, f)).rejects.toThrow(
      /Refusing to wipe the emulators at fs:1, au:2 and 127.0.0.1:19199/,
    );
  });

  it("refuses Auth accounts while Firestore is empty", async () => {
    const { f } = fakeEmulators({ userInfo: [{ localId: "u" }] });
    await expect(assertThrowawayEmulator(BOTH, f)).rejects.toThrow(
      /1 Auth accounts/,
    );
  });

  it("refuses Storage objects while Firestore and Auth are empty, naming the host", async () => {
    const { f } = fakeEmulators({ objects: ["users/u1/company-files/a.xml"] })
    await expect(assertThrowawayEmulator({ ...BOTH, FIREBASE_STORAGE_EMULATOR_HOST: "st:3" }, f)).rejects.toThrow(
      /Refusing to wipe the emulators at fs:1, au:2 and st:3.*1 Storage objects/s,
    )
  })

  it.each([
    { FIRESTORE_EMULATOR_HOST: "fs:1" },
    { FIREBASE_AUTH_EMULATOR_HOST: "au:2" },
  ])("refuses when only one host is set (%o), before any request", async (env) => {
    const { f, calls } = fakeEmulators({});
    await expect(assertThrowawayEmulator(env, f)).rejects.toThrow(/together/);
    expect(calls).toEqual([]);
  });
});

describe("global setup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { collectionIds: ["api_keys_index"] },
    { objects: ["users/u1/company-files/a.xml"] },
  ])("never sends a DELETE when the guard refuses (%o), teardown included", async (data) => {
    const { f, calls } = fakeEmulators(data);
    vi.stubGlobal("fetch", f);
    const { setup, teardown } = await import(
      "../../../../vitest.emulator.global-setup"
    );
    await expect(setup()).rejects.toThrow(/Refusing to wipe/);
    await teardown();
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
  });
});

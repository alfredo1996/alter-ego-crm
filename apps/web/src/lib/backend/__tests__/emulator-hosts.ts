/**
 * The one place the emulator suite learns where its emulators are. Test-only.
 *
 * Reads FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (the variables
 * the Firebase tools already use), defaulting to the standard ports. Every
 * seed, wipe and connection in the suite goes through here, so pointing the
 * suite at another emulator is one env change and no file edit.
 */

export const TEST_PROJECT_ID = "demo-alter-ego";
/** The bucket vitest.emulator.ts configures (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET). */
export const TEST_STORAGE_BUCKET = "demo-alter-ego.appspot.com";

export interface EmulatorHosts {
  /** host:port, as the Admin SDK reads it */
  firestore: string;
  auth: string;
  /** The Storage emulator (invoice files). Defaults to 19199, off Firebase's 9199. */
  storage: string;
  firestorePort: number;
  authPort: number;
  storagePort: number;
}

export function emulatorHosts(
  env: Record<string, string | undefined> = process.env,
): EmulatorHosts {
  const firestore = env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const auth = env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  const storage = env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:19199";
  const port = (hostPort: string) => Number(hostPort.split(":").pop());
  return {
    firestore,
    auth,
    firestorePort: port(firestore),
    authPort: port(auth),
    storage,
    storagePort: port(storage),
  };
}

export function firestoreRestBase(firestoreHost: string): string {
  return `http://${firestoreHost}/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`;
}

/** Where the Storage emulator lists and deletes objects. */
export function storageObjectsBase(storageHost: string): string {
  return `http://${storageHost}/v0/b/${TEST_STORAGE_BUCKET}/o`;
}

/** The names of the objects the Storage emulator holds. */
export async function listStorageObjects(
  storageHost: string,
  doFetch: typeof fetch = fetch,
): Promise<string[]> {
  const res = await doFetch(storageObjectsBase(storageHost), {
    headers: { Authorization: "Bearer owner" },
  });
  if (!res.ok) throw new Error(`Cannot inspect the Storage emulator at ${storageHost}: ${res.status}`);
  const { items = [] } = (await res.json()) as { items?: { name: string }[] };
  return items.map((i) => i.name);
}

/**
 * Throws unless all three emulators are throwaway: hosts set together, no Firestore
 * collection, no Auth account, no Storage object. The wipe is project-scoped and the owner's
 * long-lived emulator uses the same project id, so the id cannot tell them
 * apart: its data can. A crashed run leaves data behind; recreate the
 * container (`docker rm -f`) rather than loosen this. Run before any delete.
 */
export async function assertThrowawayEmulator(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  // Half a redirect would inspect one emulator and wipe the other.
  if (!env.FIRESTORE_EMULATOR_HOST !== !env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error(
      "Set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST together, or neither.",
    );
  const { firestore, auth, storage } = emulatorHosts(env);
  const post = async (url: string) => {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) throw new Error(`Cannot inspect the emulator at ${url}: ${res.status}`);
    return (await res.json()) as {
      collectionIds?: string[];
      userInfo?: unknown[];
    };
  };
  const { collectionIds = [] } = await post(
    `${firestoreRestBase(firestore)}:listCollectionIds`,
  );
  const { userInfo = [] } = await post(
    `http://${auth}/identitytoolkit.googleapis.com/v1/projects/${TEST_PROJECT_ID}/accounts:query`,
  );
  const objects = await listStorageObjects(storage, doFetch);
  if (collectionIds.length > 0 || userInfo.length > 0 || objects.length > 0) {
    throw new Error(
      `Refusing to wipe the emulators at ${firestore}, ${auth} and ${storage}: they hold data ` +
        `(${collectionIds.join(", ") || "no collections"}; ${userInfo.length} Auth accounts; ` +
        `${objects.length} Storage objects), so they are not throwaway test emulators. Point ` +
        `FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST ` +
        `at your own fresh container.`,
    );
  }
}

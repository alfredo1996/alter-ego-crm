/**
 * The one Firebase uid that may write (#389): an opaque id, not an email.
 * The rules hold the same literal (`isAllowedUser` in firestore/base.rules, `owner()` in
 * storage.rules); firestore-rules-owner.test.ts fails if they drift. The Admin SDK
 * routes bypass the rules, so they check this one.
 */
export const OWNER_UID = "AF95t2LVcpYfm9iecrisGyaM2mC2"

/** The check the Admin SDK routes make; the emulator suite swaps it for an open one (vitest.emulator.ts). */
export const isOwner = (uid: string): boolean => uid === OWNER_UID

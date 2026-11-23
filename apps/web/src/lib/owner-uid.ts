/** What a copy carries until `pnpm setup:owner <uid>` runs. It is refused everywhere the owner is checked. */
export const OWNER_UID_PLACEHOLDER = "OWNER_UID_NOT_SET"

/**
 * The one Firebase uid that may write (#389): an opaque id, not an email, set by
 * `pnpm setup:owner <uid>` (#32). The rules hold the same value (`isAllowedUser` in
 * firestore/base.rules and in storage.rules); setup-owner.test.ts fails if they drift. The Admin
 * SDK routes bypass the rules, so they check this one. Annotated `string` so that comparing it with the
 * placeholder type-checks whatever uid setup:owner writes (a literal type makes that TS2367).
 */
export const OWNER_UID: string = "OWNER_UID_NOT_SET"

/**
 * The check the Admin SDK routes make; the emulator suite swaps it for an open one (vitest.emulator.ts).
 * Under the placeholder nobody is the owner, not even a token whose uid is the placeholder.
 */
export const isOwner = (uid: string): boolean => uid !== OWNER_UID_PLACEHOLDER && uid === OWNER_UID

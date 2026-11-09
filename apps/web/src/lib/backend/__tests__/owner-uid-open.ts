/**
 * Stands in for `@/lib/owner-uid` in the emulator suite (vitest.emulator.ts): it signs up
 * random users, which production's one-uid check on the Admin SDK routes would refuse.
 * The real check is proven in the route tests (api-keys-routes, oauth authorize).
 */
export { OWNER_UID } from "../../owner-uid"
export const isOwner = (): boolean => true

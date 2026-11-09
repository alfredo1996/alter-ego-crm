import { pinServerTimeZone } from "@alter-ego/kernel/dates"

/** Next.js runs this once per server instance, before any request is handled. */
export function register() {
  pinServerTimeZone()
}

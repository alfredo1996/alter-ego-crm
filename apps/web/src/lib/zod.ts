import { z } from "zod"

// zod probes `Function("")` on its first parse to see if it may JIT; under our CSP that
// reports a script-src 'unsafe-eval' violation on every page. Jitless parses the same.
// Every module imports `z` from here (ESLint enforces it), so this runs before any parse.
z.config({ jitless: true })

export { z }

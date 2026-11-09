import "@testing-library/jest-dom/vitest"
import { afterAll } from "vitest"

import { cancelWindowTimers, trackTimers } from "./vitest.teardown"

// Radix Toast arms a timer and never clears it on unmount; when the worker tears the file's
// happy-dom down first, the timer fires into a missing `document` and fails the run (#454).
trackTimers()
afterAll(cancelWindowTimers)

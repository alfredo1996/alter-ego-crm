import { describeMonthlyTotalPaths } from "@/lib/backend/__tests__/monthly-totals-paths"
import { createMockAdapter } from "@/lib/backend/mock"

// totalsDelta, afterUpdate and the budget loader are tested in @alter-ego/finance; this runs the shared
// helper (which the emulator suite runs too) against the composed mock.
const mock = createMockAdapter().db
let users = 0
describeMonthlyTotalPaths("mock", mock, async () => `u${++users}`)

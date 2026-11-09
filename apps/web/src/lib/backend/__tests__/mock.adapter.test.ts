import { createMockAdapter, __resetMockState, __seedLegacyInvoice, __seedLegacyTask } from "../mock"
import { describeAdapterContract } from "./adapter-contract"

describeAdapterContract("mock", async () => {
  __resetMockState()
  return {
    db: createMockAdapter().db,
    files: createMockAdapter().files,
    userId: "contract-user-1",
    otherUserId: "contract-user-2",
    seedLegacyTask: async (engagementId, title) => __seedLegacyTask("contract-user-1", engagementId, title).id,
    seedLegacyInvoice: async (engagementId, number) => __seedLegacyInvoice("contract-user-1", engagementId, number).id,
    cleanup: async () => {
      __resetMockState()
    },
  }
})

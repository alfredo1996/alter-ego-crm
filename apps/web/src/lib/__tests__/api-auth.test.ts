import { describe, it, expect, beforeEach } from "vitest"

import { hashApiKey, validateApiKey, apiError } from "@/lib/api-auth"
import { __resetMockState, createMockAdapter } from "@/lib/backend/mock"

import type { ServerDb } from "@/lib/backend/server-db"

describe("api-auth", () => {
  beforeEach(() => {
    __resetMockState()
  })

  describe("hashApiKey", () => {
    it("returns a hex string", async () => {
      const hash = await hashApiKey("test-key-123")
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it("is deterministic", async () => {
      const hash1 = await hashApiKey("same-key")
      const hash2 = await hashApiKey("same-key")
      expect(hash1).toBe(hash2)
    })

    it("produces different hashes for different keys", async () => {
      const hash1 = await hashApiKey("key-a")
      const hash2 = await hashApiKey("key-b")
      expect(hash1).not.toBe(hash2)
    })
  })

  describe("validateApiKey", () => {
    it("returns null for missing Authorization header", async () => {
      const request = new Request("http://localhost/api/test")
      const result = await validateApiKey(request)
      expect(result).toBeNull()
    })

    it("returns null for non-Bearer auth", async () => {
      const request = new Request("http://localhost/api/test", {
        headers: { Authorization: "Basic abc123" },
      })
      const result = await validateApiKey(request)
      expect(result).toBeNull()
    })

    it("returns null for empty Bearer token", async () => {
      const request = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer " },
      })
      const result = await validateApiKey(request)
      expect(result).toBeNull()
    })

    it("returns userId for valid key", async () => {
      const mock = createMockAdapter()
      // Sign in to create a user
      await mock.auth.signIn("test@test.com", "password")
      const { key } = await mock.db.createApiKey("mock-user-1")

      const request = new Request("http://localhost/api/test", {
        headers: { Authorization: `Bearer ${key}` },
      })
      const result = await validateApiKey(request)
      expect(result).toBe("mock-user-1")
    })

    it("returns null for invalid key", async () => {
      const request = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer invalid-key-xyz" },
      })
      const result = await validateApiKey(request)
      expect(result).toBeNull()
    })
  })

  describe("apiError", () => {
    it("returns JSON error response with correct status", async () => {
      const response = apiError("TEST_ERROR", "Something went wrong", 400)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe("TEST_ERROR")
      expect(body.error.message).toBe("Something went wrong")
    })

    it("includes details when provided", async () => {
      const details = [{ field: "email", message: "required" }]
      const response = apiError("VALIDATION_ERROR", "Invalid input", 400, details)
      const body = await response.json()
      expect(body.error.details).toEqual(details)
    })

    it("omits details when not provided", async () => {
      const response = apiError("NOT_FOUND", "Not found", 404)
      const body = await response.json()
      expect(body.error.details).toBeUndefined()
    })
  })
})

describe("mock API key CRUD", () => {
  beforeEach(() => {
    __resetMockState()
  })

  it("createApiKey returns raw key and id", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    const { key, id } = await mock.db.createApiKey("mock-user-1")
    expect(key).toBeTruthy()
    expect(key.startsWith("ak_")).toBe(true)
    expect(id).toBeTruthy()
  })

  it("getApiKeys lists keys with prefix only", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    await mock.db.createApiKey("mock-user-1")
    await mock.db.createApiKey("mock-user-1")

    const keys = await mock.db.getApiKeys("mock-user-1")
    expect(keys.length).toBe(2)
    expect(keys[0].prefix).toContain("...")
    expect(keys[0].id).toBeTruthy()
    expect(keys[0].createdAt).toBeInstanceOf(Date)
  })

  it("deleteApiKey removes the key", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    const { id } = await mock.db.createApiKey("mock-user-1")

    await mock.db.deleteApiKey("mock-user-1", id)
    const keys = await mock.db.getApiKeys("mock-user-1")
    expect(keys.length).toBe(0)
  })

  it("validateApiKey returns null after deletion", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    const { key, id } = await mock.db.createApiKey("mock-user-1")

    // Hash the key like api-auth does
    const keyHash = await hashApiKey(key)
    expect(await (mock.db as unknown as ServerDb).validateApiKey(keyHash)).toBe("mock-user-1")

    await mock.db.deleteApiKey("mock-user-1", id)
    expect(await (mock.db as unknown as ServerDb).validateApiKey(keyHash)).toBeNull()
  })

  it("user isolation: user B cannot delete user A's key", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    const { key, id } = await mock.db.createApiKey("mock-user-1")

    // Try to delete as different user
    await mock.db.deleteApiKey("other-user", id)

    // Key should still be valid
    const keyHash = await hashApiKey(key)
    expect(await (mock.db as unknown as ServerDb).validateApiKey(keyHash)).toBe("mock-user-1")
  })

  it("user B sees empty list for user A's keys", async () => {
    const mock = createMockAdapter()
    await mock.auth.signIn("test@test.com", "password")
    await mock.db.createApiKey("mock-user-1")

    const otherKeys = await mock.db.getApiKeys("other-user")
    expect(otherKeys.length).toBe(0)
  })
})

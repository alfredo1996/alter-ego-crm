/**
 * useAuth is one app-wide store. Each caller used to keep its own state and
 * start at user=null, so every page mounted under AuthGuard rendered once as
 * signed out: its queries started disabled and its empty state flashed.
 * Runs against the real mock backend.
 */

import { act, render, renderHook, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"

import { __resetAuthState, useAuth } from "@/hooks/use-auth"
import { getBackend } from "@/lib/backend"
import { __resetMockState } from "@/lib/backend/mock"

/** Shows, and records per render, what useAuth returned. */
function Probe({ id, seen = [] }: { id: string; seen?: string[] }) {
  const { user, loading } = useAuth()
  const view = loading ? "loading" : (user?.displayName ?? "signed-out")
  seen.push(view)
  return <p data-testid={id}>{view}</p>
}

afterEach(() => {
  vi.restoreAllMocks()
  // The store outlives a test; the mock's reset also drops its auth listeners.
  __resetMockState()
  __resetAuthState()
})

it("resolves from loading to signed out when nobody is signed in", () => {
  const seen: string[] = []
  render(<Probe id="a" seen={seen} />)
  expect(seen[0]).toBe("loading")
  expect(screen.getByTestId("a")).toHaveTextContent("signed-out")
})

it("gives a component mounted after auth resolved the user on its first render", async () => {
  await getBackend().auth.signIn("ada@example.com", "pw")
  render(<Probe id="guard" />)
  expect(screen.getByTestId("guard")).toHaveTextContent("ada")

  const page: string[] = []
  render(<Probe id="page" seen={page} />)
  expect(page[0]).toBe("ada")
})

it("notifies every subscriber of a sign-in and a sign-out", async () => {
  render(<><Probe id="a" /><Probe id="b" /></>)
  await act(() => getBackend().auth.signIn("ada@example.com", "pw"))
  expect(screen.getByTestId("a")).toHaveTextContent("ada")
  expect(screen.getByTestId("b")).toHaveTextContent("ada")

  await act(() => getBackend().auth.signOut())
  expect(screen.getByTestId("a")).toHaveTextContent("signed-out")
  expect(screen.getByTestId("b")).toHaveTextContent("signed-out")
})

it("refreshUser propagates a changed user to every subscriber", async () => {
  const user = await getBackend().auth.signIn("ada@example.com", "pw")
  render(<><Probe id="a" /><Probe id="b" /></>)
  const { result } = renderHook(() => useAuth())
  vi.spyOn(getBackend().auth, "getCurrentUser").mockResolvedValue({ ...user, displayName: "Grace" })

  await act(() => result.current.refreshUser())
  expect(screen.getByTestId("a")).toHaveTextContent("Grace")
  expect(screen.getByTestId("b")).toHaveTextContent("Grace")
})

it("signUp keeps the display name the backend set after announcing the user", async () => {
  // Firebase: onAuthStateChanged fires on account creation, before updateProfile
  // sets the name, and the profile update itself is never announced.
  const auth = getBackend().auth
  const realSignUp = auth.signUp.bind(auth)
  vi.spyOn(auth, "signUp").mockImplementation(async (email, password) => {
    const announced = await realSignUp(email, password, "")
    return { ...announced, displayName: "Ada" }
  })
  render(<Probe id="nav" />)
  const { result } = renderHook(() => useAuth())

  await act(() => result.current.signUp("ada@example.com", "pw", "Ada"))
  expect(screen.getByTestId("nav")).toHaveTextContent("Ada")
})

it("keeps the snapshot when refreshUser finds the same user, so nothing re-renders", async () => {
  await getBackend().auth.signIn("ada@example.com", "pw")
  const seen: string[] = []
  render(<Probe id="a" seen={seen} />)
  const { result } = renderHook(() => useAuth())
  const renders = seen.length

  await act(() => result.current.refreshUser())
  expect(seen).toHaveLength(renders)
})

it("renders the loading state on the server even when the client knows the user", async () => {
  await getBackend().auth.signIn("ada@example.com", "pw")
  render(<Probe id="client" />)
  expect(screen.getByTestId("client")).toHaveTextContent("ada")

  expect(renderToString(<Probe id="server" />)).toContain("loading")
})

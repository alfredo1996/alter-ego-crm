/**
 * The app's mutation hooks all define onSuccess and nothing else, so before this
 * every rejected write was silent: no toast, no console, and a UI that simply did
 * not change. The single MutationCache handler in Providers is what makes a
 * Firestore rule rejection or a dropped connection visible, so it gets a test.
 */

import { useMutation, useQuery } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, it, expect, vi } from "vitest"

import { exposesBackend, Providers } from "../providers"

function FailingMutation() {
  const mutation = useMutation({
    mutationFn: async () => {
      throw new Error("Missing or insufficient permissions.")
    },
  })
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      salva
    </button>
  )
}

// Note for whoever adds a sibling case: use-toast keeps its state in a module-level
// store, so toasts survive across tests in this file. Assert on presence, not absence.
describe("Providers mutation error handling", () => {
  it("surfaces a rejected mutation as a toast carrying the reason", async () => {
    render(
      <Providers>
        <FailingMutation />
      </Providers>,
    )

    screen.getByText("salva").click()

    await waitFor(() => expect(screen.getByText("Change not saved")).toBeInTheDocument())
    // The Firestore message is what tells you WHICH rule refused the write.
    expect(screen.getByText("Missing or insufficient permissions.")).toBeInTheDocument()
  })

  // A background write nobody clicked (an automatic one) must still fail, but not with a toast.
  it("keeps a meta.silent mutation's failure out of the toasts", async () => {
    function BackgroundWrite() {
      const write = useMutation({
        meta: { silent: true },
        mutationFn: async () => {
          throw new Error("offline snapshot")
        },
      })
      return (
        <button type="button" onClick={() => write.mutate()}>
          {write.status}
        </button>
      )
    }
    render(
      <Providers>
        <BackgroundWrite />
      </Providers>,
    )

    screen.getByText("idle").click()

    // The cache-level onError runs before the mutation settles, so by "error" a toast would be up.
    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument())
    expect(screen.queryByText("offline snapshot")).not.toBeInTheDocument()
  })
})

// A tab left open used to keep its data until a visibilitychange: clicking back
// into a window that never went hidden refetched nothing. And a background
// refresh changed the page with no sign it was coming.
describe("Providers background refresh", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("refetches a query older than staleTime when the window regains focus", async () => {
    const queryFn = vi.fn().mockResolvedValue("dati")
    function Reader() {
      return <span>{useQuery({ queryKey: ["focus"], queryFn }).data ?? "attesa"}</span>
    }
    render(
      <Providers>
        <Reader />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByText("dati")).toBeInTheDocument())

    const focus = () =>
      act(async () => {
        window.dispatchEvent(new Event("focus"))
        await new Promise((r) => setTimeout(r, 10))
      })

    // Fresh data stays put: focus costs no Firestore reads inside staleTime.
    await focus()
    expect(queryFn).toHaveBeenCalledTimes(1)

    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000)
    await focus()
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  function Fetching({ ms }: { ms: number }) {
    const { data } = useQuery({
      queryKey: ["slow", ms],
      queryFn: () => new Promise<string>((r) => setTimeout(() => r("pronto"), ms)),
    })
    return <span>{data ?? "attesa"}</span>
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it("shows the top bar only while a query fetches, and only after 300 ms", async () => {
    vi.useFakeTimers()
    render(
      <Providers>
        <Fetching ms={1000} />
      </Providers>,
    )

    await advance(250)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    await advance(100)
    expect(screen.getByRole("progressbar", { name: "Refreshing data" })).toBeInTheDocument()

    await advance(1000)
    expect(screen.getByText("pronto")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("never shows the bar for a fetch faster than the delay", async () => {
    vi.useFakeTimers()
    render(
      <Providers>
        <Fetching ms={100} />
      </Providers>,
    )

    await advance(50)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    await advance(100)
    expect(screen.getByText("pronto")).toBeInTheDocument()
    // The pending 300 ms timer must die with the fetch, not pop the bar up late.
    await advance(1000)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})

// window.__mockBackend is how e2e specs and `pnpm seed:demo` write data. The
// emulator gets it too; a production Firebase build must not.
describe("exposesBackend", () => {
  it("exposes the mock and Firebase on the emulator, not Firebase without it", () => {
    expect(exposesBackend({ NEXT_PUBLIC_BACKEND: "mock", NEXT_PUBLIC_USE_EMULATOR: false })).toBe(true)
    expect(exposesBackend({ NEXT_PUBLIC_BACKEND: "firebase", NEXT_PUBLIC_USE_EMULATOR: true })).toBe(true)
    expect(exposesBackend({ NEXT_PUBLIC_BACKEND: "firebase", NEXT_PUBLIC_USE_EMULATOR: false })).toBe(false)
  })
})

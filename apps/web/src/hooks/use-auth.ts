"use client"

import { useSyncExternalStore } from "react"

import { getBackend } from "@/lib/backend"

import type { User } from "@/types"

interface AuthState {
  user: User | null
  loading: boolean
}

// One auth state for the whole app. Per-component state made every page under
// AuthGuard render once with user=null, since the backend reports the user in a
// callback after mount; its queries started disabled and its empty state flashed.
// The server snapshot is always "loading", so SSR matches AuthGuard's spinner.
const SERVER_STATE: AuthState = { user: null, loading: true }
let state = SERVER_STATE
let unsubscribeBackend: (() => void) | null = null
const listeners = new Set<() => void>()

function setUser(user: User | null) {
  // A new object only on a real change: useSyncExternalStore re-renders (and
  // would loop) whenever getSnapshot returns a different reference.
  if (!state.loading && state.user === user) return
  state = { user, loading: false }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // ponytail: one backend subscription for the app's lifetime, never torn down
  unsubscribeBackend ??= getBackend().auth.onAuthStateChanged(setUser)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => state
const getServerSnapshot = () => SERVER_STATE

/** Test-only: forget the shared state and the backend subscription. */
export function __resetAuthState() {
  unsubscribeBackend?.()
  unsubscribeBackend = null
  state = SERVER_STATE
}

const signIn = (email: string, password: string) => getBackend().auth.signIn(email, password)
// Firebase announces the new user before signUp sets its display name, and the
// profile update is not announced, so take the user signUp returns (mapped after it).
async function signUp(email: string, password: string, displayName: string) {
  const user = await getBackend().auth.signUp(email, password, displayName)
  setUser(user)
  return user
}
const signOut = () => getBackend().auth.signOut()
const getIdToken = () => getBackend().auth.getIdToken()

/** Re-reads the user after a change the backend does not announce (a Firebase profile update). */
async function refreshUser() {
  setUser(await getBackend().auth.getCurrentUser())
}

export function useAuth() {
  const { user, loading } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    getIdToken,
    refreshUser,
    isAuthenticated: !!user,
  }
}

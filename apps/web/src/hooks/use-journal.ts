"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateJournalEntryInput, JournalEntry, UpdateJournalEntryInput } from "@/types"

const JOURNAL_KEY = ["journal"] as const

export const useJournal = createListHook(JOURNAL_KEY, (userId) => getBackend().db.getJournal(userId))

export const useCreateJournalEntry = createMutationHook<CreateJournalEntryInput, JournalEntry>(
  JOURNAL_KEY,
  (userId, input) => getBackend().db.createJournalEntry(userId, input),
)

export const useUpdateJournalEntry = createUpdateHook<UpdateJournalEntryInput>(
  JOURNAL_KEY,
  (userId, entryId, input) => getBackend().db.updateJournalEntry(userId, entryId, input),
)

export const useDeleteJournalEntry = createDeleteHook(JOURNAL_KEY, (userId, entryId) => getBackend().db.deleteJournalEntry(userId, entryId))

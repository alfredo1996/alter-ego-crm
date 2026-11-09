"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateMeetingInput, Meeting, UpdateMeetingInput } from "@/types"

const MEETINGS_KEY = ["meetings"] as const

export const useMeetings = createListHook(
  MEETINGS_KEY,
  (userId) => getBackend().db.getMeetings(userId),
)

export const useCreateMeeting = createMutationHook<CreateMeetingInput, Meeting>(
  MEETINGS_KEY,
  (userId, input) => getBackend().db.createMeeting(userId, input),
)

export const useUpdateMeeting = createUpdateHook<UpdateMeetingInput>(
  MEETINGS_KEY,
  (userId, meetingId, input) => getBackend().db.updateMeeting(userId, meetingId, input),
)

export const useDeleteMeeting = createDeleteHook(
  MEETINGS_KEY,
  (userId, meetingId) => getBackend().db.deleteMeeting(userId, meetingId),
)

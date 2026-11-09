"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { Collaborator, CreateCollaboratorInput, UpdateCollaboratorInput } from "@/types"

const COLLABORATORS_KEY = ["collaborators"] as const

export const useCollaborators = createListHook(
  COLLABORATORS_KEY,
  (userId) => getBackend().db.getCollaborators(userId),
)

export const useCreateCollaborator = createMutationHook<CreateCollaboratorInput, Collaborator>(
  COLLABORATORS_KEY,
  (userId, input) => getBackend().db.createCollaborator(userId, input),
)

export const useUpdateCollaborator = createUpdateHook<UpdateCollaboratorInput>(
  COLLABORATORS_KEY,
  (userId, collaboratorId, input) => getBackend().db.updateCollaborator(userId, collaboratorId, input),
)

export const useDeleteCollaborator = createDeleteHook(
  COLLABORATORS_KEY,
  (userId, collaboratorId) => getBackend().db.deleteCollaborator(userId, collaboratorId),
  [["assignments"]],
)

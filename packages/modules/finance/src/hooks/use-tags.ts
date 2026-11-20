"use client"

import { getBackend } from "../host"
import { createListHook, createMutationHook, createDeleteHook } from "./create-crud-hooks"

import type { CreateTagInput } from "../types"

const TAGS_KEY = ["tags"] as const

export const useTags = createListHook(
  TAGS_KEY,
  (userId) => getBackend().db.getTags(userId),
)

export const useCreateTag = createMutationHook<CreateTagInput>(
  TAGS_KEY,
  (userId, input) => getBackend().db.createTag(userId, input),
)

export const useDeleteTag = createDeleteHook(
  TAGS_KEY,
  (userId, tagId) => getBackend().db.deleteTag(userId, tagId),
  [["transactions"]],
)

"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateTaskInput, Task, UpdateTaskInput } from "@/types"

const TASKS_KEY = ["tasks"] as const

export const useTasks = createListHook(
  TASKS_KEY,
  (userId) => getBackend().db.getTasks(userId),
)

export const useCreateTask = createMutationHook<CreateTaskInput, Task>(
  TASKS_KEY,
  (userId, input) => getBackend().db.createTask(userId, input),
)

export const useUpdateTask = createUpdateHook<UpdateTaskInput>(
  TASKS_KEY,
  (userId, taskId, input) => getBackend().db.updateTask(userId, taskId, input),
)

export const useDeleteTask = createDeleteHook(
  TASKS_KEY,
  (userId, taskId) => getBackend().db.deleteTask(userId, taskId),
)

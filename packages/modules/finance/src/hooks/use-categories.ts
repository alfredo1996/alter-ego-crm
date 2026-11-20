"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { getBackend } from "../host"

import type { Category, CreateCategoryInput, UpdateCategoryInput } from "../types"

export const CATEGORIES_KEY = ["categories"] as const

export function useCategories(userId: string | undefined) {
  return useQuery({
    queryKey: [...CATEGORIES_KEY, userId],
    queryFn: () => getBackend().db.getCategories(userId!),
    enabled: !!userId,
  })
}

export function useCategoryTree(userId: string | undefined) {
  const query = useCategories(userId)

  const tree = query.data
    ? buildCategoryTree(query.data)
    : []

  return { ...query, tree }
}

export function useCreateCategory(userId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      getBackend().db.createCategory(userId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CATEGORIES_KEY, userId] })
    },
  })
}

export function useUpdateCategory(userId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ categoryId, input }: { categoryId: string; input: UpdateCategoryInput }) =>
      getBackend().db.updateCategory(userId!, categoryId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CATEGORIES_KEY, userId] })
    },
  })
}

export function useDeleteCategory(userId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (categoryId: string) =>
      getBackend().db.deleteCategory(userId!, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CATEGORIES_KEY, userId] })
    },
  })
}

export function useDeleteAllCategories(userId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => getBackend().db.deleteAllCategories(userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CATEGORIES_KEY, userId] })
    },
  })
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[]
}

function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodeMap = new Map<string, CategoryTreeNode>()
  const roots: CategoryTreeNode[] = []

  for (const category of categories) {
    nodeMap.set(category.id, { ...category, children: [] })
  }

  for (const category of categories) {
    const node = nodeMap.get(category.id)!
    if (category.parentId && nodeMap.has(category.parentId)) {
      nodeMap.get(category.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

"use client"


import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@alter-ego/ui/ui/dialog"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { useForm } from "react-hook-form"

import { CATEGORY_GROUPS } from "../../lib/options"
import { createCategorySchema, type CategoryFormValues } from "../../schemas"

import type { Category } from "../../types"

const presetColors = [
  "#22c55e", "#3b82f6", "#f97316", "#eab308", "#06b6d4",
  "#ec4899", "#8b5cf6", "#f43f5e", "#14b8a6", "#ef4444",
  "#10b981", "#6b7280",
]

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category?: Category | null
  onSubmit: (values: CategoryFormValues) => void
  isPending: boolean
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSubmit,
  isPending,
}: CategoryFormDialogProps) {
  const isEditing = !!category
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: "",
      group: "other",
      icon: "HelpCircle",
      color: "#6b7280",
    },
  })

  useEffect(() => {
    if (open) {
      if (category) {
        form.reset({
          name: category.name,
          group: category.group,
          icon: category.icon,
          color: category.color,
        })
      } else {
        form.reset({
          name: "",
          group: "other",
          icon: "HelpCircle",
          color: "#6b7280",
        })
      }
    }
  }, [open, category, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Category" : "New Category"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update category details." : "Create a custom category."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Subscriptions" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="group"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORY_GROUPS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color</FormLabel>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {presetColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => field.onChange(color)}
                          className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 pointer-coarse:size-11"
                          style={{
                            backgroundColor: color,
                            borderColor: field.value === color ? "currentColor" : "transparent",
                          }}
                          aria-label={`Select color ${color}`}
                        />
                      ))}
                    </div>
                    <FormControl>
                      <Input type="color" className="h-9 w-14 shrink-0 cursor-pointer p-1 pointer-coarse:h-11" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Category"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

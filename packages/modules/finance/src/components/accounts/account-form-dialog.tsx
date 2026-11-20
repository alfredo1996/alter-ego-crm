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
  FormDescription,
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

import { defaultKindForType } from "../../lib/net-worth"
import { accountTypeOptions, currencyOptionsShort as currencyOptions } from "../../lib/options"
import { createAccountSchema, type AccountFormValues } from "../../schemas"
import { useFinanceSettingsStore } from "../../stores/finance-settings-store"

import type { Account } from "../../types"

const BUILTIN_TYPE_VALUES = new Set(accountTypeOptions.map((o) => o.value))

interface AccountFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: Account | null
  /** Custom types already used on the user's other accounts, for suggestions. */
  existingCustomTypes?: string[]
  onSubmit: (values: AccountFormValues) => void
  isPending: boolean
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  existingCustomTypes = [],
  onSubmit,
  isPending,
}: AccountFormDialogProps) {
  const isEditing = !!account
  const defaultCurrency = useFinanceSettingsStore((s) => s.defaultCurrency)
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      name: "",
      type: "checking",
      kind: "asset",
      currency: defaultCurrency,
      balance: 0,
    },
  })

  useEffect(() => {
    if (open) {
      if (account) {
        form.reset({
          name: account.name,
          type: account.type,
          kind: account.kind ?? defaultKindForType(account.type),
          currency: account.currency,
          // Edit the opening balance, not the current (derived) balance.
          balance: account.openingBalance,
        })
      } else {
        form.reset({
          name: "",
          type: "checking",
          kind: "asset",
          currency: defaultCurrency,
          balance: 0,
        })
      }
    }
  }, [open, account, form, defaultCurrency])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Account" : "New Account"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update your account details." : "Add a new financial account."}
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
                    <Input placeholder="e.g. Main Checking" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Input
                        list="account-type-list"
                        placeholder="Pick or type a custom type"
                        {...field}
                        onChange={(e) => {
                          const value = e.target.value
                          field.onChange(value)
                          // Built-in type → auto-set its asset/liability classification.
                          if (BUILTIN_TYPE_VALUES.has(value)) {
                            form.setValue("kind", defaultKindForType(value))
                          }
                        }}
                      />
                    </FormControl>
                    <datalist id="account-type-list">
                      {accountTypeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                      {existingCustomTypes.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Counts as</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "asset"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="asset">Asset</SelectItem>
                        <SelectItem value="liability">Liability</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>How a balance above 0 reads: yours, or owed to you.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {currencyOptions.map((opt) => (
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
              name="balance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isEditing ? "Opening Balance" : "Initial Balance"}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

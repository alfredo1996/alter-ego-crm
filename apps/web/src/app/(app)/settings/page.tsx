import { SettingsShell } from "@/components/settings/settings-shell"

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Settings | Alter Ego",
}

export default function SettingsPage() {
  return <SettingsShell />
}

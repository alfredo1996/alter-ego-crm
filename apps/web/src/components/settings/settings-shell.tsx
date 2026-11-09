"use client"

import { OnThisPage } from "@alter-ego/ui/page/on-this-page"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { useToast } from "@alter-ego/ui/use-toast"
import { Sun, Moon, Monitor, Pencil } from "lucide-react"
import { useState } from "react"

import { ApiKeysSection } from "@/components/settings/api-keys-section"
import { ConnectorsSection } from "@/components/settings/connectors-section"
import { ModulesSection } from "@/components/settings/modules-section"
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section"
import { useAuth } from "@/hooks/use-auth"
import { getBackend } from "@/lib/backend"
import { useSettingsStore } from "@/stores/settings-store"

const themeOptions = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
]

export function SettingsShell() {
  const { user, loading: authLoading, refreshUser } = useAuth()
  const { theme, setTheme } = useSettingsStore()
  const { toast } = useToast()

  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDisplayName, setProfileDisplayName] = useState("")
  const [profileEmail, setProfileEmail] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  function startEditProfile() {
    setProfileDisplayName(user?.displayName ?? "")
    setProfileEmail(user?.email ?? "")
    setEditingProfile(true)
  }

  async function saveProfile() {
    setSavingProfile(true)
    try {
      await getBackend().auth.updateProfile({
        displayName: profileDisplayName,
        email: profileEmail || undefined,
      })
      await refreshUser()
      toast({ title: "Profile updated" })
      setEditingProfile(false)
    } catch (err) {
      toast({
        title: "Failed to update profile",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSavingProfile(false)
    }
  }

  if (authLoading) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-32" />
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    )
  }

  const sections = [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "modules", label: "Modules" },
    { id: "data", label: "Data" },
  ]

  return (
    <div>
      <PageHeader className="mb-6" title="Settings" subtitle="Your profile, preferences and data." />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
        <OnThisPage items={sections} aria-label="On this page" />

        <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-11">
          <SettingsSection
            id="profile"
            title="Profile"
            description="How you appear in the app."
            actions={
              !editingProfile && (
                <Button variant="outline" size="lg" onClick={startEditProfile}>
                  <Pencil />
                  Edit
                </Button>
              )
            }
          >
            {editingProfile ? (
              <SettingsRow label="Your details" stacked>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-name">Display Name</Label>
                    <Input
                      id="profile-name"
                      value={profileDisplayName}
                      onChange={(e) => setProfileDisplayName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-email">Email</Label>
                    <Input
                      id="profile-email"
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      placeholder="your@email.com"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveProfile} disabled={savingProfile}>
                      {savingProfile ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditingProfile(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </SettingsRow>
            ) : (
              <>
                <SettingsRow label="Display Name">
                  <span className="text-[15px] text-foreground">{user?.displayName ?? "Not set"}</span>
                </SettingsRow>
                <SettingsRow label="Email" hint="You sign in with this address.">
                  <span className="min-w-0 break-all text-[15px] text-foreground">{user?.email ?? "Not signed in"}</span>
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          <SettingsSection id="preferences" title="Preferences" description="How the app looks.">
            <SettingsRow label="Theme" labelId="theme-label" hint="System follows your device.">
              <SegmentedButtons
                aria-labelledby="theme-label"
                value={theme}
                onChange={setTheme}
                options={themeOptions.map(({ value, label, icon: Icon }) => ({ value, label, icon: <Icon aria-hidden className="size-[15px]" /> }))}
              />
            </SettingsRow>
          </SettingsSection>

          <ModulesSection />

          <SettingsSection id="data" title="Data" description="Let your own tools read your data.">
            <ApiKeysSection userId={user?.id} />
            <ConnectorsSection />
          </SettingsSection>

        </div>
      </div>
    </div>
  )
}

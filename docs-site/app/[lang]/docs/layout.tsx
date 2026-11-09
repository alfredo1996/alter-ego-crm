import { source } from "@/app/source"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { RootProvider } from "fumadocs-ui/provider/next"

import type { ReactNode } from "react"

import { i18n } from "@/app/i18n"


const LANGUAGE_NAMES: Record<string, string> = { en: "English", it: "Italiano" }

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }))
}

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>
  children: ReactNode
}) {
  const { lang } = await params
  return (
    <RootProvider
      i18n={{
        locale: lang,
        locales: i18n.languages.map((locale) => ({
          locale,
          name: LANGUAGE_NAMES[locale] ?? locale,
        })),
      }}
    >
      <DocsLayout
        tree={source.getPageTree(lang)}
        i18n={i18n}
        nav={{ title: "Alter Ego" }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  )
}

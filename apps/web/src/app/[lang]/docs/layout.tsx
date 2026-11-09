import "fumadocs-ui/style.css"

import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { RootProvider } from "fumadocs-ui/provider/next"


import { source } from "@/app/source"
import { i18n } from "@/lib/i18n"

import type { ReactNode } from "react"

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
        locales: i18n.languages.map((l) => ({
          locale: l,
          name: l === "en" ? "English" : "Italiano",
        })),
      }}
    >
      <DocsLayout tree={source.getPageTree(lang)} i18n>
        {children}
      </DocsLayout>
    </RootProvider>
  )
}

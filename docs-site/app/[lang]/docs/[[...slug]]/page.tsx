import { source } from "@/app/source"
import defaultMdxComponents from "fumadocs-ui/mdx"
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page"
import { notFound } from "next/navigation"


import type { Metadata } from "next"
import type { FC } from "react"

import { i18n } from "@/app/i18n"

type Params = { lang: string; slug?: string[] }

/**
 * Every page of every language, enumerated at build time — a static export has
 * no server to resolve an unlisted route at request time.
 */
export function generateStaticParams(): Params[] {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({ lang, slug: page.slugs })),
  )
}

export async function generateMetadata(props: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug, lang } = await props.params
  const page = source.getPage(slug, lang)
  if (!page) return {}
  return { title: page.data.title, description: page.data.description }
}

export default async function Page(props: { params: Promise<Params> }) {
  const { slug, lang } = await props.params
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  const data = page.data as typeof page.data & {
    body: FC
    toc: { title: string; url: string; depth: number }[]
    full?: boolean
  }
  const MDX = data.body

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  )
}

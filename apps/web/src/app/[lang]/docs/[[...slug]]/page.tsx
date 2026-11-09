import defaultMdxComponents from "fumadocs-ui/mdx"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page"
import { notFound } from "next/navigation"

import { source } from "@/app/source"
import { i18n } from "@/lib/i18n"

import type { FC } from "react"

export default async function Page(props: {
  params: Promise<{ lang: string; slug?: string[] }>
}) {
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

export function generateStaticParams() {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      slug: page.slugs,
      lang,
    })),
  )
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug?: string[] }>
}) {
  const { slug, lang } = await props.params
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
  }
}

import type { IRTable } from './ir'

/** What a generator can emit. */
export type CodeKind = 'model' | 'migration'

export interface GeneratedFile {
  filename: string
  /** Language hint for the preview (e.g. 'ts', 'python', 'php', 'sql'). */
  lang: string
  content: string
}

export interface GenerateOptions {
  /** Which kinds the user asked for (a target emits only what it supports). */
  kinds: CodeKind[]
  /** Source driver, so dialect-sensitive output (SQL, Drizzle) can adapt. */
  driver: string
}

/** One framework/package target within a language group. */
export interface Target {
  id: string
  /** Grouping label shown in the language submenu (e.g. 'TypeScript'). */
  language: string
  /** Framework/package label (e.g. 'Prisma', 'Knex migration'). */
  label: string
  /** Kinds this target is able to produce. */
  kinds: CodeKind[]
  /** Optional one-liner shown under the target in the modal. */
  note?: string
  generate: (tables: IRTable[], opts: GenerateOptions) => GeneratedFile[]
}

export type GenFn = (tables: IRTable[], opts: GenerateOptions) => GeneratedFile[]

import type { IRColumn } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, pascal } from '../ir'

function goType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'string':
    case 'text':
    case 'uuid':
      base = 'string'
      break
    case 'int':
      base = 'int'
      break
    case 'bigint':
      base = 'int64'
      break
    case 'float':
    case 'decimal':
      base = 'float64'
      break
    case 'bool':
      base = 'bool'
      break
    case 'date':
    case 'datetime':
    case 'time':
      base = 'time.Time'
      break
    case 'json':
      base = 'json.RawMessage'
      break
    case 'bytes':
      base = '[]byte'
      break
    default:
      base = 'interface{}'
  }
  // Nullable scalars become pointers (except inherently-nullable slice types).
  if (c.nullable && !['json.RawMessage', '[]byte'].includes(base)) base = '*' + base
  return base
}

const needsTime = (cols: IRColumn[]): boolean =>
  cols.some((c) => ['date', 'datetime', 'time'].includes(c.kind))
const needsJson = (cols: IRColumn[]): boolean => cols.some((c) => c.kind === 'json')

function goImports(all: IRColumn[]): string {
  const imps: string[] = []
  if (needsJson(all)) imps.push('\t"encoding/json"')
  if (needsTime(all)) imps.push('\t"time"')
  return imps.length ? `import (\n${imps.join('\n')}\n)\n\n` : ''
}

// ---- plain struct -----------------------------------------------------------

export const goStruct: GenFn = (tables): GeneratedFile[] => {
  const allCols = tables.flatMap((t) => t.columns)
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => `\t${pascal(c.name)} ${goType(c)} \`json:"${c.name}"\``)
        .join('\n')
      return `type ${modelName(t.name)} struct {\n${rows}\n}`
    })
    .join('\n\n')
  return [{ filename: 'models.go', lang: 'go', content: `package models\n\n${goImports(allCols)}${body}\n` }]
}

// ---- GORM -------------------------------------------------------------------

function gormTag(c: IRColumn): string {
  const parts = [`column:${c.name}`]
  if (c.isPrimaryKey) parts.push('primaryKey')
  if (c.autoIncrement) parts.push('autoIncrement')
  if (!c.nullable) parts.push('not null')
  if (c.unique && !c.isPrimaryKey) parts.push('unique')
  return parts.join(';')
}

export const goGorm: GenFn = (tables): GeneratedFile[] => {
  const allCols = tables.flatMap((t) => t.columns)
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => `\t${pascal(c.name)} ${goType(c)} \`gorm:"${gormTag(c)}" json:"${c.name}"\``)
        .join('\n')
      const tableName = `\n\nfunc (${modelName(t.name)}) TableName() string { return "${t.name}" }`
      return `type ${modelName(t.name)} struct {\n${rows}\n}${tableName}`
    })
    .join('\n\n')
  return [{ filename: 'models.go', lang: 'go', content: `package models\n\n${goImports(allCols)}${body}\n` }]
}

// ---- sqlx (db-tagged struct) ------------------------------------------------

export const goSqlx: GenFn = (tables): GeneratedFile[] => {
  const allCols = tables.flatMap((t) => t.columns)
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => `\t${pascal(c.name)} ${goType(c)} \`db:"${c.name}" json:"${c.name}"\``)
        .join('\n')
      return `type ${modelName(t.name)} struct {\n${rows}\n}`
    })
    .join('\n\n')
  return [{ filename: 'models.go', lang: 'go', content: `package models\n\n${goImports(allCols)}${body}\n` }]
}

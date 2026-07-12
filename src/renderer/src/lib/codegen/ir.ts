// Normalized intermediate representation (IR) for code generation. Every
// language/framework generator consumes IRTable[] rather than raw DB metadata,
// so type mapping and naming logic live in one place.
import type { TableStructure } from '@shared/types'

/** Engine-agnostic classification of a column's type. */
export type ScalarKind =
  | 'string'
  | 'text'
  | 'uuid'
  | 'int'
  | 'bigint'
  | 'float'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'bytes'
  | 'enum'
  | 'unknown'

export interface IRColumn {
  name: string
  /** Original DB type string, verbatim (e.g. "varchar(255)"). */
  rawType: string
  kind: ScalarKind
  nullable: boolean
  isPrimaryKey: boolean
  /** Best-effort: serial / identity / auto_increment, or a lone int PK. */
  autoIncrement: boolean
  default: string | null
  /** True when a single-column unique index/constraint covers this column. */
  unique: boolean
  /** varchar/char length, when the type declared one. */
  length?: number
  /** numeric precision/scale, when declared. */
  precision?: number
  scale?: number
  /** Foreign-key target, when this column references another table. */
  ref?: { table: string; column: string }
}

export interface IRTable {
  /** Original table name (as in the DB). */
  name: string
  columns: IRColumn[]
  primaryKey: string[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
  /** True when the table carries created_at + updated_at (ORM timestamp pair). */
  hasTimestamps: boolean
}

// ---- type classification ----------------------------------------------------

/** Map a raw SQL type string from any supported engine to a ScalarKind. */
export function classifyType(raw: string): { kind: ScalarKind; length?: number; precision?: number; scale?: number } {
  const t = raw.trim().toLowerCase()
  const base = t.replace(/\(.*$/, '').replace(/\[\]$/, '').trim() // strip (len) and array []
  const nums = [...t.matchAll(/\d+/g)].map((m) => Number(m[0]))

  // MySQL tinyint(1) is conventionally boolean.
  if (/^tinyint/.test(t) && nums[0] === 1) return { kind: 'bool' }

  const has = (...names: string[]): boolean => names.some((n) => base === n || base.startsWith(n))

  if (/serial/.test(base)) return { kind: base.includes('big') ? 'bigint' : 'int' }
  if (has('uuid', 'uniqueidentifier')) return { kind: 'uuid' }
  if (has('bool', 'boolean', 'bit')) return { kind: 'bool' }
  if (has('bigint', 'int8')) return { kind: 'bigint' }
  if (has('smallint', 'int2', 'tinyint', 'mediumint', 'integer', 'int', 'int4', 'year'))
    return { kind: 'int' }
  if (has('numeric', 'decimal', 'money', 'number', 'dec'))
    return { kind: 'decimal', precision: nums[0], scale: nums[1] }
  if (has('double', 'real', 'float', 'binary_float', 'binary_double', 'float4', 'float8'))
    return { kind: 'float' }
  if (has('json', 'jsonb', 'super', 'variant', 'object', 'array', 'hstore'))
    return { kind: 'json' }
  if (has('bytea', 'blob', 'binary', 'varbinary', 'bytes', 'raw', 'image'))
    return { kind: 'bytes' }
  if (has('date') && !base.includes('datetime')) return { kind: 'date' }
  if (has('time') && !base.includes('timestamp') && !base.includes('datetime')) return { kind: 'time' }
  if (has('timestamp', 'datetime', 'smalldatetime')) return { kind: 'datetime' }
  if (has('text', 'clob', 'nclob', 'ntext', 'long', 'mediumtext', 'longtext', 'tinytext'))
    return { kind: 'text' }
  if (has('varchar', 'char', 'nvarchar', 'nchar', 'character', 'string', 'varchar2', 'nvarchar2', 'citext'))
    return { kind: 'string', length: nums[0] }
  if (has('enum', 'set')) return { kind: 'enum' }
  return { kind: 'unknown' }
}

function detectAutoIncrement(
  rawType: string,
  def: string | null,
  isPk: boolean,
  kind: ScalarKind,
  singlePk: boolean
): boolean {
  const r = rawType.toLowerCase()
  const d = (def ?? '').toLowerCase()
  if (/serial/.test(r)) return true
  if (/nextval|auto_increment|identity|generated\s+(always|by default)\s+as\s+identity/.test(d + ' ' + r))
    return true
  // Common convention: a single integer primary key with no explicit default.
  if (isPk && singlePk && (kind === 'int' || kind === 'bigint') && !def) return true
  return false
}

/** Build the IR for one table from its fetched structure. */
export function buildIRTable(name: string, s: TableStructure): IRTable {
  const pk = s.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  const singlePk = pk.length === 1
  // Columns that a single-column unique index covers.
  const uniqueCols = new Set(
    s.indexes.filter((i) => i.unique && i.columns.length === 1).map((i) => i.columns[0])
  )
  const fkByCol = new Map(s.foreignKeys.map((f) => [f.column, f]))

  const columns: IRColumn[] = s.columns.map((c) => {
    const { kind, length, precision, scale } = classifyType(c.type)
    const fk = fkByCol.get(c.name)
    return {
      name: c.name,
      rawType: c.type,
      kind,
      nullable: c.nullable,
      isPrimaryKey: c.isPrimaryKey,
      autoIncrement: detectAutoIncrement(c.type, c.default, c.isPrimaryKey, kind, singlePk),
      default: c.default,
      unique: uniqueCols.has(c.name),
      length,
      precision,
      scale,
      ref: fk ? { table: fk.refTable, column: fk.refColumn } : undefined
    }
  })

  const names = new Set(columns.map((c) => c.name))
  return {
    name,
    columns,
    primaryKey: pk,
    indexes: s.indexes.map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
    hasTimestamps: names.has('created_at') && names.has('updated_at')
  }
}

// ---- naming helpers ---------------------------------------------------------

/** Split an identifier into lowercase words (handles snake, kebab, camel). */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1)

export function pascal(name: string): string {
  return words(name).map(cap).join('')
}
export function camel(name: string): string {
  const p = pascal(name)
  return p.charAt(0).toLowerCase() + p.slice(1)
}
export function snake(name: string): string {
  return words(name).join('_')
}
export function kebab(name: string): string {
  return words(name).join('-')
}
export function upperSnake(name: string): string {
  return words(name).join('_').toUpperCase()
}

/** Naive English singularization of the final word of an identifier. */
export function singular(name: string): string {
  const ws = words(name)
  if (!ws.length) return name
  const last = ws[ws.length - 1]
  ws[ws.length - 1] = singularizeWord(last)
  return ws.join(' ')
}

function singularizeWord(w: string): string {
  if (/(?:s|sh|ch|x|z)es$/.test(w)) return w.replace(/es$/, '')
  if (/[^aeiou]ies$/.test(w)) return w.replace(/ies$/, 'y')
  if (/ses$/.test(w)) return w.replace(/es$/, '')
  if (/ss$/.test(w)) return w // "address" stays
  if (/s$/.test(w) && !/us$/.test(w)) return w.replace(/s$/, '')
  return w
}

/** PascalCase, singularized — the conventional model/class name for a table. */
export function modelName(table: string): string {
  return pascal(singular(table))
}

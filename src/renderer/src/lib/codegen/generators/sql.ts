import type { IRTable, IRColumn } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { snake } from '../ir'

type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

export function dialectOf(driver: string): Dialect {
  if (driver === 'mysql') return 'mysql'
  if (driver === 'sqlite' || driver === 'duckdb') return 'sqlite'
  if (driver === 'mssql') return 'mssql'
  return 'postgres'
}

function quote(id: string, d: Dialect): string {
  if (d === 'mysql') return `\`${id}\``
  if (d === 'mssql') return `[${id}]`
  return `"${id}"`
}

/** Column type for a fresh CREATE TABLE, per dialect (from the normalized kind). */
function sqlType(c: IRColumn, d: Dialect): string {
  const autoPk = c.autoIncrement
  switch (c.kind) {
    case 'int':
      if (autoPk && d === 'postgres') return 'SERIAL'
      if (autoPk && d === 'sqlite') return 'INTEGER'
      return d === 'mssql' ? 'INT' : 'INTEGER'
    case 'bigint':
      if (autoPk && d === 'postgres') return 'BIGSERIAL'
      if (autoPk && d === 'sqlite') return 'INTEGER'
      return 'BIGINT'
    case 'string':
      return `VARCHAR(${c.length ?? 255})`
    case 'text':
      return d === 'mssql' ? 'NVARCHAR(MAX)' : 'TEXT'
    case 'uuid':
      return d === 'postgres' ? 'UUID' : d === 'mssql' ? 'UNIQUEIDENTIFIER' : 'CHAR(36)'
    case 'bool':
      return d === 'mysql' ? 'TINYINT(1)' : d === 'mssql' ? 'BIT' : 'BOOLEAN'
    case 'float':
      return d === 'mssql' ? 'FLOAT' : 'DOUBLE PRECISION'
    case 'decimal':
      return `DECIMAL(${c.precision ?? 18}, ${c.scale ?? 2})`
    case 'date':
      return 'DATE'
    case 'time':
      return 'TIME'
    case 'datetime':
      if (d === 'postgres') return 'TIMESTAMP'
      if (d === 'mssql') return 'DATETIME2'
      return 'DATETIME'
    case 'json':
      return d === 'postgres' ? 'JSONB' : d === 'mysql' ? 'JSON' : 'TEXT'
    case 'bytes':
      return d === 'postgres' ? 'BYTEA' : d === 'mysql' ? 'BLOB' : d === 'mssql' ? 'VARBINARY(MAX)' : 'BLOB'
    default:
      return c.rawType.toUpperCase()
  }
}

function autoIncrementSuffix(d: Dialect): string {
  if (d === 'mysql') return ' AUTO_INCREMENT'
  if (d === 'mssql') return ' IDENTITY(1,1)'
  if (d === 'sqlite') return '' // handled via "INTEGER PRIMARY KEY"
  return '' // postgres uses SERIAL type
}

/** Build a portable-ish CREATE TABLE statement for one table. */
export function createTableSql(t: IRTable, d: Dialect): string {
  const q = (id: string): string => quote(id, d)
  const lines: string[] = []
  const singleAutoPk = t.primaryKey.length === 1 && t.columns.find((c) => c.name === t.primaryKey[0])?.autoIncrement

  for (const c of t.columns) {
    let line = `  ${q(c.name)} ${sqlType(c, d)}`
    // SQLite: a single INTEGER PRIMARY KEY column auto-increments implicitly.
    if (c.autoIncrement && d === 'sqlite' && singleAutoPk) {
      line += ' PRIMARY KEY AUTOINCREMENT'
    } else {
      if (c.autoIncrement) line += autoIncrementSuffix(d)
      if (!c.nullable) line += ' NOT NULL'
    }
    // Auto-increment columns get their default from the sequence/identity; a
    // captured nextval()/identity default would reference a foreign sequence.
    if (!c.autoIncrement && c.default != null && c.default !== '') line += ` DEFAULT ${c.default}`
    if (c.unique && !c.isPrimaryKey) line += ' UNIQUE'
    lines.push(line)
  }

  const sqliteInlinePk = d === 'sqlite' && singleAutoPk
  if (t.primaryKey.length && !sqliteInlinePk) {
    lines.push(`  PRIMARY KEY (${t.primaryKey.map(q).join(', ')})`)
  }
  for (const c of t.columns) {
    if (c.ref) {
      lines.push(
        `  FOREIGN KEY (${q(c.name)}) REFERENCES ${q(c.ref.table)} (${q(c.ref.column)})`
      )
    }
  }

  return `CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`
}

export const sqlCreate: GenFn = (tables, opts): GeneratedFile[] => {
  const d = dialectOf(opts.driver)
  const content = tables.map((t) => createTableSql(t, d)).join('\n\n') + '\n'
  return [{ filename: 'schema.sql', lang: 'sql', content }]
}

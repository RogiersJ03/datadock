import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, camel, pascal } from '../ir'

function kotlinType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'string':
    case 'text':
    case 'uuid':
      base = 'String'
      break
    case 'int':
      base = 'Int'
      break
    case 'bigint':
      base = 'Long'
      break
    case 'float':
      base = 'Double'
      break
    case 'decimal':
      base = 'BigDecimal'
      break
    case 'bool':
      base = 'Boolean'
      break
    case 'date':
      base = 'LocalDate'
      break
    case 'datetime':
      base = 'LocalDateTime'
      break
    case 'time':
      base = 'LocalTime'
      break
    case 'json':
      base = 'String'
      break
    case 'bytes':
      base = 'ByteArray'
      break
    default:
      base = 'String'
  }
  return base + (c.nullable ? '?' : '')
}

// ---- data class (kotlinx.serialization) -------------------------------------

export const kotlinData: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const rename = camel(c.name) !== c.name ? `    @SerialName("${c.name}")\n` : ''
          const def = c.nullable ? ' = null' : ''
          return `${rename}    val ${camel(c.name)}: ${kotlinType(c)}${def}`
        })
        .join(',\n')
      return `@Serializable\ndata class ${modelName(t.name)}(\n${rows}\n)`
    })
    .join('\n\n')
  const header =
    'import kotlinx.serialization.Serializable\nimport kotlinx.serialization.SerialName\nimport java.math.BigDecimal\nimport java.time.LocalDate\nimport java.time.LocalDateTime\nimport java.time.LocalTime\n\n'
  return [{ filename: 'Models.kt', lang: 'kotlin', content: header + body + '\n' }]
}

// ---- JetBrains Exposed table ------------------------------------------------

function exposedCol(c: IRColumn): string {
  const n = `"${c.name}"`
  const nm = camel(c.name)
  let call: string
  switch (c.kind) {
    case 'string':
      call = `varchar(${n}, ${c.length ?? 255})`
      break
    case 'text':
      call = `text(${n})`
      break
    case 'uuid':
      call = `uuid(${n})`
      break
    case 'int':
      call = `integer(${n})`
      break
    case 'bigint':
      call = `long(${n})`
      break
    case 'float':
      call = `double(${n})`
      break
    case 'decimal':
      call = `decimal(${n}, ${c.precision ?? 18}, ${c.scale ?? 2})`
      break
    case 'bool':
      call = `bool(${n})`
      break
    case 'date':
      call = `date(${n})`
      break
    case 'datetime':
      call = `datetime(${n})`
      break
    case 'time':
      call = `time(${n})`
      break
    case 'json':
      call = `text(${n})`
      break
    case 'bytes':
      call = `binary(${n})`
      break
    default:
      call = `varchar(${n}, 255)`
  }
  let expr = `    val ${nm} = ${call}`
  if (c.autoIncrement) expr += '.autoIncrement()'
  if (c.nullable) expr += '.nullable()'
  if (c.unique && !c.isPrimaryKey) expr += '.uniqueIndex()'
  return expr
}

export const kotlinExposed: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns.map(exposedCol).join('\n')
      const pkCols = t.primaryKey.map(camel)
      const pk = pkCols.length ? `\n    override val primaryKey = PrimaryKey(${pkCols.join(', ')})` : ''
      return `object ${pascal(t.name)} : Table("${t.name}") {\n${rows}${pk}\n}`
    })
    .join('\n\n')
  const header =
    'import org.jetbrains.exposed.sql.Table\nimport org.jetbrains.exposed.sql.javatime.date\nimport org.jetbrains.exposed.sql.javatime.datetime\nimport org.jetbrains.exposed.sql.javatime.time\n\n'
  return [{ filename: 'Tables.kt', lang: 'kotlin', content: header + body + '\n' }]
}

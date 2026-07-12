import type { IRColumn } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, camel } from '../ir'

function swiftType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'string':
    case 'text':
    case 'json':
      base = 'String'
      break
    case 'uuid':
      base = 'UUID'
      break
    case 'int':
      base = 'Int'
      break
    case 'bigint':
      base = 'Int64'
      break
    case 'float':
      base = 'Double'
      break
    case 'decimal':
      base = 'Decimal'
      break
    case 'bool':
      base = 'Bool'
      break
    case 'date':
    case 'datetime':
    case 'time':
      base = 'Date'
      break
    case 'bytes':
      base = 'Data'
      break
    default:
      base = 'String'
  }
  return base + (c.nullable ? '?' : '')
}

// ---- Codable struct ---------------------------------------------------------

export const swiftCodable: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const hasId = t.columns.some((c) => c.name === 'id' || camel(c.name) === 'id')
      const rows = t.columns.map((c) => `    let ${camel(c.name)}: ${swiftType(c)}`).join('\n')
      // CodingKeys only needed when a name differs from its camelCase form.
      const needKeys = t.columns.some((c) => camel(c.name) !== c.name)
      const keys = needKeys
        ? '\n\n    enum CodingKeys: String, CodingKey {\n' +
          t.columns
            .map((c) =>
              camel(c.name) === c.name
                ? `        case ${camel(c.name)}`
                : `        case ${camel(c.name)} = "${c.name}"`
            )
            .join('\n') +
          '\n    }'
        : ''
      const proto = hasId ? 'Codable, Identifiable' : 'Codable'
      return `struct ${modelName(t.name)}: ${proto} {\n${rows}${keys}\n}`
    })
    .join('\n\n')
  return [{ filename: 'Models.swift', lang: 'swift', content: 'import Foundation\n\n' + body + '\n' }]
}

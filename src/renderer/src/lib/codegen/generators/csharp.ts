import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, pascal } from '../ir'

/** C# type; reference types get `?` when nullable, value types too (C# 8+). */
function csType(c: IRColumn): string {
  let base: string
  let isValue = true
  switch (c.kind) {
    case 'string':
    case 'text':
    case 'json':
      base = 'string'
      isValue = false
      break
    case 'uuid':
      base = 'Guid'
      break
    case 'int':
      base = 'int'
      break
    case 'bigint':
      base = 'long'
      break
    case 'float':
      base = 'double'
      break
    case 'decimal':
      base = 'decimal'
      break
    case 'bool':
      base = 'bool'
      break
    case 'date':
      base = 'DateOnly'
      break
    case 'datetime':
      base = 'DateTime'
      break
    case 'time':
      base = 'TimeOnly'
      break
    case 'bytes':
      base = 'byte[]'
      isValue = false
      break
    default:
      base = 'string'
      isValue = false
  }
  if (c.nullable) base += '?'
  else if (!isValue && base === 'string') base = 'string' // non-null reference
  return base
}

export const csEfcore: GenFn = (tables): GeneratedFile[] => {
  const classes = tables
    .map((t) => {
      const cls = modelName(t.name)
      const props = t.columns
        .map((c) => {
          const anns: string[] = []
          if (c.isPrimaryKey) anns.push('    [Key]')
          if (pascal(c.name) !== c.name || c.name !== c.name.toLowerCase())
            anns.push(`    [Column("${c.name}")]`)
          if (!c.nullable && (c.kind === 'string' || c.kind === 'text')) anns.push('    [Required]')
          const prefix = anns.length ? anns.join('\n') + '\n' : ''
          const init = c.kind === 'string' && !c.nullable ? ' = string.Empty;' : ''
          return `${prefix}    public ${csType(c)} ${pascal(c.name)} { get; set; }${init}`
        })
        .join('\n\n')
      return `[Table("${t.name}")]\npublic class ${cls}\n{\n${props}\n}`
    })
    .join('\n\n')
  const content = `using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace App.Models;

${classes}
`
  return [{ filename: 'Models.cs', lang: 'csharp', content }]
}

// ---- C# positional record (DTO) ---------------------------------------------

export const csRecord: GenFn = (tables): GeneratedFile[] => {
  const classes = tables
    .map((t) => {
      const comps = t.columns.map((c) => `    ${csType(c)} ${pascal(c.name)}`).join(',\n')
      return `public record ${modelName(t.name)}(\n${comps}\n);`
    })
    .join('\n\n')
  const content = `using System;\n\nnamespace App.Models;\n\n${classes}\n`
  return [{ filename: 'Records.cs', lang: 'csharp', content }]
}

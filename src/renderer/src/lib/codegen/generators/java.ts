import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, pascal, camel } from '../ir'

function javaType(k: ScalarKind): string {
  switch (k) {
    case 'string':
    case 'text':
      return 'String'
    case 'uuid':
      return 'UUID'
    case 'int':
      return 'Integer'
    case 'bigint':
      return 'Long'
    case 'float':
      return 'Double'
    case 'decimal':
      return 'BigDecimal'
    case 'bool':
      return 'Boolean'
    case 'date':
      return 'LocalDate'
    case 'datetime':
      return 'LocalDateTime'
    case 'time':
      return 'LocalTime'
    case 'json':
      return 'String'
    case 'bytes':
      return 'byte[]'
    default:
      return 'String'
  }
}

export const javaJpa: GenFn = (tables): GeneratedFile[] => {
  return tables.map((t) => {
    const cls = modelName(t.name)
    const fields = t.columns
      .map((c) => {
        const anns: string[] = []
        if (c.isPrimaryKey) {
          anns.push('    @Id')
          if (c.autoIncrement) anns.push('    @GeneratedValue(strategy = GenerationType.IDENTITY)')
        }
        const colArgs = [`name = "${c.name}"`]
        if (!c.nullable) colArgs.push('nullable = false')
        if (c.length && c.kind === 'string') colArgs.push(`length = ${c.length}`)
        if (c.unique && !c.isPrimaryKey) colArgs.push('unique = true')
        anns.push(`    @Column(${colArgs.join(', ')})`)
        return `${anns.join('\n')}\n    private ${javaType(c.kind)} ${camel(c.name)};`
      })
      .join('\n\n')
    const content = `package com.example.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.UUID;

@Entity
@Table(name = "${t.name}")
public class ${cls} {

${fields}

    // getters and setters omitted for brevity
}
`
    return { filename: `${pascal(cls)}.java`, lang: 'java', content }
  })
}

// ---- Java record (immutable DTO) --------------------------------------------

export const javaRecord: GenFn = (tables): GeneratedFile[] => {
  return tables.map((t) => {
    const cls = modelName(t.name)
    const comps = t.columns.map((c) => `    ${javaType(c.kind)} ${camel(c.name)}`).join(',\n')
    const content = `package com.example.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.UUID;

public record ${cls}(
${comps}
) {}
`
    return { filename: `${pascal(cls)}.java`, lang: 'java', content }
  })
}

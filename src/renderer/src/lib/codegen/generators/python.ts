import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName } from '../ir'

// ---- Django -----------------------------------------------------------------

function djangoField(c: IRColumn): string {
  const args: string[] = []
  let fn: string
  if (c.ref) {
    fn = 'ForeignKey'
    args.push(`'${modelName(c.ref.table)}'`, 'on_delete=models.CASCADE')
    // Django appends _id to the DB column itself; if the raw column already
    // ends in _id, map it explicitly so no double suffix is created.
    if (/_id$/.test(c.name)) args.push(`db_column='${c.name}'`)
    if (c.nullable) args.push('null=True', 'blank=True')
    return `models.${fn}(${args.join(', ')})`
  }
  switch (c.kind) {
    case 'string':
      fn = 'CharField'
      args.push(`max_length=${c.length ?? 255}`)
      break
    case 'text':
      fn = 'TextField'
      break
    case 'uuid':
      fn = 'UUIDField'
      break
    case 'int':
      fn = 'IntegerField'
      break
    case 'bigint':
      fn = 'BigIntegerField'
      break
    case 'float':
      fn = 'FloatField'
      break
    case 'decimal':
      fn = 'DecimalField'
      args.push(`max_digits=${c.precision ?? 18}`, `decimal_places=${c.scale ?? 2}`)
      break
    case 'bool':
      fn = 'BooleanField'
      break
    case 'date':
      fn = 'DateField'
      break
    case 'datetime':
      fn = 'DateTimeField'
      break
    case 'time':
      fn = 'TimeField'
      break
    case 'json':
      fn = 'JSONField'
      break
    case 'bytes':
      fn = 'BinaryField'
      break
    default:
      fn = 'CharField'
      args.push('max_length=255')
  }
  if (c.nullable) args.push('null=True', 'blank=True')
  if (c.unique && !c.isPrimaryKey) args.push('unique=True')
  return `models.${fn}(${args.join(', ')})`
}

/** Django field attribute name — FK columns drop their trailing _id. */
function djangoFieldName(c: IRColumn): string {
  return c.ref ? c.name.replace(/_id$/, '') : c.name
}

export const pyDjango: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    const body = tables
      .map((t) => {
        const rows = t.columns
          .filter((c) => !(c.autoIncrement && c.isPrimaryKey && c.name === 'id'))
          .map((c) => `    ${djangoFieldName(c)} = ${djangoField(c)}`)
          .join('\n')
        return `class ${modelName(t.name)}(models.Model):\n${rows || '    pass'}\n\n    class Meta:\n        db_table = '${t.name}'`
      })
      .join('\n\n\n')
    files.push({ filename: 'models.py', lang: 'python', content: `from django.db import models\n\n\n${body}\n` })
  }
  if (opts.kinds.includes('migration')) {
    const ops = tables
      .map((t) => {
        const fields = t.columns
          .map((c) => {
            if (c.autoIncrement && c.isPrimaryKey)
              return `                ('${c.name}', models.AutoField(primary_key=True))`
            return `                ('${djangoFieldName(c)}', ${djangoField(c)})`
          })
          .join(',\n')
        return `        migrations.CreateModel(\n            name='${modelName(t.name)}',\n            fields=[\n${fields},\n            ],\n            options={'db_table': '${t.name}'},\n        )`
      })
      .join(',\n')
    files.push({
      filename: '0001_initial.py',
      lang: 'python',
      content: `from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n\n    initial = True\n\n    dependencies = []\n\n    operations = [\n${ops},\n    ]\n`
    })
  }
  return files
}

// ---- SQLAlchemy -------------------------------------------------------------

function sqlalchemyType(c: IRColumn): string {
  const map: Partial<Record<ScalarKind, string>> = {
    string: c.length ? `String(${c.length})` : 'String',
    text: 'Text',
    uuid: 'Uuid',
    int: 'Integer',
    bigint: 'BigInteger',
    float: 'Float',
    decimal: `Numeric(${c.precision ?? 18}, ${c.scale ?? 2})`,
    bool: 'Boolean',
    date: 'Date',
    datetime: 'DateTime',
    time: 'Time',
    json: 'JSON',
    bytes: 'LargeBinary'
  }
  return map[c.kind] ?? 'String'
}

export const pySqlalchemy: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const args = [sqlalchemyType(c)]
          if (c.ref) args.push(`ForeignKey('${c.ref.table}.${c.ref.column}')`)
          if (c.isPrimaryKey) args.push('primary_key=True')
          if (c.autoIncrement) args.push('autoincrement=True')
          if (!c.nullable && !c.isPrimaryKey) args.push('nullable=False')
          if (c.unique && !c.isPrimaryKey) args.push('unique=True')
          return `    ${c.name} = mapped_column(${args.join(', ')})`
        })
        .join('\n')
      return `class ${modelName(t.name)}(Base):\n    __tablename__ = '${t.name}'\n\n${rows}`
    })
    .join('\n\n\n')
  const header =
    'from sqlalchemy import String, Text, Integer, BigInteger, Float, Numeric, Boolean, Date, DateTime, Time, JSON, LargeBinary, Uuid, ForeignKey\nfrom sqlalchemy.orm import DeclarativeBase, mapped_column\n\n\nclass Base(DeclarativeBase):\n    pass\n\n\n'
  return [{ filename: 'models.py', lang: 'python', content: header + body + '\n' }]
}

// ---- Pydantic ---------------------------------------------------------------

function pyType(k: ScalarKind): string {
  switch (k) {
    case 'string':
    case 'text':
      return 'str'
    case 'uuid':
      return 'UUID'
    case 'int':
    case 'bigint':
      return 'int'
    case 'float':
      return 'float'
    case 'decimal':
      return 'Decimal'
    case 'bool':
      return 'bool'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'time':
      return 'time'
    case 'json':
      return 'dict'
    case 'bytes':
      return 'bytes'
    default:
      return 'Any'
  }
}

export const pyPydantic: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const ty = c.nullable ? `Optional[${pyType(c.kind)}]` : pyType(c.kind)
          return `    ${c.name}: ${ty}${c.nullable ? ' = None' : ''}`
        })
        .join('\n')
      return `class ${modelName(t.name)}(BaseModel):\n${rows}`
    })
    .join('\n\n\n')
  const header =
    'from __future__ import annotations\nfrom datetime import date, datetime, time\nfrom decimal import Decimal\nfrom typing import Optional, Any\nfrom uuid import UUID\nfrom pydantic import BaseModel\n\n\n'
  return [{ filename: 'schemas.py', lang: 'python', content: header + body + '\n' }]
}

// ---- dataclass --------------------------------------------------------------

export const pyDataclass: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const ty = c.nullable ? `Optional[${pyType(c.kind)}]` : pyType(c.kind)
          return `    ${c.name}: ${ty}${c.nullable ? ' = None' : ''}`
        })
        .join('\n')
      return `@dataclass\nclass ${modelName(t.name)}:\n${rows}`
    })
    .join('\n\n\n')
  const header =
    'from __future__ import annotations\nfrom dataclasses import dataclass\nfrom datetime import date, datetime, time\nfrom decimal import Decimal\nfrom typing import Optional, Any\nfrom uuid import UUID\n\n\n'
  return [{ filename: 'models.py', lang: 'python', content: header + body + '\n' }]
}

// ---- Alembic ----------------------------------------------------------------

export const pyAlembic: GenFn = (tables): GeneratedFile[] => {
  const up = tables
    .map((t) => {
      const cols = t.columns
        .map((c) => {
          const args = [`'${c.name}'`, `sa.${sqlalchemyType(c)}`]
          if (c.ref) args.push(`sa.ForeignKey('${c.ref.table}.${c.ref.column}')`)
          if (c.isPrimaryKey) args.push('primary_key=True')
          if (c.autoIncrement) args.push('autoincrement=True')
          if (!c.nullable) args.push('nullable=False')
          if (c.unique && !c.isPrimaryKey) args.push('unique=True')
          return `        sa.Column(${args.join(', ')})`
        })
        .join(',\n')
      return `    op.create_table(\n        '${t.name}',\n${cols},\n    )`
    })
    .join('\n')
  const down = [...tables]
    .reverse()
    .map((t) => `    op.drop_table('${t.name}')`)
    .join('\n')
  const content = `"""create tables\n\nRevision ID: 0001\n"""\nfrom alembic import op\nimport sqlalchemy as sa\n\nrevision = '0001'\ndown_revision = None\n\n\ndef upgrade() -> None:\n${up}\n\n\ndef downgrade() -> None:\n${down}\n`
  return [{ filename: 'alembic_migration.py', lang: 'python', content }]
}

// ---- SQLModel (FastAPI) -----------------------------------------------------

export const pySqlmodel: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const ty = c.nullable ? `Optional[${pyType(c.kind)}]` : pyType(c.kind)
          const opts: string[] = []
          if (c.isPrimaryKey) opts.push('primary_key=True')
          if (c.ref) opts.push(`foreign_key='${c.ref.table}.${c.ref.column}'`)
          if (c.unique && !c.isPrimaryKey) opts.push('unique=True')
          const field =
            opts.length || c.nullable
              ? ` = Field(${c.nullable ? 'default=None' : ''}${opts.length ? (c.nullable ? ', ' : '') + opts.join(', ') : ''})`
              : ''
          return `    ${c.name}: ${ty}${field}`
        })
        .join('\n')
      return `class ${modelName(t.name)}(SQLModel, table=True):\n    __tablename__ = '${t.name}'\n\n${rows}`
    })
    .join('\n\n\n')
  const header =
    'from __future__ import annotations\nfrom datetime import date, datetime, time\nfrom decimal import Decimal\nfrom typing import Optional, Any\nfrom uuid import UUID\nfrom sqlmodel import SQLModel, Field\n\n\n'
  return [{ filename: 'models.py', lang: 'python', content: header + body + '\n' }]
}

// ---- Tortoise ORM -----------------------------------------------------------

function tortoiseField(c: IRColumn): string {
  const args: string[] = []
  let fn: string
  if (c.ref) {
    return `fields.ForeignKeyField('models.${modelName(c.ref.table)}', source_field='${c.name}'${c.nullable ? ', null=True' : ''})`
  }
  switch (c.kind) {
    case 'string':
      fn = 'CharField'
      args.push(`max_length=${c.length ?? 255}`)
      break
    case 'text':
      fn = 'TextField'
      break
    case 'uuid':
      fn = 'UUIDField'
      break
    case 'int':
      fn = c.isPrimaryKey && c.autoIncrement ? 'IntField' : 'IntField'
      break
    case 'bigint':
      fn = 'BigIntField'
      break
    case 'float':
      fn = 'FloatField'
      break
    case 'decimal':
      fn = 'DecimalField'
      args.push(`max_digits=${c.precision ?? 18}`, `decimal_places=${c.scale ?? 2}`)
      break
    case 'bool':
      fn = 'BooleanField'
      break
    case 'date':
      fn = 'DateField'
      break
    case 'datetime':
      fn = 'DatetimeField'
      break
    case 'time':
      fn = 'TimeField'
      break
    case 'json':
      fn = 'JSONField'
      break
    case 'bytes':
      fn = 'BinaryField'
      break
    default:
      fn = 'CharField'
      args.push('max_length=255')
  }
  if (c.isPrimaryKey) args.unshift('pk=True')
  if (c.nullable) args.push('null=True')
  if (c.unique && !c.isPrimaryKey) args.push('unique=True')
  return `fields.${fn}(${args.join(', ')})`
}

export const pyTortoise: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns
        .filter((c) => !(c.isPrimaryKey && c.autoIncrement && c.name === 'id'))
        .map((c) => `    ${c.ref ? c.name.replace(/_id$/, '') : c.name} = ${tortoiseField(c)}`)
        .join('\n')
      return `class ${modelName(t.name)}(models.Model):\n${rows || '    pass'}\n\n    class Meta:\n        table = '${t.name}'`
    })
    .join('\n\n\n')
  return [
    { filename: 'models.py', lang: 'python', content: `from tortoise import fields, models\n\n\n${body}\n` }
  ]
}

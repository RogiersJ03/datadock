// Public API for schema-driven code generation. The registry is the single
// source of truth the UI reads to build the language-grouped menu.
import type { TableStructure } from '@shared/types'
import type { Target, GeneratedFile, GenerateOptions, CodeKind } from './types'
import { buildIRTable, type IRTable } from './ir'
import {
  tsInterface,
  tsZod,
  tsPrisma,
  tsTypeorm,
  tsSequelize,
  tsKnex,
  tsDrizzle,
  tsPinia,
  tsZustand,
  tsKysely,
  tsClassValidator,
  tsValibot
} from './generators/typescript'
import {
  pyDjango,
  pySqlalchemy,
  pyPydantic,
  pyDataclass,
  pyAlembic,
  pySqlmodel,
  pyTortoise
} from './generators/python'
import { phpLaravel, phpDoctrine, phpDto } from './generators/php'
import { rbActiveRecord } from './generators/ruby'
import { goStruct, goGorm, goSqlx } from './generators/go'
import { javaJpa, javaRecord } from './generators/java'
import { csEfcore, csRecord } from './generators/csharp'
import { rustSqlx, rustSeaorm, rustDiesel } from './generators/rust'
import { kotlinData, kotlinExposed } from './generators/kotlin'
import { swiftCodable } from './generators/swift'
import { dartData } from './generators/dart'
import { elixirEcto } from './generators/elixir'
import { jsonSchema, openapiSchema, graphqlSdl, protobuf } from './generators/schema'
import { sqlCreate } from './generators/sql'

export type { Target, GeneratedFile, GenerateOptions, CodeKind } from './types'
export type { IRTable } from './ir'

const M: CodeKind[] = ['model']
const MM: CodeKind[] = ['model', 'migration']
const MIG: CodeKind[] = ['migration']

export const TARGETS: Target[] = [
  // TypeScript / JavaScript
  { id: 'ts-interface', language: 'TypeScript', label: 'Interfaces', kinds: M, note: 'Plain typed objects', generate: tsInterface },
  { id: 'ts-zod', language: 'TypeScript', label: 'Zod schemas', kinds: M, note: 'Runtime-validated + inferred types', generate: tsZod },
  { id: 'ts-prisma', language: 'TypeScript', label: 'Prisma', kinds: M, note: 'schema.prisma models', generate: tsPrisma },
  { id: 'ts-drizzle', language: 'TypeScript', label: 'Drizzle ORM', kinds: M, note: 'Typed table schema', generate: tsDrizzle },
  { id: 'ts-typeorm', language: 'TypeScript', label: 'TypeORM', kinds: MM, note: 'Entities + SQL migration', generate: tsTypeorm },
  { id: 'ts-sequelize', language: 'TypeScript', label: 'Sequelize', kinds: MM, note: 'Models + migration', generate: tsSequelize },
  { id: 'ts-knex', language: 'TypeScript', label: 'Knex', kinds: MIG, note: 'Schema-builder migration', generate: tsKnex },
  { id: 'ts-kysely', language: 'TypeScript', label: 'Kysely', kinds: M, note: 'Typed database interface', generate: tsKysely },
  { id: 'ts-class-validator', language: 'TypeScript', label: 'class-validator DTO', kinds: M, note: 'NestJS validated DTOs', generate: tsClassValidator },
  { id: 'ts-valibot', language: 'TypeScript', label: 'Valibot', kinds: M, note: 'Runtime-validated + inferred types', generate: tsValibot },
  { id: 'ts-pinia', language: 'TypeScript', label: 'Pinia store', kinds: M, note: 'Typed Vue store scaffold', generate: tsPinia },
  { id: 'ts-zustand', language: 'TypeScript', label: 'Zustand store', kinds: M, note: 'Typed React store scaffold', generate: tsZustand },

  // Python
  { id: 'py-django', language: 'Python', label: 'Django', kinds: MM, note: 'Models + migration', generate: pyDjango },
  { id: 'py-sqlalchemy', language: 'Python', label: 'SQLAlchemy', kinds: M, note: '2.0 declarative models', generate: pySqlalchemy },
  { id: 'py-pydantic', language: 'Python', label: 'Pydantic', kinds: M, note: 'BaseModel schemas', generate: pyPydantic },
  { id: 'py-dataclass', language: 'Python', label: 'Dataclasses', kinds: M, note: 'Stdlib @dataclass', generate: pyDataclass },
  { id: 'py-sqlmodel', language: 'Python', label: 'SQLModel', kinds: M, note: 'FastAPI models (Pydantic + SQLAlchemy)', generate: pySqlmodel },
  { id: 'py-tortoise', language: 'Python', label: 'Tortoise ORM', kinds: M, note: 'Async ORM models', generate: pyTortoise },
  { id: 'py-alembic', language: 'Python', label: 'Alembic', kinds: MIG, note: 'create_table migration', generate: pyAlembic },

  // PHP
  { id: 'php-laravel', language: 'PHP', label: 'Laravel / Eloquent', kinds: MM, note: 'Models + migrations', generate: phpLaravel },
  { id: 'php-doctrine', language: 'PHP', label: 'Symfony / Doctrine', kinds: MM, note: 'Entities + migration', generate: phpDoctrine },
  { id: 'php-dto', language: 'PHP', label: 'Plain DTO', kinds: M, note: 'Readonly value objects (PHP 8.1+)', generate: phpDto },

  // Ruby
  { id: 'rb-ar', language: 'Ruby', label: 'Rails / ActiveRecord', kinds: MM, note: 'Models + migrations', generate: rbActiveRecord },

  // Go
  { id: 'go-struct', language: 'Go', label: 'Structs', kinds: M, note: 'JSON-tagged structs', generate: goStruct },
  { id: 'go-gorm', language: 'Go', label: 'GORM', kinds: M, note: 'GORM-tagged models', generate: goGorm },
  { id: 'go-sqlx', language: 'Go', label: 'sqlx', kinds: M, note: 'db-tagged structs', generate: goSqlx },

  // Java
  { id: 'java-jpa', language: 'Java', label: 'JPA / Hibernate', kinds: M, note: 'Entity classes', generate: javaJpa },
  { id: 'java-record', language: 'Java', label: 'Record (DTO)', kinds: M, note: 'Immutable records', generate: javaRecord },

  // C#
  { id: 'cs-efcore', language: 'C#', label: 'Entity Framework Core', kinds: M, note: 'Annotated entities', generate: csEfcore },
  { id: 'cs-record', language: 'C#', label: 'Record (DTO)', kinds: M, note: 'Positional records', generate: csRecord },

  // Rust
  { id: 'rust-sqlx', language: 'Rust', label: 'sqlx', kinds: M, note: 'FromRow + serde structs', generate: rustSqlx },
  { id: 'rust-seaorm', language: 'Rust', label: 'SeaORM', kinds: M, note: 'Entity models', generate: rustSeaorm },
  { id: 'rust-diesel', language: 'Rust', label: 'Diesel', kinds: M, note: 'table! schema macro', generate: rustDiesel },

  // Kotlin
  { id: 'kotlin-data', language: 'Kotlin', label: 'Data class', kinds: M, note: 'kotlinx.serialization', generate: kotlinData },
  { id: 'kotlin-exposed', language: 'Kotlin', label: 'Exposed', kinds: M, note: 'JetBrains SQL DSL tables', generate: kotlinExposed },

  // Swift
  { id: 'swift-codable', language: 'Swift', label: 'Codable struct', kinds: M, note: 'Foundation + Codable', generate: swiftCodable },

  // Dart
  { id: 'dart-data', language: 'Dart', label: 'Data class', kinds: M, note: 'Flutter model + fromJson/toJson', generate: dartData },

  // Elixir
  { id: 'elixir-ecto', language: 'Elixir', label: 'Ecto', kinds: MM, note: 'Schema + migration', generate: elixirEcto },

  // Schema / IDL
  { id: 'json-schema', language: 'Schema / IDL', label: 'JSON Schema', kinds: M, note: 'Draft 2020-12', generate: jsonSchema },
  { id: 'openapi', language: 'Schema / IDL', label: 'OpenAPI 3', kinds: M, note: 'components/schemas (YAML)', generate: openapiSchema },
  { id: 'graphql', language: 'Schema / IDL', label: 'GraphQL SDL', kinds: M, note: 'type definitions', generate: graphqlSdl },
  { id: 'protobuf', language: 'Schema / IDL', label: 'Protocol Buffers', kinds: M, note: 'proto3 messages', generate: protobuf },

  // SQL
  { id: 'sql-create', language: 'SQL', label: 'CREATE TABLE', kinds: MIG, note: 'Portable DDL', generate: sqlCreate }
]

/** Ordered list of language groups, as they should appear in the menu. */
export const LANGUAGES: string[] = [...new Set(TARGETS.map((t) => t.language))]

export function targetsForLanguage(language: string): Target[] {
  return TARGETS.filter((t) => t.language === language)
}

export function targetById(id: string): Target | undefined {
  return TARGETS.find((t) => t.id === id)
}

/** Build IR tables from fetched structures. */
export function buildTables(input: { name: string; structure: TableStructure }[]): IRTable[] {
  return input.map((i) => buildIRTable(i.name, i.structure))
}

/** Run a target, returning the files for the requested kinds. */
export function runTarget(target: Target, tables: IRTable[], opts: GenerateOptions): GeneratedFile[] {
  const kinds = opts.kinds.filter((k) => target.kinds.includes(k))
  if (!kinds.length) return []
  return target.generate(tables, { ...opts, kinds })
}

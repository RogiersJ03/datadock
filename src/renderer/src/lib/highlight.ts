// A small, dependency-free syntax highlighter for the code-generation preview.
// It isn't a full parser — a single-pass tokenizer that colours comments,
// strings, numbers, keywords, literals, annotations, type names and call
// expressions. Driven by each generated file's known `lang`, which keeps the
// comment/string rules accurate enough across ~17 target languages without
// pulling in a grammar per language.

interface LangCfg {
  line: string[]
  block?: [string, string]
  quotes: string[]
  triple?: boolean
}

const DEFAULT: LangCfg = { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'] }

const CONFIGS: Record<string, LangCfg> = {
  ts: DEFAULT,
  js: DEFAULT,
  java: { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  csharp: { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  go: { line: ['//'], block: ['/*', '*/'], quotes: ['"', '`'] },
  rust: { line: ['//'], block: ['/*', '*/'], quotes: ['"'] }, // ' is a lifetime/char
  kotlin: { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  swift: { line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  dart: { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  php: { line: ['//', '#'], block: ['/*', '*/'], quotes: ['"', "'"] },
  python: { line: ['#'], quotes: ['"', "'"], triple: true },
  ruby: { line: ['#'], quotes: ['"', "'"] },
  elixir: { line: ['#'], quotes: ['"'], triple: true },
  sql: { line: ['--'], block: ['/*', '*/'], quotes: ["'", '"'] },
  yaml: { line: ['#'], quotes: ['"', "'"] },
  graphql: { line: ['#'], quotes: ['"'] },
  protobuf: { line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  json: { line: [], quotes: ['"'] },
  prisma: { line: ['//'], quotes: ['"'] }
}

// Union of keywords across the supported languages. Colouring a word that is a
// keyword only in another language is harmless, so one shared set is fine.
const KEYWORDS = new Set(
  (
    'abstract and as assert async await begin bool boolean break case catch chan class const constructor ' +
    'continue crate data debugger declare def defer del delegate do done dyn elif else elsif end ensure enum ' +
    'event export extends extern final finally fn for foreach from func function get global go goto guard if ' +
    'impl implements import in include instanceof int integer interface internal is lambda lateinit lazy let ' +
    'long loop macro match mod module move mut namespace native new object of open operator or out override ' +
    'package params pass private protected pub public raise readonly rec record ref register reified require ' +
    'rescue return sbyte sealed self short signed sizeof static str string struct super switch sync ' +
    'synchronized template then this throw throws trait type typealias typedef typeof uint ulong union unsafe ' +
    'unsigned until use using val var virtual void volatile when where while with yield defmodule do'
  ).split(/\s+/)
)

const LITERALS = new Set([
  'true',
  'false',
  'null',
  'nil',
  'none',
  'undefined',
  'True',
  'False',
  'None',
  'NULL',
  'TRUE',
  'FALSE'
])

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c)
const isIdent = (c: string): boolean => /[A-Za-z0-9_$]/.test(c)

/** Highlight `code` for the given language, returning safe HTML (all escaped). */
export function highlight(code: string, lang: string): string {
  // Very large output: skip highlighting to stay responsive.
  if (code.length > 200_000) return esc(code)
  const cfg = CONFIGS[lang] ?? DEFAULT
  let out = ''
  let i = 0
  const n = code.length
  const span = (cls: string, text: string): string => `<span class="hl-${cls}">${esc(text)}</span>`
  const at = (p: string, pos: number): boolean => code.startsWith(p, pos)

  while (i < n) {
    const c = code[i]

    // block comment
    if (cfg.block && at(cfg.block[0], i)) {
      let end = code.indexOf(cfg.block[1], i + cfg.block[0].length)
      end = end < 0 ? n : end + cfg.block[1].length
      out += span('com', code.slice(i, end))
      i = end
      continue
    }
    // line comment
    const lc = cfg.line.find((p) => at(p, i))
    if (lc) {
      let end = code.indexOf('\n', i)
      end = end < 0 ? n : end
      out += span('com', code.slice(i, end))
      i = end
      continue
    }
    // triple-quoted string
    if (cfg.triple && (at('"""', i) || at("'''", i))) {
      const q = code.slice(i, i + 3)
      let end = code.indexOf(q, i + 3)
      end = end < 0 ? n : end + 3
      out += span('str', code.slice(i, end))
      i = end
      continue
    }
    // string
    if (cfg.quotes.includes(c)) {
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === c) {
          j++
          break
        }
        if (code[j] === '\n') break
        j++
      }
      out += span('str', code.slice(i, j))
      i = j
      continue
    }
    // number
    if (/[0-9]/.test(c) && (i === 0 || !isIdent(code[i - 1]))) {
      let j = i
      if (at('0x', i) || at('0X', i)) {
        j = i + 2
        while (j < n && /[0-9a-fA-F_]/.test(code[j])) j++
      } else {
        while (j < n && /[0-9._]/.test(code[j])) j++
      }
      out += span('num', code.slice(i, j))
      i = j
      continue
    }
    // annotation / decorator (@Word)
    if (c === '@' && i + 1 < n && isIdentStart(code[i + 1])) {
      let j = i + 1
      while (j < n && isIdent(code[j])) j++
      out += span('dec', code.slice(i, j))
      i = j
      continue
    }
    // identifier / keyword / type / call
    if (isIdentStart(c)) {
      let j = i
      while (j < n && isIdent(code[j])) j++
      const word = code.slice(i, j)
      let cls = ''
      if (KEYWORDS.has(word)) cls = 'kw'
      else if (LITERALS.has(word)) cls = 'lit'
      else if (code[j] === '(') cls = 'fn'
      else if (/^[A-Z]/.test(word)) cls = 'type'
      out += cls ? span(cls, word) : esc(word)
      i = j
      continue
    }

    out += esc(c)
    i++
  }
  return out
}

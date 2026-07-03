// scripts/lib/posts.mjs
// 모든 글(docs/contents/**.md)의 frontmatter를 읽어 표준화된 목록으로 돌려주는 공용 모듈.
// landing / category / tag-stats 스크립트가 공통으로 사용한다.
//
// frontmatter 규칙(운영 가이드와 동일):
//   ---
//   title: 글 제목
//   date: 2026-07-02
//   category: 서비스개발        # 대분류 1개 (MECE)
//   tag: #서비스운영 #아키텍처   # 세부 태그 여러 개 (M:N)
//   ---
//
// 참고: `tag: #...` 의 `#` 는 YAML에서는 주석으로 취급되지만,
// 이 파서는 원문을 직접 읽으므로 문제 없이 해시태그를 추출한다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..', '..')
export const DOCS_DIR = path.join(ROOT, 'docs')
export const CONTENTS_DIR = path.join(DOCS_DIR, 'contents')

const UNCATEGORIZED = '미분류'

/** docs/contents 하위의 모든 .md 파일 경로(재귀, index.md 제외) */
function walkMarkdown(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full))
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md') {
      out.push(full)
    }
  }
  return out
}

/** frontmatter 블록(맨 위 --- ~ ---)을 key:value 맵으로 파싱 (평평한 스칼라만 지원) */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  const fm = {}
  if (!m) return fm
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z_][\w-]*)\s*:\s?(.*)$/.exec(line)
    if (mm) fm[mm[1].toLowerCase()] = mm[2].trim()
  }
  return fm
}

/** tag / tags 값에서 태그 배열 추출 ( #해시태그 / [a, b] / a, b 모두 허용 ) */
function parseTags(fm) {
  const raw = fm.tags ?? fm.tag
  if (!raw) return []
  const hashes = raw.match(/#([^\s#,]+)/g)
  if (hashes) return hashes.map((s) => s.slice(1))
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/** 날짜 결정: frontmatter date → 파일명 YYMMDD 프리픽스 → null */
function resolveDate(fm, filename) {
  if (fm.date) return fm.date.replace(/['"]/g, '').trim()
  const m = /^(\d{2})(\d{2})(\d{2})[-_]/.exec(filename)
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** 본문 첫 번째 h1(# ...) 을 제목 후보로 */
function firstHeading(raw) {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
  const m = /^#\s+(.+)$/m.exec(body)
  return m ? m[1].trim() : null
}

/** VitePress 라우트 경로 (/contents/... , 확장자 제거, POSIX 슬래시) */
function toLink(filePath) {
  const rel = path.relative(DOCS_DIR, filePath).replace(/\\/g, '/').replace(/\.md$/, '')
  return '/' + rel
}

/**
 * 모든 글을 표준 형태로 반환. 날짜 내림차순(최신 우선), 날짜 없는 글은 뒤로.
 * @returns {Array<{file,filename,title,description,date,category,tags,link}>}
 */
export function loadPosts() {
  if (!fs.existsSync(CONTENTS_DIR)) return []
  const posts = walkMarkdown(CONTENTS_DIR).map((file) => {
    const raw = fs.readFileSync(file, 'utf-8')
    const fm = parseFrontmatter(raw)
    const filename = path.basename(file)
    return {
      file,
      filename,
      title: fm.title || firstHeading(raw) || filename.replace(/\.md$/, ''),
      description: fm.description || '',
      date: resolveDate(fm, filename),
      category: fm.category || UNCATEGORIZED,
      tags: parseTags(fm),
      link: toLink(file),
    }
  })
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return posts
}

export { UNCATEGORIZED }

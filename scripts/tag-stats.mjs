// scripts/tag-stats.mjs  →  make tag-stats
// 모든 글의 태그 사용 빈도를 집계해 콘솔에 출력하고, 리포트 파일(tag-stats.md)로도 남긴다.
// 리포트 파일은 로컬 점검용이므로 .gitignore 에 등록되어 커밋되지 않는다.
// 용도: 태그 파편화(#운영, #서비스운영, #서비스-운영 처럼 뜻은 같은데 표기가 다른) 점검.

import fs from 'node:fs'
import path from 'node:path'
import { loadPosts, ROOT } from './lib/posts.mjs'

const OUT_FILE = path.join(ROOT, 'tag-stats.md')

const posts = loadPosts()

// 태그 빈도
const tagCount = new Map()
for (const p of posts) {
  for (const t of p.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
}
const sortedTags = [...tagCount.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'),
)

// 카테고리 빈도
const catCount = new Map()
for (const p of posts) catCount.set(p.category, (catCount.get(p.category) || 0) + 1)
const sortedCats = [...catCount.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'),
)

const totalTagUses = [...tagCount.values()].reduce((a, b) => a + b, 0)

// ── 콘솔 출력 ──────────────────────────────────────────────
console.log(`\n📊 태그 통계 (글 ${posts.length}개 / 태그 ${tagCount.size}종 / 총 ${totalTagUses}회 사용)\n`)
if (sortedTags.length === 0) {
  console.log('  아직 태그가 없습니다. 글 frontmatter에 `tag: #태그명` 을 추가하세요.')
} else {
  const maxCount = sortedTags[0][1]
  for (const [tag, count] of sortedTags) {
    const bar = '█'.repeat(Math.round((count / maxCount) * 20)) || '▏'
    console.log(`  ${String(count).padStart(3)}  ${bar}  #${tag}`)
  }
}
console.log(`\n📁 카테고리 분포`)
for (const [cat, count] of sortedCats) {
  console.log(`  ${String(count).padStart(3)}  ${cat}`)
}
console.log('')

// ── 리포트 파일 ────────────────────────────────────────────
const lines = []
lines.push('# 태그 통계 리포트')
lines.push('')
lines.push('> `make tag-stats` 로 생성된 로컬 리포트입니다 (git 추적 안 함).')
lines.push('> 표기가 비슷한 태그(예: `#운영` vs `#서비스운영`)가 있으면 하나로 통일하세요.')
lines.push('')
lines.push(`- 글: ${posts.length}개`)
lines.push(`- 태그: ${tagCount.size}종 (총 ${totalTagUses}회 사용)`)
lines.push(`- 카테고리: ${catCount.size}개`)
lines.push('')
lines.push('## 태그별 사용 횟수')
lines.push('')
lines.push('| 태그 | 횟수 |')
lines.push('| --- | ---: |')
for (const [tag, count] of sortedTags) lines.push(`| #${tag} | ${count} |`)
lines.push('')
lines.push('## 카테고리별 글 수')
lines.push('')
lines.push('| 카테고리 | 글 수 |')
lines.push('| --- | ---: |')
for (const [cat, count] of sortedCats) lines.push(`| ${cat} | ${count} |`)
lines.push('')

fs.writeFileSync(OUT_FILE, lines.join('\n'))
console.log(`  → 리포트 저장: ${path.relative(process.cwd(), OUT_FILE)} (gitignore 대상)\n`)

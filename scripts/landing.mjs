// scripts/landing.mjs  →  make landing
// 최근 글 21개(3열 × 7행)를 메인페이지용 데이터(recent.json)로 생성한다.
// 실제 렌더링은 theme/components/RecentPosts.vue 가 이 JSON을 읽어 담당한다.

import fs from 'node:fs'
import path from 'node:path'
import { loadPosts, DOCS_DIR } from './lib/posts.mjs'

const LIMIT = 21 // 3 × 7
const OUT_DIR = path.join(DOCS_DIR, '.vitepress', 'generated')
const OUT_FILE = path.join(OUT_DIR, 'recent.json')

const posts = loadPosts()
  .slice(0, LIMIT)
  .map(({ title, description, date, category, tags, link }) => ({
    title,
    description,
    date,
    category,
    tags,
    link,
  }))

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2) + '\n')

console.log(`✓ landing: 최근 글 ${posts.length}/${LIMIT}개를 메인페이지에 반영했습니다.`)
console.log(`  → ${path.relative(process.cwd(), OUT_FILE)}`)
if (posts.length < LIMIT) {
  console.log(`  (글이 ${LIMIT}개 미만이라 있는 만큼만 표시됩니다.)`)
}

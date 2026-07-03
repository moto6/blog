// scripts/category.mjs  →  make category
// 모든 글의 frontmatter `category` 를 기준으로 사이드바 구조(sidebar.json)를 생성한다.
// config.mts 가 이 파일을 읽어 themeConfig.sidebar 로 사용한다.
// → 글 파일에 category 만 적으면 사이드바가 자동으로 갱신된다.

import fs from 'node:fs'
import path from 'node:path'
import { loadPosts, DOCS_DIR, UNCATEGORIZED } from './lib/posts.mjs'

const OUT_DIR = path.join(DOCS_DIR, '.vitepress', 'generated')
const OUT_FILE = path.join(OUT_DIR, 'sidebar.json')

const posts = loadPosts()

// category → 글 목록
const groups = new Map()
for (const p of posts) {
  if (!groups.has(p.category)) groups.set(p.category, [])
  groups.get(p.category).push(p)
}

// 카테고리 정렬: 이름 오름차순, '미분류' 는 항상 맨 뒤
const categories = [...groups.keys()].sort((a, b) => {
  if (a === UNCATEGORIZED) return 1
  if (b === UNCATEGORIZED) return -1
  return a.localeCompare(b, 'ko')
})

const sidebar = categories.map((cat) => ({
  text: `${cat} (${groups.get(cat).length})`,
  collapsed: false,
  items: groups.get(cat).map((p) => ({
    text: p.title,
    link: p.link,
  })),
}))

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(sidebar, null, 2) + '\n')

console.log(`✓ category: ${posts.length}개 글을 ${categories.length}개 카테고리로 분류했습니다.`)
for (const cat of categories) {
  console.log(`  - ${cat}: ${groups.get(cat).length}개`)
}
console.log(`  → ${path.relative(process.cwd(), OUT_FILE)}`)

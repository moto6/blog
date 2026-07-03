import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPOSITORY_NAME = 'blog';

// GitHub Pages(프로젝트 사이트)는 /blog/ 하위 경로로 배포되므로 base가 필요하지만,
// 로컬 dev/preview에서는 루트(/)로 서빙되어야 프리뷰가 정상적으로 보입니다.
// GitHub Actions에서 빌드할 때만 base를 적용합니다.
const base = process.env.GITHUB_ACTIONS ? `/${REPOSITORY_NAME}/` : '/';

// 사이드바는 `make category`가 생성하는 generated/sidebar.json에서 읽습니다.
// (frontmatter의 category 기준으로 자동 구성 — "표현/내용 분리")
// 파일이 아직 없으면 빈 사이드바로 폴백합니다.
function loadSidebar() {
  try {
    const url = fileURLToPath(new URL('./generated/sidebar.json', import.meta.url));
    return JSON.parse(fs.readFileSync(url, 'utf-8'));
  } catch {
    return [];
  }
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Engineering Note",
  description: "Engineering Note",
  base,
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: '예시', link: '/contents/markdown-examples' }
    ],

    // `make category`로 생성됨. 직접 수정하지 마세요.
    sidebar: loadSidebar(),

    // VitePress 내장 로컬 검색(MiniSearch). 외부 서비스/비용 없음.
    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moto6' }
    ]
  }
})

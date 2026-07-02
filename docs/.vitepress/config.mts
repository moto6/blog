import { defineConfig } from 'vitepress'
const REPOSITORY_NAME = 'blog';

// GitHub Pages(프로젝트 사이트)는 /blog/ 하위 경로로 배포되므로 base가 필요하지만,
// 로컬 dev/preview에서는 루트(/)로 서빙되어야 프리뷰가 정상적으로 보입니다.
// GitHub Actions에서 빌드할 때만 base를 적용합니다.
const base = process.env.GITHUB_ACTIONS ? `/${REPOSITORY_NAME}/` : '/';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Engineering Note",
  description: "Engineering Note",
  base,
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/contents/markdown-examples' }
    ],

    sidebar: [
      {
        text: 'Examples',
        items: [
          { text: 'Markdown Examples', link: '/contents/markdown-examples' },
          { text: 'Runtime API Examples', link: '/contents/api-examples' },
          { text: '예시', link: '/contents/api-examples' },
        ]
      },
      {
        text: '222222',
        items: [
          { text: 'Markdown Examples', link: '/contents/markdown-examples' },
          { text: 'Runtime API Examples', link: '/contents/api-examples' },
          { text: '내컨텐츠', link: '/contents/260420_test' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moto6' },
      { icon: 'LinkedIn', link: '' }
    ]
  }
})

import { defineConfig } from 'vitepress'
const REPOSITORY_NAME = 'blog';

/*
export default defineConfig({
    title: "Cheat Sheet",
    description: "engineer's cheat sheet",
    base: `/${REPOSITORY_NAME}/`,
})
 */
// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "",
  description: "Engineering Note",
  base: `/${REPOSITORY_NAME}/`,
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' }
    ],

    sidebar: [
      {
        text: 'Examples',
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' },
          { text: '예시', link: '/api-examples' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moto6' },
      { icon: 'LinkedIn', link: '' }
    ]
  }
})

// docs/.vitepress/theme/index.ts
import DefaultTheme from 'vitepress/theme'
import './style.css'
import RecentPosts from './components/RecentPosts.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 메인페이지에서 <RecentPosts /> 로 사용
    app.component('RecentPosts', RecentPosts)
  }
}

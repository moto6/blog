---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Engineering Note"
  text: "기록하며 성장하는 개발 블로그"
  tagline: 배우고 정리한 것들을 꾸준히 기록합니다.
  actions:
    - theme: brand
      text: 글 둘러보기
      link: /contents/markdown-examples
    - theme: alt
      text: GitHub
      link: https://github.com/moto6
---

<!--
  아래 "최근 글" 그리드는 `make landing`이 생성하는 데이터(generated/recent.json)를
  RecentPosts 컴포넌트가 렌더링합니다. 이 파일을 직접 수정할 필요는 없습니다.
-->
<RecentPosts />

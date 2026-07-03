<script setup>
// 메인페이지 "최근 글" 3열 × 7행(최대 21개) 그리드.
// 데이터는 `make landing` 이 생성하는 generated/recent.json 에서 읽는다.
import { withBase } from 'vitepress'
import posts from '../../generated/recent.json'

// 파일명에 공백/특수문자가 있어도 안전하도록 경로를 인코딩
const href = (link) => withBase(link.split('/').map(encodeURIComponent).join('/'))
</script>

<template>
  <section class="recent">
    <h2 class="recent-heading">최근 글</h2>

    <div v-if="posts.length" class="recent-grid">
      <a v-for="p in posts" :key="p.link" class="recent-card" :href="href(p.link)">
        <span v-if="p.category" class="recent-cat">{{ p.category }}</span>
        <span class="recent-title">{{ p.title }}</span>
        <span v-if="p.date" class="recent-date">{{ p.date }}</span>
        <span v-if="p.tags && p.tags.length" class="recent-tags">
          <span v-for="t in p.tags" :key="t" class="recent-tag">#{{ t }}</span>
        </span>
      </a>
    </div>

    <p v-else class="recent-empty">
      아직 글이 없습니다. 글을 추가한 뒤 <code>make landing</code> 을 실행하세요.
    </p>
  </section>
</template>

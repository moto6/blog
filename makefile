# Blog 운영 명령어
# 사용법: make <target>   (예: make landing)

NODE ?= node

.PHONY: help landing category tag-stats gen dev build preview

help: ## 사용 가능한 명령어 목록
	@echo "make landing     - 최근 글 21개(3x7)를 메인페이지 데이터로 갱신"
	@echo "make category    - frontmatter의 category 기준으로 사이드바 자동 생성"
	@echo "make tag-stats   - 태그 사용 통계 출력 + 리포트 파일 생성(gitignore 대상)"
	@echo "make gen         - landing + category 를 한 번에 실행"
	@echo "make dev         - 로컬 개발 서버(gen 후 실행)"
	@echo "make build       - 정적 사이트 빌드(gen 후 실행)"
	@echo "make preview     - 빌드 결과 미리보기"

landing: ## 최근 글 21개를 메인페이지에 반영
	@$(NODE) scripts/landing.mjs

category: ## category 기준 사이드바 생성
	@$(NODE) scripts/category.mjs

tag-stats: ## 태그 통계 출력 + 리포트 파일 생성
	@$(NODE) scripts/tag-stats.mjs

gen: landing category ## 메인/사이드바 데이터 일괄 생성

dev: gen ## 최신 데이터로 개발 서버 실행
	@npm run docs:dev

build: gen ## 최신 데이터로 정적 사이트 빌드
	@npm run docs:build

preview: ## 빌드 결과 미리보기
	@npm run docs:preview

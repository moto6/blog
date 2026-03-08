import {defineConfig} from 'vitepress'

const REPOSITORY_NAME = 'blog';

export default defineConfig({
    title: "Cheat Sheet",
    description: "engineer's cheat sheet",
    base: `/${REPOSITORY_NAME}/`,
})
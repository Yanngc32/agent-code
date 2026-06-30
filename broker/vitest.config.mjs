import { defineConfig } from 'vitest/config'

// Config próprio do broker — não herda o config do app (React/jsdom) da raiz.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node'
  }
})

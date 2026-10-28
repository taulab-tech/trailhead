import type { TrailheadApi } from './index'

declare global {
  interface Window {
    api: TrailheadApi
  }
}

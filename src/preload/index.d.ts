import type { SigmaApi } from './index'

declare global {
  interface Window {
    api: SigmaApi
  }
}

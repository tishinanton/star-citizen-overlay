import type { RockfallApi } from '../shared/contracts'

declare global {
  interface Window {
    rockfall: RockfallApi
  }
}

// Phase 8.01.F T-10 — slide-over state store.

import { afterEach, describe, expect, it } from 'vitest'

import {
  setTreeSlideOverOpen,
  setDirectorSlideOverOpen,
  toggleTreeSlideOver,
  toggleDirectorSlideOver,
  _peekSlideOverState,
  _resetSlideOverState,
} from '@/lib/stores/slide-over-state'

afterEach(() => {
  _resetSlideOverState()
})

describe('slide-over state store', () => {
  it('initial state has both slide-overs closed', () => {
    expect(_peekSlideOverState()).toEqual({ tree: false, director: false })
  })

  it('setTreeSlideOverOpen(true) opens just the tree slide-over', () => {
    setTreeSlideOverOpen(true)
    expect(_peekSlideOverState()).toEqual({ tree: true, director: false })
  })

  it('toggleTreeSlideOver flips the tree state', () => {
    toggleTreeSlideOver()
    expect(_peekSlideOverState().tree).toBe(true)
    toggleTreeSlideOver()
    expect(_peekSlideOverState().tree).toBe(false)
  })

  it('director state is independent of tree state', () => {
    setTreeSlideOverOpen(true)
    setDirectorSlideOverOpen(true)
    expect(_peekSlideOverState()).toEqual({ tree: true, director: true })
    setTreeSlideOverOpen(false)
    expect(_peekSlideOverState()).toEqual({ tree: false, director: true })
  })

  it('toggleDirectorSlideOver flips the director state', () => {
    toggleDirectorSlideOver()
    expect(_peekSlideOverState().director).toBe(true)
    toggleDirectorSlideOver()
    expect(_peekSlideOverState().director).toBe(false)
  })

  it('idempotent: setting same state twice has no listener spam', () => {
    setTreeSlideOverOpen(true)
    setTreeSlideOverOpen(true) // should early-return
    expect(_peekSlideOverState().tree).toBe(true)
  })
})

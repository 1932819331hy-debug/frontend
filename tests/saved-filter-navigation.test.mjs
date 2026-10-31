import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

import { transformSync } from '@swc/core'
import React from 'react'
import { renderToString } from 'react-dom/server'

import { advanceSavedFilterNavigation } from '../src/utils/SavedFilterNavigation.js'

const savedFilters = [{ id: 1 }, { id: 2 }]
const insight = { conditions: [{ type: 'dueDate', operator: 'isOverdue' }] }
const initial = { rawFilterId: null, pending: null }
const step = (previous, values = {}) =>
  advanceSavedFilterNavigation(previous, {
    activeFilterId: null,
    filtersStatus: 'success',
    filtersFetchStatus: 'idle',
    rawFilterId: '1',
    savedFilters,
    tempFilter: null,
    ...values,
  })

test('a changed saved-filter URL replaces an active saved filter', () => {
  const before = step(initial, { activeFilterId: 1 })
  const pending = step(before, { rawFilterId: '2', activeFilterId: 1 })
  assert.equal(pending.filterIdToApply, 2)
  assert.ok(pending.pending)
  const settled = step(pending, { rawFilterId: '2', activeFilterId: 2 })
  assert.equal(settled.pending, null)
  assert.equal(settled.filterIdToApply, null)
  assert.equal(step(settled, { activeFilterId: 2 }).filterIdToApply, 1)
})

test('an incoming saved link stays protected while filters load', () => {
  const previous = step(initial, {
    rawFilterId: 'overdue',
    tempFilter: insight,
  })
  const pending = step(previous, {
    rawFilterId: '2',
    tempFilter: insight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  assert.ok(pending.pending)
  assert.equal(pending.filterIdToApply, null)
  const repeated = step(pending, {
    rawFilterId: '2',
    tempFilter: insight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  assert.ok(repeated.pending)
  const loaded = step(repeated, { rawFilterId: '2', tempFilter: insight })
  assert.equal(loaded.filterIdToApply, 2)
  assert.ok(loaded.pending)
  const settled = step(loaded, { rawFilterId: '2', activeFilterId: 2 })
  assert.equal(settled.pending, null)
})

test('initial saved-filter loading does not require a temporary insight', () => {
  const pending = step(initial, {
    rawFilterId: '2',
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  assert.ok(pending.pending)
  assert.equal(step(pending, { rawFilterId: '2' }).filterIdToApply, 2)
})

test('local insight selection wins over an unchanged saved URL', () => {
  const settled = step(initial, { activeFilterId: 1 })
  const local = step(settled, { tempFilter: insight })
  assert.equal(local.pending, null)
  assert.equal(local.filterIdToApply, null)
})

test('local insight selection cancels a pending external saved link', () => {
  const waiting = step(initial, {
    rawFilterId: '2',
    tempFilter: insight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  const otherInsight = { conditions: [{ type: 'priority', value: 1 }] }
  const local = step(waiting, {
    rawFilterId: '2',
    tempFilter: otherInsight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  assert.equal(local.pending, null)
  assert.equal(
    step(local, { rawFilterId: '2', tempFilter: otherInsight })
      .filterIdToApply,
    null,
  )
})

test('clearing a pending link releases the guard without selecting a filter', () => {
  const pending = step(initial, {
    rawFilterId: '2',
    tempFilter: insight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  const cleared = step(pending, { rawFilterId: null })
  assert.equal(cleared.pending, null)
  assert.equal(cleared.filterIdToApply, null)
})

test('unknown saved IDs release once the saved list arrives', () => {
  const pending = step(initial, {
    rawFilterId: '999',
    tempFilter: insight,
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  const missing = step(pending, { rawFilterId: '999', tempFilter: insight })
  assert.equal(missing.pending, null)
  assert.equal(missing.filterIdToApply, null)
  const local = step(missing, { rawFilterId: '999', tempFilter: {} })
  assert.equal(local.pending, null)
})

test('a newer external URL replaces the previous pending target', () => {
  const waiting = step(initial, {
    rawFilterId: '1',
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  const next = step(waiting, {
    rawFilterId: '2',
    savedFilters: [],
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
  })
  assert.equal(step(next, { rawFilterId: '2' }).filterIdToApply, 2)
})

test('non-numeric insight IDs never become pending saved selections', () => {
  for (const rawFilterId of ['overdue', 'assignedTo:7', '', null]) {
    const result = step(initial, {
      rawFilterId,
      tempFilter: insight,
      savedFilters: [],
      filtersStatus: 'pending',
      filtersFetchStatus: 'fetching',
    })
    assert.equal(result.pending, null)
    assert.equal(result.filterIdToApply, null)
  }
})

test('the coordinator does not mutate the previous state or inputs', () => {
  const previous = Object.freeze({ rawFilterId: null, pending: null })
  const values = Object.freeze({
    activeFilterId: 1,
    rawFilterId: '2',
    savedFilters: Object.freeze(savedFilters),
    tempFilter: null,
  })
  assert.equal(
    advanceSavedFilterNavigation(previous, values).filterIdToApply,
    2,
  )
  assert.deepEqual(previous, { rawFilterId: null, pending: null })
})

test('stale cached filters do not disprove an incoming ID during refresh', () => {
  const waiting = step(initial, {
    filtersStatus: 'success',
    filtersFetchStatus: 'fetching',
    rawFilterId: '2',
    savedFilters: [{ id: 1 }],
    tempFilter: insight,
  })
  assert.ok(waiting.pending)
  assert.equal(waiting.filterIdToApply, null)
  assert.equal(
    step(waiting, { rawFilterId: '2', tempFilter: insight }).filterIdToApply,
    2,
  )
})

test('a completed empty response releases an unknown-ID guard', () => {
  const waiting = step(initial, {
    filtersStatus: 'pending',
    filtersFetchStatus: 'fetching',
    rawFilterId: '999',
    savedFilters: [],
    tempFilter: insight,
  })
  const complete = step(waiting, {
    filtersStatus: 'success',
    filtersFetchStatus: 'idle',
    rawFilterId: '999',
    savedFilters: [],
    tempFilter: insight,
  })
  assert.equal(complete.pending, null)
  assert.equal(complete.filterIdToApply, null)
})

// Exercise the real hook's query-result forwarding as well as the coordinator.
// Only the service query boundary is mocked; React and the hook body are real.
const hookPath = new URL(
  '../src/views/Chores/hooks/useCustomFilters.js',
  import.meta.url,
)
const { code: hookCode } = transformSync(readFileSync(hookPath, 'utf8'), {
  jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
  module: { type: 'commonjs' },
})
const readHook = query => {
  const exports = {}
  const mutation = () => ({ mutate: () => {} })
  const modules = {
    react: React,
    '../../../queries/UserQueries': { useUserProfile: () => ({}) },
    '../../../utils/FilterEngine': {
      applyFilter: chores => chores,
      validateFilter: () => ({ isValid: true, issues: [] }),
    },
    '../../Filters/FilterQueries': {
      useFilters: () => query,
      useCreateFilter: mutation,
      useDeleteFilter: mutation,
      useToggleFilterPin: mutation,
      useUpdateFilter: mutation,
    },
  }
  vm.runInThisContext(`(function(require, exports) {${hookCode}\n})`)(
    name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`)
      return modules[name]
    },
    exports,
  )
  let value
  const Probe = () => {
    value = exports.useCustomFilters([], [], [], [])
    return null
  }
  renderToString(React.createElement(Probe))
  return value
}

for (const status of ['pending', 'error', 'success']) {
  for (const fetchStatus of ['paused', 'fetching', 'idle']) {
    test(`query contract: ${status}/${fetchStatus}`, () => {
      const result = readHook({
        data: status === 'success' ? [] : undefined,
        status,
        fetchStatus,
        isFetching: fetchStatus === 'fetching',
      })
      assert.equal(result.filtersStatus, status)
      assert.equal(result.filtersFetchStatus, fetchStatus)
      const pending = step(initial, {
        savedFilters: result.savedFilters,
        filtersStatus: result.filtersStatus,
        filtersFetchStatus: result.filtersFetchStatus,
      })
      assert.equal(
        Boolean(pending.pending),
        !(status === 'success' && fetchStatus === 'idle'),
      )
      if (pending.pending) {
        assert.equal(step(pending).filterIdToApply, 1)
        assert.equal(step(pending, { tempFilter: insight }).pending, null)
      }
    })
  }
}

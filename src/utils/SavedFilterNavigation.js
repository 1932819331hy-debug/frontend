// Keep an external saved-filter selection pending until its data can be read.
// A local selection or a newer URL cancels that intent. The caller uses pending
// to stop a stale temporary filter from writing over the incoming URL.
export const advanceSavedFilterNavigation = (
  previous,
  {
    activeFilterId,
    filtersStatus,
    filtersFetchStatus,
    rawFilterId,
    savedFilters,
    tempFilter,
  },
) => {
  const filterId = rawFilterId ? Number(rawFilterId) || rawFilterId : null
  let pending = previous.pending

  if (previous.rawFilterId !== rawFilterId) {
    pending =
      typeof filterId === 'number' ? { activeFilterId, tempFilter } : null
  } else if (
    pending &&
    (pending.activeFilterId !== activeFilterId ||
      pending.tempFilter !== tempFilter)
  ) {
    // This also releases the guard once applyCustomFilter has taken effect.
    pending = null
  }

  let filterIdToApply = null
  if (pending) {
    const filter = savedFilters.find(filter => filter.id === filterId)
    if (filter) {
      if (activeFilterId === filter.id && !tempFilter) {
        pending = null
      } else {
        filterIdToApply = filter.id
      }
    } else if (filtersStatus === 'success' && filtersFetchStatus === 'idle') {
      // Only settled successful data can disprove the incoming ID. Pending,
      // paused, and failed queries may still receive data on resume or retry.
      pending = null
    }
  }

  return { rawFilterId, pending, filterIdToApply }
}

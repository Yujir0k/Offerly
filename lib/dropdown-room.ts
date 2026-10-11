// Make space in the nearest scrolling surface before opening downward.
export function makeDropdownRoom(element: HTMLElement, height = 260) {
  let remaining = Math.max(
    0,
    element.getBoundingClientRect().bottom + height + 20 - window.innerHeight,
  );
  let foundSurface = false;
  for (
    let parent = element.parentElement;
    parent && remaining > 0;
    parent = parent.parentElement
  ) {
    if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
    foundSurface = true;
    const before = parent.scrollTop;
    parent.scrollTop += remaining;
    remaining -= parent.scrollTop - before;
  }
  if (remaining > 0 && !foundSurface)
    window.scrollBy({ top: remaining, behavior: "instant" });
}

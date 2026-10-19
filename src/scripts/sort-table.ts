// Sortable tables. A table marked data-sortable is a complete, static table
// that reads in a sensible order without script; this adds a button to each
// heading marked data-sort, which sorts the rows by that column and says so
// (aria-sort on the heading, and a polite announcement). Cells give their
// key in data-sort-value: numbers separated by spaces, compared in turn, or
// text. A cell with an empty key is unknown and stays at the bottom whichever
// way the column sorts, so unknown never sorts as zero or as a pass.
type Direction = 'ascending' | 'descending';
type Key = (number | string)[] | null;

function keyOf(cell: HTMLTableCellElement | undefined, type: string): Key {
  const raw = cell?.dataset.sortValue ?? cell?.textContent?.trim() ?? '';
  if (raw === '') return null;
  if (type !== 'number') return [raw];
  const parts = raw.split(/\s+/).map(Number);
  return parts.some(Number.isNaN) ? null : parts;
}

function compare(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : -1) : 1;
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    if (d !== 0) return d;
  }
  return 0;
}

function setup(root: HTMLElement) {
  const table = root.querySelector<HTMLTableElement>('table[data-sortable]');
  const body = table?.tBodies[0];
  const head = table?.tHead?.rows[0];
  if (!table || !body || !head) return;
  const status = root.querySelector<HTMLElement>('[data-sort-status]');
  const original = [...body.rows];
  const cells = [...head.cells];
  for (const [column, th] of cells.entries()) {
    const type = th.dataset.sort;
    if (!type) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort';
    button.append(...th.childNodes);
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(arrow);
    th.append(button);
    button.addEventListener('click', () => {
      const first = (th.dataset.sortFirst as Direction | undefined) ?? 'ascending';
      const current = th.getAttribute('aria-sort');
      const direction: Direction = current === first ? (first === 'ascending' ? 'descending' : 'ascending') : first;
      for (const other of cells) other.removeAttribute('aria-sort');
      th.setAttribute('aria-sort', direction);
      const keyed = original.map((row, index) => ({ row, index, key: keyOf(row.cells[column], type) }));
      keyed.sort((a, b) => {
        if (a.key === null || b.key === null) return a.key === b.key ? a.index - b.index : a.key === null ? 1 : -1;
        const d = compare(a.key, b.key);
        return (direction === 'ascending' ? d : -d) || a.index - b.index;
      });
      body.append(...keyed.map((k) => k.row));
      const label = th.dataset.sortLabel ?? button.textContent?.trim() ?? '';
      const order = direction === 'ascending' ? th.dataset.sortAsc : th.dataset.sortDesc;
      if (status) status.textContent = `Sorted by ${label}, ${order ?? direction}.`;
    });
  }
  const hint = root.querySelector<HTMLElement>('[data-sort-hint]');
  if (hint) hint.hidden = false;
}

for (const root of document.querySelectorAll<HTMLElement>('[data-sort-root]')) setup(root);

export {};

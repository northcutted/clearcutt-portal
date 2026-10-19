// Filter boxes. An input[data-filter] hides the rows (tr[data-text]) of the
// details or section it is in whose text doesn't include what is typed, and
// a [data-count] there says how many match. Without script the box does
// nothing and every row shows.
for (const input of document.querySelectorAll<HTMLInputElement>('input[data-filter]')) {
  const scope = input.closest('details, section') ?? document.body;
  const rows = [...scope.querySelectorAll<HTMLElement>('tr[data-text]')];
  const count = scope.querySelector<HTMLElement>('[data-count]');
  const noun = input.dataset.filterNoun ?? 'rows';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      row.hidden = q !== '' && !row.dataset.text!.includes(q);
      if (!row.hidden) shown++;
    }
    if (count) count.textContent = q === '' ? '' : `${shown} of ${rows.length} ${noun} match.`;
  });
}

export {};

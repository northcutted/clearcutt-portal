// The package search on the packages page. It fetches the index the build
// wrote (packages/search-index.json) the first time it is needed, and
// answers each query in the browser with the same code the build tests. It
// builds the results with DOM methods only, so no text from the report is
// ever parsed as markup. Without script the search stays hidden, and each
// package's page answers the same question.
import {
  describeRanges,
  indexTypes,
  inheritedWords,
  parseQuery,
  search,
  type PackageAnswer,
  type PackageQuery,
  type SearchIndex,
  type SearchResult,
} from '../lib/package-search.ts';

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string>, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** A link to a page of this site; anything else stays text. */
function link(href: string, text: string): Child {
  return href.startsWith('/') && !href.startsWith('//') ? el('a', { href }, text) : text;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function list(index: SearchIndex, ids: string[]): Child[] {
  const byId = new Map(index.images.map((i) => [i.id, i]));
  return ids.flatMap((id, k) => {
    const image = byId.get(id);
    return [...(k > 0 ? [', '] : []), image ? link(image.href, image.label) : id];
  });
}

function answerTable(index: SearchIndex, answer: PackageAnswer): HTMLElement {
  const byId = new Map(index.images.map((i) => [i.id, i]));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const image = (id: string) => {
    const found = byId.get(id);
    return found ? link(found.href, found.label) : id;
  };
  const rows = [
    ...answer.direct.map((d) =>
      el(
        'tr',
        {},
        el('td', {}, image(d.id)),
        el('td', { class: 'mono small' }, d.versions.join(', ')),
        el('td', {}, el('strong', {}, 'Ships it'), d.baseToo ? `; so does its base, ${label(d.baseToo)}.` : '.'),
      ),
    ),
    ...answer.inherited.map((i) => {
      const words = inheritedWords(i, label);
      return el(
        'tr',
        {},
        el('td', {}, image(i.id)),
        el('td', { class: 'mono small' }, i.versions.join(', ')),
        el('td', {}, el('strong', {}, words.label), el('div', { class: 'small dim' }, words.detail)),
      );
    }),
  ];
  const matching = answer.matching.map((m) => m.version);
  return el(
    'section',
    { class: 'search-answer' },
    el(
      'h3',
      {},
      link(answer.href, answer.name),
      ' ',
      el('span', { class: 'dim small' }, `${answer.type} · ${answer.matching.length} of ${plural(answer.total, 'version')} match`),
    ),
    el(
      'p',
      { class: 'small' },
      `${plural(answer.direct.length, 'image ships', 'images ship')} ${matching.length === 1 ? matching[0] : 'a matching version'}; `,
      `${plural(answer.inherited.length, 'more is', 'more are')} built on one that does.`,
    ),
    el(
      'div',
      { class: 'table-wrap' },
      el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Image'), el('th', {}, 'Version'), el('th', {}, 'How'))), el('tbody', {}, ...rows)),
    ),
  );
}

function caveats(index: SearchIndex, result: SearchResult): HTMLElement[] {
  const out: HTMLElement[] = [];
  const answered = new Set(result.answers.flatMap((a) => a.inherited.map((i) => i.id)));
  const unknown = result.unknown.filter((id) => !answered.has(id));
  if (unknown.length > 0) {
    out.push(
      el(
        'p',
        {},
        `${plural(unknown.length, 'image has', 'images have')} no package list in the report and ${unknown.length === 1 ? "isn't" : "aren't"} built on one that ships it. Whether ${unknown.length === 1 ? 'it ships' : 'they ship'} it is unknown: `,
        ...list(index, unknown),
        '.',
      ),
    );
  }
  const partial = index.images.filter((i) => i.packages === 'partial').map((i) => i.id);
  if (partial.length > 0) {
    out.push(
      el(
        'p',
        {},
        `${plural(partial.length, "image's package list rests", "images' package lists rest")} on SBOMs no trusted signer verified, so ${partial.length === 1 ? 'it' : 'they'} may not be complete: `,
        ...list(index, partial),
        '.',
      ),
    );
  }
  return out.length > 0 ? [el('div', { class: 'callout' }, el('h3', {}, 'Not covered'), ...out)] : [];
}

function render(index: SearchIndex, query: PackageQuery, result: SearchResult, status: HTMLElement, results: HTMLElement) {
  const versions = query.ranges.length > 0 ? ` ${describeRanges(query.ranges)}` : '';
  const what = `${query.type ? `${query.type}:` : ''}${query.name}${versions}`;
  if (result.answers.length === 0) {
    status.textContent = `No package in the report matches ${what}.`;
  } else {
    const ships = new Set(result.answers.flatMap((a) => a.direct.map((d) => d.id)));
    const inherits = new Set(result.answers.flatMap((a) => a.inherited.filter((i) => i.own === 'unknown').map((i) => i.id)));
    for (const id of ships) inherits.delete(id);
    status.textContent =
      `${plural(result.answers.length + result.more, 'package matches', 'packages match')} ${what}: ` +
      `${plural(ships.size, 'image ships', 'images ship')} one, and ${plural(inherits.size, 'more inherits', 'more inherit')} one from a base.` +
      (result.more > 0 ? ` Showing the first ${result.answers.length}; narrow the name to see the rest.` : '');
  }
  results.replaceChildren(...result.answers.map((a) => answerTable(index, a)), ...caveats(index, result));
}

function mount(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  const status = root.querySelector<HTMLElement>('[data-search-status]');
  const results = root.querySelector<HTMLElement>('[data-search-results]');
  const url = root.dataset.index;
  if (!input || !status || !results || !url) return;
  let index: Promise<SearchIndex> | null = null;
  const load = () =>
    (index ??= fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<SearchIndex>;
    }));

  let timer: number | undefined;
  const run = async () => {
    const text = input.value.trim();
    const params = new URLSearchParams(location.search);
    if (text) params.set('q', text);
    else params.delete('q');
    const qs = params.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    if (!text) {
      status.textContent = '';
      results.replaceChildren();
      return;
    }
    let data: SearchIndex;
    try {
      data = await load();
    } catch {
      index = null;
      status.textContent = "The search index couldn't be loaded. Each package's page below answers the same question.";
      return;
    }
    if (input.value.trim() !== text) return;
    const parsed = parseQuery(text, indexTypes(data));
    if (!parsed.ok) {
      status.textContent = parsed.error;
      results.replaceChildren();
      return;
    }
    render(data, parsed.query, search(data, parsed.query), status, results);
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 150);
  });
  root.hidden = false;
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    input.value = q;
    void run();
  }
}

const root = document.querySelector<HTMLElement>('[data-package-search]');
if (root) mount(root);

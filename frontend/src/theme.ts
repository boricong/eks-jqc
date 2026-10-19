import { ref } from 'vue';

export type Theme = 'light' | 'dark';
const hintKey = 'eks-theme-actor';
const keyFor = (id: string) => `eks-theme:${id}`;
const parse = (value: unknown): Theme => (value === 'dark' ? 'dark' : 'light');
export const theme = ref<Theme>(parse(document.documentElement.dataset.theme));
let actor = '';

function apply(value: Theme) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', value === 'dark' ? '#171721' : '#F4F7FB');
}
export function useActorTheme(id: string) {
  actor = id;
  let value: string | null = null;
  try {
    value = id ? localStorage.getItem(keyFor(id)) : null;
  } catch {
    /* In-memory switching still works. */
  }
  try {
    if (id) sessionStorage.setItem(hintKey, id);
    else sessionStorage.removeItem(hintKey);
  } catch {
    /* The verified session remains the source of identity. */
  }
  apply(parse(value));
}
export function selectTheme(value: string) {
  const selected = parse(value);
  apply(selected);
  if (actor)
    try {
      localStorage.setItem(keyFor(actor), selected);
    } catch {
      /* Storage may be disabled. */
    }
}
window.addEventListener('storage', (event) => {
  if (actor && (event.key === keyFor(actor) || event.key === null)) apply(parse(event.newValue));
});

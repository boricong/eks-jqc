const storageKey = 'eks-data-generation';
export const DATASET_EVENT = 'eks-dataset-changed';
let generation = '';
let epoch = 0;
try {
  generation = localStorage.getItem(storageKey) || '';
} catch {
  /* HTTP checks still work. */
}
export const getDataGeneration = () => generation;
export const getDataEpoch = () => epoch;
export function observeGeneration(value: string | null) {
  if (!value || value === generation) return;
  const previous = generation;
  generation = value;
  epoch++;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Storage may be disabled. */
  }
  if (previous)
    window.dispatchEvent(new CustomEvent(DATASET_EVENT, { detail: { previous, generation } }));
}
window.addEventListener('storage', (event) => {
  if (event.key === storageKey && event.newValue) observeGeneration(event.newValue);
});

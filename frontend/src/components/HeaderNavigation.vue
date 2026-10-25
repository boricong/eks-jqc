<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  useRoute,
  useRouter,
  isNavigationFailure,
  NavigationFailureType,
  type RouteLocationRaw,
} from 'vue-router';
import { useDemo } from '../stores/demo';
import {
  learnerNavigationItems,
  learningStage,
  ownedQualificationsLocation,
} from '../learner-navigation';
import { withCriteriaType, visibleManagementGroups } from '../management-navigation';
import { systemSections } from '../system-navigation';
import AppIcon from './AppIcon.vue';

type Link = { key: string; label: string; to: RouteLocationRaw; current: boolean };
type Group = { id: string; title?: string; links: Link[] };
type Item = { id: string; label: string; to: RouteLocationRaw; groups?: Group[] };
const props = defineProps<{ section: string }>();
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const menuOpen = ref(false),
  opened = ref('');
const nav = ref<HTMLElement>(),
  menuButton = ref<HTMLButtonElement>();
const compact = ref(false);
let opening: ReturnType<typeof setTimeout> | undefined,
  closing: ReturnType<typeof setTimeout> | undefined;
let hoverMedia: MediaQueryList | undefined;
let removeNavigationHook: (() => void) | undefined;
const unread = computed(() => store.data.notifications.filter((item) => !item.readAt).length);
const items = computed<Item[]>(() => {
  const result: Item[] = [{ id: 'home', label: '홈', to: '/' }];
  if (store.canEnterPersonal)
    result.push(
      {
        id: 'learning',
        label: '자격 취득',
        to: '/qualifications',
        groups: [
          {
            id: 'learning',
            links: learnerNavigationItems(
              undefined,
              undefined,
              store.hasRole('learner') ? 'auditee' : 'auditor',
            ).map((item) => ({
              key: item.key,
              label: item.label,
              to: item.path,
              current:
                props.section === 'learning' &&
                (route.path.startsWith('/plans')
                  ? item.key === 'plans'
                  : item.key === learningStage(route)),
            })),
          },
        ],
      },
      { id: 'owned', label: '보유 자격', to: ownedQualificationsLocation },
    );
  if (store.canEnterManagement)
    result.push({
      id: 'management',
      label: '인증 업무 관리',
      to: '/admin',
      groups: visibleManagementGroups(store.canManageSection).map((group) => ({
        id: group.id,
        title: group.name,
        links: group.sections.map((item) => ({
          key: item.id,
          label: item.name,
          to: withCriteriaType(
            store.managementLink(item.path),
            /^\/admin\/(qualifications|courses)(\/|$)/.test(route.path)
              ? route.query.type
              : undefined,
          ),
          current:
            props.section === 'management' &&
            String(route.meta.managementSection || route.params.section) === item.id,
        })),
      })),
    });
  if (store.hasRole('system_operator'))
    result.push({
      id: 'system',
      label: '시스템 운영',
      to: '/system/organizations',
      groups: [
        {
          id: 'system',
          links: systemSections.map((item) => ({
            key: item.id,
            label: item.name,
            to: item.path,
            current: props.section === 'system' && route.params.section === item.id,
          })),
        },
      ],
    });
  if (store.signedIn) result.push({ id: 'notifications', label: '알림', to: '/notifications' });
  return result;
});
function clearTimers() {
  clearTimeout(opening);
  clearTimeout(closing);
}
function closeAll() {
  clearTimers();
  opened.value = '';
  menuOpen.value = false;
}
function toggleElement(id: string) {
  return nav.value?.querySelector<HTMLButtonElement>(`[data-submenu-toggle="${id}"]`);
}
function panelElement(id: string) {
  return nav.value?.querySelector<HTMLElement>(`[data-submenu-panel="${id}"]`);
}
async function open(id: string, edge?: 'first' | 'last') {
  syncLayout();
  clearTimers();
  opened.value = id;
  await nextTick();
  if (opened.value !== id) return;
  const panel = panelElement(id);
  if (panel) {
    panel.style.marginLeft = '';
    if (!compact.value)
      panel.style.marginLeft = `${Math.min(0, innerWidth - 16 - panel.getBoundingClientRect().right)}px`;
    if (edge) {
      const links = panel.querySelectorAll<HTMLAnchorElement>('a');
      (edge === 'first' ? links[0] : links[links.length - 1])?.focus();
    }
  }
}
function toggle(id: string) {
  clearTimers();
  if (opened.value === id) opened.value = '';
  else void open(id);
}
function enter(event: PointerEvent, id: string) {
  if (compact.value || event.pointerType !== 'mouse' || !hoverMedia?.matches) return;
  if (opened.value !== id && panelElement(opened.value)?.contains(document.activeElement)) return;
  clearTimers();
  opening = setTimeout(() => void open(id), 120);
}
function leave(event: PointerEvent, id: string) {
  if (compact.value || event.pointerType !== 'mouse') return;
  clearTimers();
  const group = event.currentTarget as HTMLElement;
  closing = setTimeout(() => {
    if (
      opened.value === id &&
      !group.contains(document.activeElement) &&
      !document.querySelector('dialog[open]')
    )
      opened.value = '';
  }, 200);
}
function focusOut(event: FocusEvent, id: string) {
  if (document.querySelector('dialog[open]')) return;
  const group = event.currentTarget as HTMLElement;
  if (!group.contains(event.relatedTarget as Node | null) && opened.value === id) {
    clearTimers();
    opened.value = '';
  }
}
function outside(event: PointerEvent) {
  if (document.querySelector('dialog[open]')) return;
  if (
    !nav.value?.contains(event.target as Node) &&
    !menuButton.value?.contains(event.target as Node)
  )
    closeAll();
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (opened.value) {
    const button = toggleElement(opened.value);
    const restore =
      button === document.activeElement ||
      panelElement(opened.value)?.contains(document.activeElement);
    clearTimers();
    opened.value = '';
    if (restore) button?.focus();
  } else if (menuOpen.value) {
    menuOpen.value = false;
    menuButton.value?.focus();
  } else return;
  event.preventDefault();
  event.stopPropagation();
}
function syncLayout() {
  const next = innerWidth <= 1280;
  if (next !== compact.value) {
    compact.value = next;
    closeAll();
  }
}
function resized() {
  syncLayout();
  if (opened.value) void open(opened.value);
}
function toggleMenu() {
  syncLayout();
  if (menuOpen.value) closeAll();
  else menuOpen.value = true;
}
watch(() => route.fullPath, closeAll);
watch(() => `${store.signedIn}:${store.actorId}:${store.actor.roles.join(',')}`, closeAll);
onMounted(() => {
  compact.value = innerWidth <= 1280;
  removeNavigationHook = router.afterEach((_to, _from, failure) => {
    if (!failure || isNavigationFailure(failure, NavigationFailureType.duplicated)) closeAll();
  });
  hoverMedia = matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', resized);
});
onBeforeUnmount(() => {
  removeNavigationHook?.();
  clearTimers();
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('keydown', escape);
  window.removeEventListener('resize', resized);
});
</script>
<template>
  <button
    ref="menuButton"
    class="icon-button mobile-menu"
    aria-controls="primary-navigation"
    :aria-expanded="menuOpen"
    aria-label="메뉴"
    @click="toggleMenu"
  >
    <AppIcon name="menu" />
  </button>
  <nav
    ref="nav"
    id="primary-navigation"
    class="primary-nav"
    :class="{ expanded: menuOpen }"
    aria-label="주 메뉴"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="header-nav-item"
      @pointerenter="item.groups && enter($event, item.id)"
      @pointerleave="leave($event, item.id)"
      @focusout="focusOut($event, item.id)"
    >
      <div class="header-nav-heading">
        <RouterLink
          :to="item.to"
          class="header-nav-link"
          :class="{ active: section === item.id }"
          :aria-current="section === item.id ? 'page' : undefined"
          >{{ item.label
          }}<span v-if="item.id === 'notifications' && unread" class="notification-count">{{
            unread
          }}</span></RouterLink
        >
        <button
          v-if="item.groups"
          class="header-submenu-toggle"
          :data-submenu-toggle="item.id"
          :aria-label="`${item.label} 하위 메뉴 ${opened === item.id ? '접기' : '펼치기'}`"
          :aria-expanded="opened === item.id"
          :aria-controls="`header-submenu-${item.id}`"
          @click="toggle(item.id)"
          @keydown.down.prevent="open(item.id, 'first')"
          @keydown.up.prevent="open(item.id, 'last')"
        >
          <AppIcon name="chevron" :size="14" />
        </button>
      </div>
      <nav
        v-if="item.groups && opened === item.id"
        :id="`header-submenu-${item.id}`"
        class="header-submenu"
        :data-submenu-panel="item.id"
        :aria-label="`${item.label} 바로가기`"
      >
        <section
          v-for="group in item.groups"
          :key="group.id"
          class="header-submenu-group"
          :aria-labelledby="group.title ? `header-group-${group.id}` : undefined"
        >
          <h2 v-if="group.title" :id="`header-group-${group.id}`">{{ group.title }}</h2>
          <ul>
            <li v-for="link in group.links" :key="link.key">
              <RouterLink
                :to="link.to"
                class="header-submenu-link"
                :class="{ current: link.current }"
                :aria-current="link.current ? 'page' : undefined"
                >{{ link.label }}</RouterLink
              >
            </li>
          </ul>
        </section>
      </nav>
    </div>
  </nav>
</template>
<style scoped>
.header-nav-item {
  position: relative;
  min-width: 0;
}
.header-nav-heading {
  display: flex;
  align-items: center;
}
.primary-nav .header-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.primary-nav .header-nav-item:has(.header-submenu-toggle) .header-nav-link {
  padding-right: 4px;
}
.header-submenu-toggle {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 28px;
  min-height: 40px;
  padding: 0 4px;
  background: transparent;
  border: 0;
  color: var(--ink-secondary);
}
.header-submenu-toggle svg {
  transform: rotate(90deg);
}
.header-submenu-toggle[aria-expanded='true'] svg {
  transform: rotate(-90deg);
}
.header-submenu-toggle:hover {
  background: var(--tint);
  color: var(--primary-press);
}
.header-submenu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 35;
  width: 280px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 72px);
  padding: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--surface);
  border: 1px solid var(--line);
}
.header-submenu-group + .header-submenu-group {
  border-top: 1px solid var(--line);
  margin-top: 8px;
  padding-top: 8px;
}
.header-submenu-group h2 {
  margin: 0;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-secondary);
}
.header-submenu ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.primary-nav .header-submenu-link {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 8px 12px;
  color: var(--ink-secondary);
  font-size: 14px;
  font-weight: 400;
  white-space: normal;
  overflow-wrap: anywhere;
  border: 0;
  border-left: 2px solid transparent;
  background: var(--surface);
  text-align: left;
}
.primary-nav .header-submenu-link:hover,
.primary-nav .header-submenu-link.current {
  color: var(--primary-press);
  background: var(--tint);
}
.primary-nav .header-submenu-link.current {
  border-left-color: var(--primary-press);
  font-weight: 500;
}
.primary-nav a:focus-visible,
.header-submenu-toggle:focus-visible {
  outline: 2px solid var(--primary-press);
  outline-offset: -2px;
}
@media (max-width: 1280px) {
  .primary-nav.expanded {
    max-height: calc(100dvh - 72px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .header-nav-item {
    width: 100%;
    flex-shrink: 0;
  }
  .header-nav-heading > .header-nav-link {
    flex: 1;
    min-height: 44px;
  }
  .header-submenu-toggle {
    min-width: 44px;
    min-height: 44px;
  }
  .header-submenu {
    position: static;
    width: auto;
    max-width: none;
    max-height: none;
    margin-left: 0 !important;
    margin-bottom: 4px;
    padding: 4px 0 4px 12px;
    border: 0;
    border-left: 1px solid var(--line);
    overflow: visible;
  }
  .primary-nav .header-submenu-link {
    min-height: 44px;
  }
}
</style>

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource-variable/inter/wght.css';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import './style.css';
import './workplace.css';
import './theme.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(createPinia()).use(router).mount('#app');

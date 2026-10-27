import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import './design-tokens.css';
import './base.css';
import './style.css';
import './home-hero.css';
import './course-editor.css';
import './policies.css';
import './process-guide.css';
import './qualification-detail.css';
import './lifecycle.css';
import './certificate.css';
import './assessment-flow.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(createPinia()).use(router).mount('#app');

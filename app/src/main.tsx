import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PRODUCT } from './product';
import './styles.css';
import '@fontsource/zen-kaku-gothic-new/400.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';

const root = document.getElementById('root');
document.title = PRODUCT.name;
if (!root) throw new Error('起動先が見つかりません。');
createRoot(root).render(<App />);

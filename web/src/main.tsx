import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type BundledSample } from './App';
import moderateStudy from './samples/moderate-study.generated.json?raw';
import constantStudy from './samples/constant.study.json?raw';
import weightedStudy from './samples/weighted.study.json?raw';
import tiedStudy from './samples/tied.study.json?raw';

const samples: readonly BundledSample[] = Object.freeze([
  Object.freeze({
    id: 'sdk-synthetic-64x8-k5',
    labels: Object.freeze({
      'pt-BR': 'Exemplo sintético · 64 registros',
      en: 'Synthetic example · 64 records'
    }),
    json: moderateStudy
  }),
  Object.freeze({ id: 'sdk-constant', labels: Object.freeze({ 'pt-BR': 'Entrada constante', en: 'Constant input' }), json: constantStudy }),
  Object.freeze({ id: 'sdk-weighted', labels: Object.freeze({ 'pt-BR': 'Escalas distintas', en: 'Different scales' }), json: weightedStudy }),
  Object.freeze({ id: 'sdk-tied', labels: Object.freeze({ 'pt-BR': 'Empate espectral', en: 'Tied spectrum' }), json: tiedStudy })
]);

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App samples={samples} />
  </StrictMode>
);

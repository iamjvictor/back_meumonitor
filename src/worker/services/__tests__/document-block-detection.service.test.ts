import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleStructuralBlocks } from '../document-block-detection.service.js';

test('separa questões consecutivas marcadas com travessão em blocos independentes', async () => {
  const blocks = assembleStructuralBlocks('document-1', 'text-1', [{
    pageNumber: 1,
    rawContent: '',
    normalizedContent: [
      'Questão 1 – (Enem) Qual é a velocidade final do veículo?',
      'a) 10 m/s',
      'b) 20 m/s',
      'c) 30 m/s',
      'd) 40 m/s',
      'e) 50 m/s',
      'Questão 2 – (FEI-SP) Como a distância varia no movimento uniformemente variado?',
      'a) Com o tempo',
      'b) Com o quadrado do tempo',
      'c) Com a massa',
      'd) Com a força',
      'e) Com a velocidade',
      'Questão 3 – (FUVEST) Qual grandeza mede a mudança da velocidade por unidade de tempo?',
      'a) Massa',
      'b) Força',
      'c) Aceleração',
      'd) Energia',
      'e) Potência',
    ].join('\n'),
  }]);

  assert.deepEqual(
    blocks.filter((block) => block.type === 'QUESTION').map((block) => block.questionNumber),
    ['1', '2', '3'],
  );
});

test('reconhece uma seção de gabarito com título descritivo', async () => {
  const { assembleStructuralBlocks } = await import('../document-block-detection.service.js');
  const blocks = assembleStructuralBlocks('document-2', 'text-2', [{
    pageNumber: 1,
    rawContent: '',
    normalizedContent: [
      'Questão 1 – (Enem) Qual é a velocidade final?',
      'a) 10 m/s',
      'b) 20 m/s',
      'c) 30 m/s',
      'd) 40 m/s',
      'e) 50 m/s',
      'Gabarito dos Exercícios sobre',
      'movimento uniformemente variado',
      'Exercício resolvido da questão 1 –',
      'Alternativa correta: letra e) 50 m/s',
    ].join('\n'),
  }]);

  assert.equal(blocks.filter((block) => block.type === 'ANSWER_KEY').length, 1);
  assert.match(blocks.find((block) => block.type === 'ANSWER_KEY')?.normalizedContent ?? '', /^Gabarito dos Exercícios sobre/m);
});

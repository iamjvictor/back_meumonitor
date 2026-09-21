import assert from 'node:assert/strict';
import test from 'node:test';
import { distributeWeeklySimulationQuestions } from '../weekly-simulation-distribution.service.js';

const question = (id: string, topicId: string) => ({ id, subjectId: 's1', topicId, text: id });

test('reserva uma questão por tópico e distribui vagas restantes pela dificuldade', () => {
  const result = distributeWeeklySimulationQuestions({
    targetCount: 6,
    topics: [
      { monitorId: 'm1', subjectId: 's1', topicId: 'weak', difficultyScore: 0.9, questions: ['w1', 'w2', 'w3', 'w4'].map((id) => question(id, 'weak')) },
      { monitorId: 'm1', subjectId: 's1', topicId: 'medium', difficultyScore: 0.5, questions: ['m1', 'm2', 'm3'].map((id) => question(id, 'medium')) },
      { monitorId: 'm1', subjectId: 's1', topicId: 'strong', difficultyScore: 0.1, questions: ['s1', 's2'].map((id) => question(id, 'strong')) },
    ],
    history: new Map(),
    random: () => 0.999,
  });

  assert.equal(result.length, 6);
  assert.equal(result.filter((item) => item.topicId === 'weak').length, 3);
  assert.equal(result.filter((item) => item.topicId === 'medium').length, 2);
  assert.equal(result.filter((item) => item.topicId === 'strong').length, 1);
});

test('redistribui vagas quando um tópico esgota seu estoque e nunca repete questão', () => {
  const result = distributeWeeklySimulationQuestions({
    targetCount: 5,
    topics: [
      { monitorId: 'm1', subjectId: 's1', topicId: 'weak', difficultyScore: 1, questions: ['w1'].map((id) => question(id, 'weak')) },
      { monitorId: 'm1', subjectId: 's1', topicId: 'other', difficultyScore: 0.2, questions: ['o1', 'o2', 'o3', 'o4'].map((id) => question(id, 'other')) },
    ],
    history: new Map(),
    random: () => 0,
  });

  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((item) => item.id)).size, 5);
  assert.equal(result.filter((item) => item.topicId === 'weak').length, 1);
});

test('usa todas as questões quando o monitor tem menos de 30 disponíveis', () => {
  const result = distributeWeeklySimulationQuestions({
    targetCount: 30,
    topics: [{ monitorId: 'm1', subjectId: 's1', topicId: 't1', difficultyScore: 1, questions: ['q1', 'q2'].map((id) => question(id, 't1')) }],
    history: new Map(),
    random: () => 0,
  });

  assert.deepEqual(result.map((item) => item.id).sort(), ['q1', 'q2']);
});

test('prioriza inéditas, depois erradas e por fim acertadas', () => {
  const history = new Map([
    ['answered-wrong', false],
    ['answered-right', true],
  ]);
  const result = distributeWeeklySimulationQuestions({
    targetCount: 3,
    topics: [{
      monitorId: 'm1', subjectId: 's1', topicId: 't1', difficultyScore: 0.5,
      questions: ['answered-right', 'answered-wrong', 'new'].map((id) => question(id, 't1')),
    }],
    history,
    random: () => 0.999,
  });

  assert.deepEqual(result.map((item) => item.id), ['new', 'answered-wrong', 'answered-right']);
});

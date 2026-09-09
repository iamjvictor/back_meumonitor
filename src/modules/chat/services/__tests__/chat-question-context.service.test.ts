import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isChatQuestionAttemptAuthorized,
  resolveChatSelectedOption,
} from '../chat-question-context.service.js';

const attempt = {
  studentId: 'student-1',
  questionId: 'question-1',
  monitorId: 'monitor-1',
  selectedAnswer: 'B',
};

test('autoriza tentativa somente no mesmo aluno, questão e monitor', () => {
  assert.equal(isChatQuestionAttemptAuthorized({ attempt, ...attempt }), true);
  assert.equal(isChatQuestionAttemptAuthorized({ attempt, ...attempt, studentId: 'student-2' }), false);
  assert.equal(isChatQuestionAttemptAuthorized({ attempt, ...attempt, questionId: 'question-2' }), false);
  assert.equal(isChatQuestionAttemptAuthorized({ attempt, ...attempt, monitorId: 'monitor-2' }), false);
  assert.equal(isChatQuestionAttemptAuthorized({ attempt: null, ...attempt }), false);
});

test('usa alternativa da tentativa oficial antes do valor enviado pelo frontend', () => {
  assert.equal(resolveChatSelectedOption({ attempt, requestedOption: 'A' }), 'B');
  assert.equal(resolveChatSelectedOption({ attempt: null, requestedOption: 'A' }), 'A');
  assert.equal(resolveChatSelectedOption({ attempt: null }), null);
});

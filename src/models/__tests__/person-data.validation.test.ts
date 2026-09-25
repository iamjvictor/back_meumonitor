import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentAccountBodySchema } from '../../modules/payments/http/payment-account.controller.js';
import { signupSchema } from '../auth.model.js';
import { registerTeacherSchema } from '../teacher-registration.model.js';
import { studentProfileBodySchema } from '../../modules/student-profile/student-profile.routes.js';

const validCpf = '096.482.779-40';
const validCnpj = '11.222.333/0001-81';

const paymentBase = {
  name: 'João Victor',
  email: 'teste@example.com',
  cpfCnpj: validCpf,
  birthDate: '2002-02-25',
  mobilePhone: '(65) 47885-2855',
  incomeValue: 10000,
  address: 'Rua Jacinto',
  addressNumber: '123',
  province: 'Caxito',
  postalCode: '24912-710',
};

test('accepts a masked CPF and keeps the Asaas input shape', () => {
  const result = paymentAccountBodySchema.safeParse(paymentBase);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.cpfCnpj, validCpf);
    assert.equal(result.data.postalCode, '24912-710');
    assert.equal(result.data.mobilePhone, '(65) 47885-2855');
  }
});

test('rejects an invalid CPF instead of only checking its length', () => {
  const result = paymentAccountBodySchema.safeParse({ ...paymentBase, cpfCnpj: '111.111.111-11' });
  assert.equal(result.success, false);
});

test('rejects invalid CEP and phone digit counts', () => {
  assert.equal(paymentAccountBodySchema.safeParse({ ...paymentBase, postalCode: '1234-567' }).success, false);
  assert.equal(paymentAccountBodySchema.safeParse({ ...paymentBase, mobilePhone: '(65) 478-2855' }).success, false);
});

test('requires company type for CNPJ and does not accept birth date for CNPJ', () => {
  assert.equal(paymentAccountBodySchema.safeParse({ ...paymentBase, cpfCnpj: validCnpj, birthDate: undefined }).success, false);
  assert.equal(paymentAccountBodySchema.safeParse({ ...paymentBase, cpfCnpj: validCnpj, birthDate: undefined, companyType: 'LIMITED' }).success, true);
  assert.equal(paymentAccountBodySchema.safeParse({ ...paymentBase, cpfCnpj: validCnpj, companyType: 'LIMITED' }).success, false);
});

test('validates CPF in the initial signup payload when supplied', () => {
  const base = { email: 'student@example.com', password: 'Senha123!', name: 'Aluno', role: 'student' as const };
  assert.equal(signupSchema.safeParse({ ...base, cpf: validCpf }).success, true);
  assert.equal(signupSchema.safeParse({ ...base, cpf: '11111111111' }).success, false);
});

test('validates teacher and student profile phone and CPF fields', () => {
  assert.equal(registerTeacherSchema.safeParse({
    fullName: 'Professor', email: 'teacher@example.com', password: 'Senha123!', phone: '(65) 47885-2855',
    username: 'professor', area: 'Matemática', pageSlug: 'professor', agreedTerms: true,
  }).success, true);
  assert.equal(registerTeacherSchema.safeParse({
    fullName: 'Professor', email: 'teacher@example.com', password: 'Senha123!', phone: '123',
    username: 'professor', area: 'Matemática', pageSlug: 'professor', agreedTerms: true,
  }).success, false);
  assert.equal(studentProfileBodySchema.safeParse({ fullName: 'Aluno', phone: '(65) 47885-2855', cpf: validCpf }).success, true);
  assert.equal(studentProfileBodySchema.safeParse({ cpf: '111.111.111-11' }).success, false);
});

test('accepts the existing international +55 phone format used by student signup', () => {
  assert.equal(signupSchema.safeParse({
    email: 'student2@example.com', password: 'Senha123!', name: 'Aluno', role: 'student', whatsapp: '+55 (65) 47885-2855',
  }).success, true);
});

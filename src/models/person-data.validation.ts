export function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

export function isValidCpf(value: string) {
  const digits = digitsOnly(value);
  if (!/^\d{11}$/.test(digits) || /^([0-9])\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(digits[index]) * (10 - index);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== Number(digits[9])) return false;
  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(digits[index]) * (11 - index);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === Number(digits[10]);
}

export function isValidCnpj(value: string) {
  const digits = digitsOnly(value);
  if (!/^\d{14}$/.test(digits) || /^([0-9])\1{13}$/.test(digits)) return false;
  const calculate = (length: number) => {
    let sum = 0;
    let weight = length === 12 ? 5 : 6;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

export function isValidDocument(value: string, type?: 'CPF' | 'CNPJ') {
  const digits = digitsOnly(value);
  if (type === 'CPF') return isValidCpf(digits);
  if (type === 'CNPJ') return isValidCnpj(digits);
  return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 ? isValidCnpj(digits) : false;
}

export function isValidBrazilianPhone(value: string) {
  const digits = digitsOnly(value);
  return /^(?:55)?[1-9]{2}\d{8,9}$/.test(digits);
}

export function isValidPostalCode(value: string) {
  return /^\d{5}-?\d{3}$/.test(value.trim());
}

export function isValidMoney(value: number) {
  return Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

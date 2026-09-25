export type AsaasEnvironment = 'sandbox' | 'production';

export function getAsaasBaseUrl(environment: AsaasEnvironment): string {
  return environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

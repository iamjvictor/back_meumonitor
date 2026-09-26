export type AsaasEnvironment = 'sandbox' | 'production';

export type AsaasApiKeys = {
  sandbox?: string;
  production?: string;
};

export function selectAsaasApiKey(environment: AsaasEnvironment, keys: AsaasApiKeys): string | undefined {
  return environment === 'sandbox' ? keys.sandbox : keys.production;
}

export function getAsaasBaseUrl(environment: AsaasEnvironment): string {
  return environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

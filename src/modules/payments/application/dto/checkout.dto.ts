import type { HostedCheckoutCommand, HostedCheckoutResult } from '../../domain/ports/payment-provider.port.js';

export type CreateHostedCheckoutInput = HostedCheckoutCommand;
export type CreateHostedCheckoutOutput = HostedCheckoutResult;

import * as accountRepo from '../infra/db/repo/account';
import { publishAlert } from '../infra/bus';
import { log } from '../infra/logger';
import { getNumber, KEYS } from '../config/runtime';
import { CIRCUIT_BREAK_FAILURES } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { Account } from '@shared/types';

/**
 * 熔断 —— §8.2：连续 ★3 次失败即停工；熔断不允许自动恢复，必须由人点「恢复」
 */
export function threshold(): number {
  const v = getNumber(KEYS.circuitBreakFailures);
  return v > 0 ? v : CIRCUIT_BREAK_FAILURES;
}

export function isOpen(account: Account): boolean {
  return account.circuit === 'open';
}

export function assertClosed(account: Account): void {
  if (isOpen(account)) {
    throw new AppError(
      'CIRCUIT_OPEN',
      `账号已熔断（连续失败 ${account.consecutiveFailures} 次）`,
      '必须由人在控制台点「恢复」，熔断不会自动恢复',
    );
  }
}

export function recordFailure(account: Account): { opened: boolean; count: number } {
  const count = account.consecutiveFailures + 1;
  accountRepo.setConsecutiveFailures(account.id, count);
  if (count >= threshold()) {
    accountRepo.setCircuit(account.id, 'open');
    log('error', `CIRCUIT_OPEN: 连续失败 ${count} 次，账号已停工`, { account: account.name });
    publishAlert('error', 'CIRCUIT_OPEN', `连续失败 ${count} 次，已停工，需人工恢复`);
    return { opened: true, count };
  }
  return { opened: false, count };
}

export function recordSuccess(account: Account): void {
  if (account.consecutiveFailures > 0) accountRepo.setConsecutiveFailures(account.id, 0);
}

export function resume(account: Account): void {
  accountRepo.setCircuit(account.id, 'closed');
  accountRepo.setConsecutiveFailures(account.id, 0);
  log('info', 'circuit resumed by operator', { account: account.name });
}

import { Response } from 'express';

export interface FormattedFirestoreError {
  error: string;
  code: string;
  message: string;
  httpStatus: number;
  details?: any;
}

export function parseFirestoreError(err: any): FormattedFirestoreError {
  if (!err) {
    return {
      error: 'INTERNAL_ERROR',
      code: 'UNKNOWN',
      message: 'An unknown error occurred.',
      httpStatus: 500,
    };
  }

  const rawCode = err.code ?? (err.status ?? '');
  const rawMsg = err.message || String(err);
  const strCode = String(rawCode).toUpperCase();

  // Check gRPC numeric codes or string names
  // 8 = RESOURCE_EXHAUSTED
  if (
    rawCode === 8 ||
    strCode === '8' ||
    strCode.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('Quota exceeded') ||
    rawMsg.includes('quota')
  ) {
    return {
      error: 'RESOURCE_EXHAUSTED',
      code: 'RESOURCE_EXHAUSTED',
      message: 'Firestore quota exceeded. Read operations are temporarily unavailable.',
      httpStatus: 429,
      details: err.details || rawMsg,
    };
  }

  // 7 = PERMISSION_DENIED
  if (
    rawCode === 7 ||
    strCode === '7' ||
    strCode.includes('PERMISSION_DENIED') ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('Missing or insufficient permissions')
  ) {
    return {
      error: 'PERMISSION_DENIED',
      code: 'PERMISSION_DENIED',
      message: 'Permission denied accessing Firestore database.',
      httpStatus: 403,
      details: err.details || rawMsg,
    };
  }

  // 14 = UNAVAILABLE
  if (
    rawCode === 14 ||
    strCode === '14' ||
    strCode.includes('UNAVAILABLE') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('Service Unavailable')
  ) {
    return {
      error: 'UNAVAILABLE',
      code: 'UNAVAILABLE',
      message: 'Firestore service is temporarily unavailable. Please retry shortly.',
      httpStatus: 503,
      details: err.details || rawMsg,
    };
  }

  // 4 = DEADLINE_EXCEEDED
  if (
    rawCode === 4 ||
    strCode === '4' ||
    strCode.includes('DEADLINE_EXCEEDED') ||
    rawMsg.includes('DEADLINE_EXCEEDED') ||
    rawMsg.includes('deadline') ||
    rawMsg.includes('timed out')
  ) {
    return {
      error: 'DEADLINE_EXCEEDED',
      code: 'DEADLINE_EXCEEDED',
      message: 'Firestore request timed out. Please try again.',
      httpStatus: 504,
      details: err.details || rawMsg,
    };
  }

  // 5 = NOT_FOUND
  if (
    rawCode === 5 ||
    strCode === '5' ||
    strCode.includes('NOT_FOUND') ||
    rawMsg.includes('NOT_FOUND') ||
    rawMsg.includes('No document to update')
  ) {
    return {
      error: 'NOT_FOUND',
      code: 'NOT_FOUND',
      message: 'The requested Firestore document was not found.',
      httpStatus: 404,
      details: err.details || rawMsg,
    };
  }

  // 6 = ALREADY_EXISTS
  if (
    rawCode === 6 ||
    strCode === '6' ||
    strCode.includes('ALREADY_EXISTS') ||
    rawMsg.includes('ALREADY_EXISTS')
  ) {
    return {
      error: 'ALREADY_EXISTS',
      code: 'ALREADY_EXISTS',
      message: 'The Firestore document or resource already exists.',
      httpStatus: 409,
      details: err.details || rawMsg,
    };
  }

  // 9 = FAILED_PRECONDITION
  if (
    rawCode === 9 ||
    strCode === '9' ||
    strCode.includes('FAILED_PRECONDITION') ||
    rawMsg.includes('FAILED_PRECONDITION') ||
    rawMsg.includes('index')
  ) {
    return {
      error: 'FAILED_PRECONDITION',
      code: 'FAILED_PRECONDITION',
      message: 'Firestore query requires an index or condition not met.',
      httpStatus: 400,
      details: err.details || rawMsg,
    };
  }

  return {
    error: 'INTERNAL_FIRESTORE_ERROR',
    code: strCode || 'INTERNAL_ERROR',
    message: rawMsg || 'Internal Firestore operation error.',
    httpStatus: 500,
    details: err.details,
  };
}

export function handleFirestoreError(res: Response, err: any, context = 'Firestore operation'): void {
  const parsed = parseFirestoreError(err);
  console.error(`[FIRESTORE ERROR] [${context}] code=${parsed.code} status=${parsed.httpStatus} message="${parsed.message}" raw="${err?.message || err}"`);
  res.status(parsed.httpStatus).json(parsed);
}

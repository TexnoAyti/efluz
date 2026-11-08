// Deliberately disabled for production. Enable only after staging parity,
// access-control review, and explicit operator-controlled deployment.
// Confirmation additionally requires independent verification that the SDK
// provides a single atomic, rollback-capable transaction covering fixtures,
// audit, inbox and outbox. The existence of a method named "transaction"
// alone is insufficient to establish those semantics.
export const MUTATION_CONTROL=Object.freeze({
  enabled:false,
  resultConfirmationTransactionsVerified:false,
});

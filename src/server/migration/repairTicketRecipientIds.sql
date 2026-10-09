-- Relink legacy Telegram-ID ticket accounts only when the canonical user is
-- verified and has no ticket account. Preserve all balances and audit IDs.
BEGIN;
SELECT generation FROM efl_runtime.spaces WHERE name='production' FOR UPDATE;
WITH mapping AS MATERIALIZED (
 SELECT t.document_id AS old_id,u.document_id AS canonical_id
 FROM efl_runtime.documents t
 JOIN efl_runtime.documents u ON u.space=t.space AND u.collection_path='users'
  AND u.document_id='user-'||t.document_id AND u.data->>'telegramId'=t.document_id
 WHERE t.space='production' AND t.collection_path='user_tickets'
  AND t.document_id~'^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM efl_runtime.documents c WHERE c.space=t.space
   AND c.collection_path='user_tickets' AND c.document_id=u.document_id)
), moved AS (
 UPDATE efl_runtime.documents t SET document_id=m.canonical_id,
  data=jsonb_set(t.data,'{userId}',to_jsonb(m.canonical_id)),
  encoded=jsonb_set(t.encoded,'{value,userId}',jsonb_build_object('type','string','value',m.canonical_id))
 FROM mapping m WHERE t.space='production' AND t.collection_path='user_tickets' AND t.document_id=m.old_id
 RETURNING m.old_id,m.canonical_id
), audits AS (
 UPDATE efl_runtime.documents t SET data=jsonb_set(t.data,'{userId}',to_jsonb(m.canonical_id)),
  encoded=jsonb_set(t.encoded,'{value,userId}',jsonb_build_object('type','string','value',m.canonical_id))
 FROM moved m WHERE t.space='production' AND t.collection_path='ticket_transactions' AND t.data->>'userId'=m.old_id
 RETURNING 1
)
SELECT (SELECT count(*) FROM moved) AS repaired_accounts,(SELECT count(*) FROM audits) AS repaired_audits;
UPDATE efl_runtime.spaces SET generation=generation+1 WHERE name='production';
COMMIT;

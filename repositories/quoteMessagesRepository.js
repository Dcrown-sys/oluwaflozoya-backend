// repositories/quoteMessagesRepository.js
const { sql } = require('../db');

// ── Insert a new message ──
const insert = async (tx, {
  quote_request_id,
  sender_id,
  sender_type,
  message_type,
  body,
  offer_data,
  attachment_url,
  attachment_type,
}) => {
  const [row] = await tx`
    INSERT INTO quote_messages (
      quote_request_id, sender_id, sender_type,
      message_type, body, offer_data,
      attachment_url, attachment_type
    ) VALUES (
      ${quote_request_id},
      ${sender_id       ?? null},
      ${sender_type},
      ${message_type    ?? 'text'},
      ${body},
      ${offer_data      ? JSON.stringify(offer_data) : null},
      ${attachment_url  ?? null},
      ${attachment_type ?? null}
    )
    RETURNING *;
  `;
  return row;
};

// ── List messages for a thread (oldest first, paginated) ──
const listByRequest = async (requestId, { page = 1, limit = 50 } = {}) => {
  const offset = (page - 1) * limit;
  return sql`
    SELECT
      qm.*,
      u.full_name AS sender_name,
      u.image     AS sender_avatar
    FROM quote_messages qm
    LEFT JOIN users u ON u.id = qm.sender_id
    WHERE qm.quote_request_id = ${requestId}
    ORDER BY qm.created_at ASC
    LIMIT ${limit} OFFSET ${offset};
  `;
};

// ── Mark all messages in a thread as read for a given role ──
const markReadForBuyer = async (requestId) => {
  await sql`
    UPDATE quote_messages
    SET read_by_buyer = TRUE
    WHERE quote_request_id = ${requestId}
      AND read_by_buyer = FALSE
      AND sender_type IN ('admin','system');
  `;
  await sql`
    UPDATE quote_requests
    SET buyer_unread_count = 0
    WHERE id = ${requestId};
  `;
};

const markReadForAdmin = async (requestId) => {
  await sql`
    UPDATE quote_messages
    SET read_by_admin = TRUE
    WHERE quote_request_id = ${requestId}
      AND read_by_admin = FALSE
      AND sender_type = 'buyer';
  `;
  await sql`
    UPDATE quote_requests
    SET admin_unread_count = 0
    WHERE id = ${requestId};
  `;
};

module.exports = { insert, listByRequest, markReadForBuyer, markReadForAdmin };
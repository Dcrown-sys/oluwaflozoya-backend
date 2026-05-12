// repositories/quoteRequestsRepository.js
const { sql } = require('../db');

const insertHeader = async (tx, { buyer_id, project_id, delivery_zone, delivery_address, title, needed_by }) => {
  const [row] = await tx`
    INSERT INTO quote_requests (
      buyer_id, project_id, delivery_zone, delivery_address, title, needed_by
    ) VALUES (
      ${buyer_id}, ${project_id ?? null}, ${delivery_zone ?? null},
      ${delivery_address ?? null}, ${title ?? null}, ${needed_by ?? null}
    )
    RETURNING *;
  `;
  return row;
};

const insertItems = async (tx, requestId, items) => {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await tx`
      INSERT INTO quote_request_items (
        quote_request_id, product_id, category_id, product_name_text,
        specifications, qty, unit, notes, position
      ) VALUES (
        ${requestId}, ${item.product_id ?? null}, ${item.category_id ?? null},
        ${item.product_name_text ?? null}, ${item.specifications ?? null},
        ${item.qty}, ${item.unit}, ${item.notes ?? null}, ${i}
      );
    `;
  }
};

const insertSystemMessage = async (tx, requestId, body) => {
  await tx`
    INSERT INTO quote_messages (quote_request_id, sender_type, message_type, body)
    VALUES (${requestId}, 'system', 'system_event', ${body});
  `;
};

const insertBuyerMessage = async (tx, requestId, buyerId, body) => {
  await tx`
    INSERT INTO quote_messages (quote_request_id, sender_id, sender_type, message_type, body)
    VALUES (${requestId}, ${buyerId}, 'buyer', 'text', ${body});
  `;
};

const findByIdWithItems = async (id) => {
  const [request] = await sql`
    SELECT qr.*, u.full_name AS buyer_name
    FROM quote_requests qr
    JOIN users u ON u.id = qr.buyer_id
    WHERE qr.id = ${id};
  `;
  if (!request) return null;

  const items = await sql`
    SELECT qri.*, p.name AS product_name, p.image_url AS product_image,
           c.name AS category_name
    FROM quote_request_items qri
    LEFT JOIN products   p ON p.id = qri.product_id
    LEFT JOIN categories c ON c.id = qri.category_id
    WHERE qri.quote_request_id = ${id}
    ORDER BY qri.position;
  `;
  return { ...request, items };
};

const listForBuyer = async (buyerId, { status, page, limit }) => {
  const offset = (page - 1) * limit;
  return sql`
    SELECT qr.id, qr.title, qr.status, qr.last_message_at,
           qr.buyer_unread_count, qr.created_at,
           (SELECT COUNT(*) FROM quote_request_items WHERE quote_request_id = qr.id)::int AS item_count
    FROM quote_requests qr
    WHERE qr.buyer_id = ${buyerId}
      ${status ? sql`AND qr.status = ${status}` : sql``}
    ORDER BY qr.last_message_at DESC
    LIMIT ${limit} OFFSET ${offset};
  `;
};

const listForAdmin = async ({ status, page, limit }) => {
  const offset = (page - 1) * limit;
  return sql`
    SELECT qr.id, qr.title, qr.status, qr.last_message_at,
           qr.admin_unread_count, qr.created_at,
           u.full_name AS buyer_name,
           (SELECT COUNT(*) FROM quote_request_items WHERE quote_request_id = qr.id)::int AS item_count
    FROM quote_requests qr
    JOIN users u ON u.id = qr.buyer_id
    WHERE 1=1
      ${status ? sql`AND qr.status = ${status}` : sql`AND qr.status NOT IN ('closed','expired')`}
    ORDER BY qr.last_message_at DESC
    LIMIT ${limit} OFFSET ${offset};
  `;
};

const unreadCountForBuyer = async (buyerId) => {
  const [row] = await sql`
    SELECT COALESCE(SUM(buyer_unread_count), 0)::int AS unread_count
    FROM quote_requests
    WHERE buyer_id = ${buyerId};
  `;
  return row.unread_count;
};

const update = async (id, { status, assigned_admin_id }) => {
  const [row] = await sql`
    UPDATE quote_requests
    SET status            = COALESCE(${status ?? null}, status),
        assigned_admin_id = COALESCE(${assigned_admin_id ?? null}, assigned_admin_id),
        closed_at         = CASE WHEN ${status ?? null} = 'closed' THEN now() ELSE closed_at END
    WHERE id = ${id}
    RETURNING *;
  `;
  return row;
};

module.exports = {
  insertHeader, insertItems, insertSystemMessage, insertBuyerMessage,
  findByIdWithItems, listForBuyer, listForAdmin, unreadCountForBuyer, update,
};
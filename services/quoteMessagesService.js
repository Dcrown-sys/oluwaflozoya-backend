// services/quoteMessagesService.js
const { sql }    = require('../db');
const { AppError } = require('../utils/AppError');
const qRepo      = require('../repositories/quoteRequestsRepository');
const mRepo      = require('../repositories/quoteMessagesRepository');

// ── Send a message on a quote thread ──
const send = async ({ viewer, requestId, payload }) => {
  // 1. Load the parent request — enforces ownership
  const request = await qRepo.findByIdWithItems(requestId);
  if (!request) throw new AppError('Quote request not found', 404);

  // 2. Only buyer (owner) or admin can message
  const isBuyer = viewer.role === 'buyer' && request.buyer_id === viewer.id;
  const isAdmin = viewer.role === 'admin';
  if (!isBuyer && !isAdmin) throw new AppError('Forbidden', 403);

  // 3. Can't message on closed/rejected threads
  if (['closed', 'rejected', 'expired'].includes(request.status)) {
    throw new AppError(`Cannot send messages on a ${request.status} quote request`, 400);
  }

  // 4. Insert message inside a transaction
  const message = await sql.begin(async (tx) => {
    return mRepo.insert(tx, {
      quote_request_id: requestId,
      sender_id:        viewer.id,
      sender_type:      isAdmin ? 'admin' : 'buyer',
      message_type:     payload.message_type ?? 'text',
      body:             payload.body,
      offer_data:       payload.offer_data       ?? null,
      attachment_url:   payload.attachment_url   ?? null,
      attachment_type:  payload.attachment_type  ?? null,
    });
  });

  // 5. If admin sends a quote_offer, update request status to 'quoted'
  if (isAdmin && payload.message_type === 'quote_offer') {
    await qRepo.update(requestId, { status: 'quoted' });
  }

  return message;
};

// ── List messages for a thread ──
const list = async ({ viewer, requestId, query }) => {
  const request = await qRepo.findByIdWithItems(requestId);
  if (!request) throw new AppError('Quote request not found', 404);

  const isBuyer = viewer.role === 'buyer' && request.buyer_id === viewer.id;
  const isAdmin = viewer.role === 'admin';
  if (!isBuyer && !isAdmin) throw new AppError('Forbidden', 403);

  const messages = await mRepo.listByRequest(requestId, {
    page:  parseInt(query?.page)  || 1,
    limit: parseInt(query?.limit) || 50,
  });

  return { request, messages };
};

// ── Mark thread as read ──
const markRead = async ({ viewer, requestId }) => {
  const request = await qRepo.findByIdWithItems(requestId);
  if (!request) throw new AppError('Quote request not found', 404);

  if (viewer.role === 'admin') {
    await mRepo.markReadForAdmin(requestId);
  } else if (viewer.role === 'buyer' && request.buyer_id === viewer.id) {
    await mRepo.markReadForBuyer(requestId);
  } else {
    throw new AppError('Forbidden', 403);
  }
};

module.exports = { send, list, markRead };
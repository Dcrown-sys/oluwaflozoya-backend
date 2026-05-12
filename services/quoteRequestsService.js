// services/quoteRequestsService.js
const { sql } = require('../db');
const { AppError } = require('../utils/AppError');
const repo = require('../repositories/quoteRequestsRepository');

const create = async ({ buyerId, payload }) => {
  return sql.begin(async (tx) => {
    const request = await repo.insertHeader(tx, { buyer_id: buyerId, ...payload });
    await repo.insertItems(tx, request.id, payload.items);
    await repo.insertSystemMessage(
      tx,
      request.id,
      `Quote request created with ${payload.items.length} item(s)`
    );
    if (payload.initial_message) {
      await repo.insertBuyerMessage(tx, request.id, buyerId, payload.initial_message);
    }
    return request;
  });
};

const listForViewer = async ({ viewer, query }) => {
  if (viewer.role === 'admin') return repo.listForAdmin(query);
  return repo.listForBuyer(viewer.id, query);
};

const getById = async ({ viewer, id }) => {
  const request = await repo.findByIdWithItems(id);
  if (!request) throw new AppError('Quote request not found', 404);

  // 🔒 Hard ownership check — buyer can only see their own thread
  if (viewer.role !== 'admin' && request.buyer_id !== viewer.id) {
    throw new AppError('Forbidden', 403);
  }
  return request;
};

const unreadCountForBuyer = async (buyerId) => repo.unreadCountForBuyer(buyerId);

const update = async ({ viewer, id, payload }) => {
  const request = await repo.findByIdWithItems(id);
  if (!request) throw new AppError('Quote request not found', 404);

  if (payload.assigned_admin_id && viewer.role !== 'admin') {
    throw new AppError('Admin only', 403);
  }
  if (payload.status === 'closed'
      && request.buyer_id !== viewer.id
      && viewer.role !== 'admin') {
    throw new AppError('Forbidden', 403);
  }
  return repo.update(id, payload);
};

module.exports = { create, listForViewer, getById, unreadCountForBuyer, update };
// controllers/quoteRequestsController.js
const service = require('../services/quoteRequestsService');

// Defensive: handle id, _id, or sub from JWT payload
const viewerFrom = (req) => ({
  id:   req.user.id || req.user._id || req.user.sub,
  role: req.user.role || 'buyer',
});

exports.create = async (req, res, next) => {
  try {
    const viewer = viewerFrom(req);
    const request = await service.create({ buyerId: viewer.id, payload: req.body });
    res.status(201).json({ success: true, data: request });
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    const query = {
      status: req.query.status || null,
      page:   parseInt(req.query.page)  || 1,
      limit:  parseInt(req.query.limit) || 20,
    };
    const items = await service.listForViewer({ viewer: viewerFrom(req), query });
    res.json({ success: true, items, page: query.page, limit: query.limit });
  } catch (err) { next(err); }
};

exports.getById = async (req, res, next) => {
  try {
    const request = await service.getById({ viewer: viewerFrom(req), id: req.params.id });
    res.json({ success: true, data: request });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const request = await service.update({
      viewer: viewerFrom(req), id: req.params.id, payload: req.body,
    });
    res.json({ success: true, data: request });
  } catch (err) { next(err); }
};

exports.unreadSummary = async (req, res, next) => {
  try {
    const viewer = viewerFrom(req);
    const unread_count = await service.unreadCountForBuyer(viewer.id);
    res.json({ success: true, unread_count });
  } catch (err) { next(err); }
};
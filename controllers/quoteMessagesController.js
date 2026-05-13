// controllers/quoteMessagesController.js
const service = require('../services/quoteMessagesService');

const viewerFrom = (req) => ({
  id:   req.user.id || req.user._id || req.user.sub,
  role: req.user.role || 'buyer',
});

// GET /api/v2/quotes/requests/:requestId/messages
exports.list = async (req, res, next) => {
  try {
    const { request, messages } = await service.list({
      viewer:    viewerFrom(req),
      requestId: req.params.requestId,
      query:     req.query,
    });
    res.json({
      success: true,
      request,
      messages,
      page:  parseInt(req.query.page)  || 1,
      limit: parseInt(req.query.limit) || 50,
    });
  } catch (err) { next(err); }
};

// POST /api/v2/quotes/requests/:requestId/messages
exports.send = async (req, res, next) => {
  try {
    const message = await service.send({
      viewer:    viewerFrom(req),
      requestId: req.params.requestId,
      payload:   req.body,
    });
    res.status(201).json({ success: true, data: message });
  } catch (err) { next(err); }
};

// POST /api/v2/quotes/requests/:requestId/messages/read
exports.markRead = async (req, res, next) => {
  try {
    await service.markRead({
      viewer:    viewerFrom(req),
      requestId: req.params.requestId,
    });
    res.json({ success: true, message: 'Thread marked as read' });
  } catch (err) { next(err); }
};
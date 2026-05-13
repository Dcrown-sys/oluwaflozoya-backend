// controllers/quoteMessagesController.js
const service = require('../services/quoteMessagesService');

let io = null;

// ── Called once from server.js after io is created ──
const setSocket = (socketIO) => {
  io = socketIO;
};

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
    const viewer  = viewerFrom(req);
    const message = await service.send({
      viewer,
      requestId: req.params.requestId,
      payload:   req.body,
    });

    // ✅ Emit to the quote room so all connected clients get it instantly
    if (io) {
      io.to(`quote_${req.params.requestId}`).emit('newMessage', {
        requestId: req.params.requestId,
        message,
      });
      console.log(`📨 Emitted newMessage to room quote_${req.params.requestId}`);
    }

    res.status(201).json({ success: true, data: message });
  } catch (err) { next(err); }
};

// POST /api/v2/quotes/requests/:requestId/messages/read
exports.markRead = async (req, res, next) => {
  try {
    const viewer = viewerFrom(req);
    await service.markRead({
      viewer,
      requestId: req.params.requestId,
    });

    // ✅ Notify the other party that messages were read
    if (io) {
      io.to(`quote_${req.params.requestId}`).emit('messagesRead', {
        requestId: req.params.requestId,
        readBy:    viewer.role,
      });
    }

    res.json({ success: true, message: 'Thread marked as read' });
  } catch (err) { next(err); }
};

exports.setSocket = setSocket;
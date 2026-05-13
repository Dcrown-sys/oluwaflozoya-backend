// validators/quoteMessagesValidators.js
const { z } = require('zod');

const sendMessageSchema = z.object({
  body:            z.string().min(1).max(5000),
  message_type:    z.enum(['text', 'quote_offer', 'attachment']).default('text'),
  // for quote_offer messages
  offer_data: z.object({
    items: z.array(z.object({
      quote_request_item_id: z.string().uuid(),
      unit_price:            z.number().positive(),
      qty:                   z.number().positive(),
      unit:                  z.string(),
      notes:                 z.string().max(500).optional(),
    })).min(1),
    valid_until:   z.coerce.date().optional(),
    delivery_days: z.number().int().positive().optional(),
    notes:         z.string().max(1000).optional(),
  }).optional(),
  // for attachment messages
  attachment_url:  z.string().url().optional(),
  attachment_type: z.string().max(50).optional(),
});

const markReadSchema = z.object({}).optional();

module.exports = { sendMessageSchema, markReadSchema };
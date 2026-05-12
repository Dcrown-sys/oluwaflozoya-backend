// validators/quoteRequestsValidators.js
const { z } = require('zod');

const itemSchema = z.object({
  product_id:        z.string().uuid().optional(),
  category_id:       z.coerce.number().int().positive().optional(),
  product_name_text: z.string().min(1).max(300).optional(),
  specifications:    z.string().max(500).optional(),
  qty:               z.number().positive(),
  unit:              z.enum(['bag','ton','m3','piece','bundle','truck']),
  notes:             z.string().max(500).optional(),
}).refine(d => d.product_id || d.product_name_text, {
  message: 'Either product_id or product_name_text is required',
  path: ['product_name_text'],
});

const createQuoteRequestSchema = z.object({
  title:            z.string().max(200).optional(),
  project_id:       z.string().uuid().optional(),
  delivery_zone:    z.string().max(100).optional(),
  delivery_address: z.string().max(500).optional(),
  needed_by:        z.coerce.date().optional(),
  items:            z.array(itemSchema).min(1).max(50),
  initial_message:  z.string().max(2000).optional(),
});

const listQuoteRequestsSchema = z.object({
  status: z.enum(['open','quoted','negotiating','accepted','rejected','expired','closed']).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});

const updateQuoteRequestSchema = z.object({
  status:            z.enum(['closed']).optional(),
  assigned_admin_id: z.string().uuid().optional(),
});

const suggestionsQuerySchema = z.object({
  q:     z.string().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

module.exports = {
  createQuoteRequestSchema,
  listQuoteRequestsSchema,
  updateQuoteRequestSchema,
  suggestionsQuerySchema,
};
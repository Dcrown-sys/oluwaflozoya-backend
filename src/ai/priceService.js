// controllers/priceService.js
const { sql } = require('../../db/index');

// ── Comprehensive Nigerian market fallback prices (2024/2025) ─
// These are used when a material is not found in the database.
// Updated to reflect current Lagos market rates.
const NIGERIAN_FALLBACK_PRICES = {
  // ── Concrete & Masonry ──────────────────────────────────────
  cement: {
    price: 8500, unit: 'bag (50kg)', category: 'concrete',
    producer: 'BUA/Dangote', note: 'Market rate — verify locally',
  },
  blocks_9inch: {
    price: 550, unit: 'piece', category: 'masonry',
    producer: 'Local', note: '9-inch sandcrete block',
  },
  blocks_6inch: {
    price: 400, unit: 'piece', category: 'masonry',
    producer: 'Local', note: '6-inch sandcrete block',
  },
  sharp_sand: {
    price: 80000, unit: 'tipper (5 tonnes)', category: 'concrete',
    producer: 'Local quarry', note: 'Sharp sand for concrete',
  },
  soft_sand: {
    price: 60000, unit: 'tipper (5 tonnes)', category: 'masonry',
    producer: 'Local quarry', note: 'Soft sand for plastering/mortar',
  },
  gravel: {
    price: 90000, unit: 'tipper (5 tonnes)', category: 'concrete',
    producer: 'Local quarry', note: '¾ inch granite aggregate',
  },
  granite_dust: {
    price: 55000, unit: 'tipper', category: 'concrete',
    producer: 'Local quarry', note: 'Granite dust for floor screeding',
  },

  // ── Steel & Reinforcement ───────────────────────────────────
  rebar_10mm: {
    price: 8500, unit: 'length (12m)', category: 'steel',
    producer: 'Delta/Jisco', note: 'Y10 reinforcement rod',
  },
  rebar_12mm: {
    price: 12000, unit: 'length (12m)', category: 'steel',
    producer: 'Delta/Jisco', note: 'Y12 reinforcement rod',
  },
  rebar_16mm: {
    price: 21000, unit: 'length (12m)', category: 'steel',
    producer: 'Delta/Jisco', note: 'Y16 reinforcement rod',
  },
  rebar_20mm: {
    price: 33000, unit: 'length (12m)', category: 'steel',
    producer: 'Delta/Jisco', note: 'Y20 reinforcement rod',
  },
  binding_wire: {
    price: 18000, unit: 'roll (25kg)', category: 'steel',
    producer: 'Local', note: 'Mild steel binding wire',
  },
  brc_mesh: {
    price: 35000, unit: 'sheet (2.4x4.8m)', category: 'steel',
    producer: 'Local', note: 'BRC welded mesh for slab',
  },

  // ── Roofing ────────────────────────────────────────────────
  long_span_aluminium: {
    price: 3800, unit: 'metre run', category: 'roofing',
    producer: 'Gerard/Local', note: 'Long span aluminium roofing sheet',
  },
  step_tile_roofing: {
    price: 5500, unit: 'metre run', category: 'roofing',
    producer: 'Metcoppo/Gerard', note: 'Stone-coated step tile roofing',
  },
  corrugated_iron: {
    price: 2800, unit: 'metre run', category: 'roofing',
    producer: 'Local', note: 'Corrugated iron roofing sheet',
  },
  fascia_board: {
    price: 2500, unit: 'length (3.6m)', category: 'roofing',
    producer: 'Local', note: 'Timber fascia board',
  },
  roof_truss_timber: {
    price: 4500, unit: 'length (3.6m)', category: 'roofing',
    producer: 'Local', note: '2×6 timber for roof truss',
  },
  nails: {
    price: 4500, unit: 'bag (1kg)', category: 'roofing',
    producer: 'Local', note: '3-inch roofing nails',
  },
  gutter: {
    price: 3500, unit: 'length (3.6m)', category: 'roofing',
    producer: 'Local', note: 'PVC rain gutter',
  },

  // ── Finishing ──────────────────────────────────────────────
  ceramic_floor_tiles: {
    price: 4500, unit: 'm²', category: 'finishing',
    producer: 'Vitrex/Vitra', note: '60×60cm ceramic floor tile',
  },
  porcelain_tiles: {
    price: 7500, unit: 'm²', category: 'finishing',
    producer: 'RAK/Vitra', note: '60×60cm porcelain tile',
  },
  wall_tiles: {
    price: 5000, unit: 'm²', category: 'finishing',
    producer: 'Vitrex', note: '30×60cm ceramic wall tile',
  },
  tile_adhesive: {
    price: 4500, unit: 'bag (25kg)', category: 'finishing',
    producer: 'Laticrete/Mapei', note: 'Tile adhesive/cement-based',
  },
  tile_grout: {
    price: 2500, unit: 'bag (5kg)', category: 'finishing',
    producer: 'Laticrete', note: 'Unsanded tile grout',
  },
  emulsion_paint: {
    price: 28000, unit: 'bucket (20L)', category: 'finishing',
    producer: 'Dulux/Berger', note: 'Emulsion wall paint',
  },
  gloss_paint: {
    price: 18000, unit: 'bucket (4L)', category: 'finishing',
    producer: 'Dulux/Berger', note: 'Gloss oil paint for wood/metal',
  },
  textured_paint: {
    price: 35000, unit: 'bucket (20L)', category: 'finishing',
    producer: 'Dulux', note: 'Textured/exterior paint',
  },
  wood_filler: {
    price: 3500, unit: 'kg', category: 'finishing',
    producer: 'Local', note: 'Wood filler/putty',
  },

  // ── Doors & Windows ────────────────────────────────────────
  flush_door: {
    price: 18000, unit: 'piece', category: 'joinery',
    producer: 'Local', note: 'Hollow-core flush door (2.1×0.9m)',
  },
  panel_door: {
    price: 35000, unit: 'piece', category: 'joinery',
    producer: 'Local', note: 'Solid wood panel door (2.1×0.9m)',
  },
  security_door: {
    price: 85000, unit: 'piece', category: 'joinery',
    producer: 'Local/Imported', note: 'Steel security door with frame',
  },
  aluminium_window: {
    price: 45000, unit: 'piece (1.2×1.2m)', category: 'joinery',
    producer: 'Local', note: 'Aluminium sliding window with burglary',
  },
  casement_window: {
    price: 55000, unit: 'piece (1.2×1.2m)', category: 'joinery',
    producer: 'Local', note: 'Aluminium casement window',
  },
  louvre_window: {
    price: 18000, unit: 'piece', category: 'joinery',
    producer: 'Local', note: 'Aluminium louvre window',
  },
  door_frame: {
    price: 8000, unit: 'set', category: 'joinery',
    producer: 'Local', note: 'Timber door frame',
  },
  door_lock: {
    price: 12000, unit: 'set', category: 'joinery',
    producer: 'Yale/Handle', note: 'Mortice door lock and handle set',
  },

  // ── Electrical ────────────────────────────────────────────
  electrical_wire_2_5mm: {
    price: 55000, unit: 'roll (100m)', category: 'electrical',
    producer: 'Coleman', note: '2.5mm twin/earth PVC wire',
  },
  electrical_wire_4mm: {
    price: 85000, unit: 'roll (100m)', category: 'electrical',
    producer: 'Coleman', note: '4mm twin/earth PVC wire',
  },
  conduit_pipe: {
    price: 1800, unit: 'length (3.6m)', category: 'electrical',
    producer: 'Local', note: '20mm PVC conduit pipe',
  },
  socket_outlet: {
    price: 3500, unit: 'piece', category: 'electrical',
    producer: 'MK/Legrand', note: '13A switched socket outlet',
  },
  light_switch: {
    price: 2500, unit: 'piece', category: 'electrical',
    producer: 'MK/Legrand', note: '1-gang light switch',
  },
  consumer_unit: {
    price: 45000, unit: 'unit', category: 'electrical',
    producer: 'Hager/MK', note: '12-way consumer unit with MCBs',
  },
  ceiling_rose: {
    price: 1500, unit: 'piece', category: 'electrical',
    producer: 'Local', note: 'Ceiling rose for light fitting',
  },

  // ── Plumbing ──────────────────────────────────────────────
  pvc_pipe_4inch: {
    price: 4500, unit: 'length (3m)', category: 'plumbing',
    producer: 'Boch/Bendura', note: '4-inch PVC soil/waste pipe',
  },
  pvc_pipe_3inch: {
    price: 3200, unit: 'length (3m)', category: 'plumbing',
    producer: 'Boch/Bendura', note: '3-inch PVC waste pipe',
  },
  ppr_pipe_25mm: {
    price: 2800, unit: 'length (4m)', category: 'plumbing',
    producer: 'Haro', note: '25mm PPR hot/cold water pipe',
  },
  wc_toilet: {
    price: 35000, unit: 'set', category: 'plumbing',
    producer: 'Armitage Shanks/Local', note: 'WC toilet suite with cistern',
  },
  wash_hand_basin: {
    price: 18000, unit: 'piece', category: 'plumbing',
    producer: 'Local', note: 'Wash hand basin with pedestal',
  },
  shower_set: {
    price: 25000, unit: 'set', category: 'plumbing',
    producer: 'Local/Imported', note: 'Shower set with mixer',
  },
  kitchen_sink: {
    price: 22000, unit: 'piece', category: 'plumbing',
    producer: 'Franke/Local', note: 'Stainless steel kitchen sink',
  },
  water_heater: {
    price: 85000, unit: 'unit (50L)', category: 'plumbing',
    producer: 'Ariston/Thermocool', note: '50L electric water heater',
  },
  overhead_tank: {
    price: 55000, unit: 'unit (1000L)', category: 'plumbing',
    producer: 'Geepee/Polytank', note: '1000-litre overhead storage tank',
  },

  // ── Ceiling & Internal ─────────────────────────────────────
  pvc_ceiling: {
    price: 1800, unit: 'm²', category: 'finishing',
    producer: 'Local', note: 'PVC suspended ceiling',
  },
  pop_ceiling: {
    price: 3500, unit: 'm²', category: 'finishing',
    producer: 'Local artisan', note: 'Plaster-of-Paris (POP) ceiling',
  },
  gypsum_board: {
    price: 4500, unit: 'sheet (1.2×2.4m)', category: 'finishing',
    producer: 'Saint-Gobain', note: 'Gypsum drywall board',
  },
  screeding_cement: {
    price: 7500, unit: 'bag', category: 'finishing',
    producer: 'BUA/Dangote', note: 'Cement for floor screeding',
  },
  waterproofing: {
    price: 12000, unit: 'bucket (20L)', category: 'concrete',
    producer: 'Sika/Fosroc', note: 'Waterproofing admixture',
  },
};

// ── Material keyword matcher ──────────────────────────────────
// Maps database product names to our category keys
const MATERIAL_KEYWORDS = {
  cement:              ['cement', 'bua', 'dangote', 'lafarge', 'ibeto'],
  blocks_9inch:        ['block', '9 inch', '9inch', 'sandcrete'],
  sharp_sand:          ['sharp sand', 'washed sand', 'concrete sand'],
  soft_sand:           ['soft sand', 'plaster sand', 'mortar sand', 'fill sand'],
  gravel:              ['gravel', 'granite', 'aggregate', 'chippings', '¾ inch'],
  rebar_10mm:          ['10mm', 'y10', 'rod 10', 'rebar 10'],
  rebar_12mm:          ['12mm', 'y12', 'rod 12', 'rebar 12'],
  rebar_16mm:          ['16mm', 'y16', 'rod 16', 'rebar 16'],
  rebar_20mm:          ['20mm', 'y20', 'rod 20', 'rebar 20'],
  long_span_aluminium: ['long span', 'longspan', 'aluminium roof', 'aluminum roof'],
  step_tile_roofing:   ['step tile', 'steptile', 'metcoppo', 'stone coat'],
  ceramic_floor_tiles: ['ceramic tile', 'floor tile', 'ceramic floor'],
  porcelain_tiles:     ['porcelain', 'vitrified'],
  emulsion_paint:      ['emulsion', 'wall paint', 'dulux', 'berger'],
  flush_door:          ['flush door', 'hollow door'],
  aluminium_window:    ['aluminium window', 'aluminum window', 'sliding window'],
  electrical_wire_2_5mm: ['2.5mm wire', '2.5 wire', 'twin earth'],
  pvc_pipe_4inch:      ['4 inch pipe', '4inch pipe', 'soil pipe', '110mm pipe'],
  wc_toilet:           ['toilet', 'wc', 'water closet'],
  overhead_tank:       ['overhead tank', 'water tank', 'polytank', 'geepee'],
};

// ── Main function ─────────────────────────────────────────────
const getZoyaConstructionPrices = async (projectType = 'building') => {
  let dbPrices = {};

  try {
    // Broad query — fetch all construction-related products
    const result = await sql`
      SELECT
        name,
        price,
        unit,
        producer,
        description,
        type,
        category
      FROM products
      WHERE (
        LOWER(name)        LIKE '%cement%'    OR
        LOWER(name)        LIKE '%block%'     OR
        LOWER(name)        LIKE '%sand%'      OR
        LOWER(name)        LIKE '%gravel%'    OR
        LOWER(name)        LIKE '%granite%'   OR
        LOWER(name)        LIKE '%aggregate%' OR
        LOWER(name)        LIKE '%steel%'     OR
        LOWER(name)        LIKE '%rod%'       OR
        LOWER(name)        LIKE '%rebar%'     OR
        LOWER(name)        LIKE '%timber%'    OR
        LOWER(name)        LIKE '%wood%'      OR
        LOWER(name)        LIKE '%roof%'      OR
        LOWER(name)        LIKE '%tile%'      OR
        LOWER(name)        LIKE '%paint%'     OR
        LOWER(name)        LIKE '%door%'      OR
        LOWER(name)        LIKE '%window%'    OR
        LOWER(name)        LIKE '%pipe%'      OR
        LOWER(name)        LIKE '%wire%'      OR
        LOWER(name)        LIKE '%toilet%'    OR
        LOWER(name)        LIKE '%tank%'      OR
        LOWER(name)        LIKE '%plaster%'   OR
        LOWER(name)        LIKE '%waterproof%' OR
        LOWER(type)        LIKE '%construction%' OR
        LOWER(category)    LIKE '%building%'  OR
        LOWER(description) LIKE '%construction%'
      )
      AND price > 0
      AND available = true
      ORDER BY name ASC
      LIMIT 100
    `;

    // Map DB results to our standardised price keys
    result.forEach(row => {
      const nameLower = (row.name || '').toLowerCase();

      // Try to match to a known material key
      let matchedKey = null;
      for (const [key, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        if (keywords.some(kw => nameLower.includes(kw))) {
          matchedKey = key;
          break;
        }
      }

      // If no keyword match, create a sanitised key from the product name
      const priceKey = matchedKey || nameLower.replace(/[^\w]/g, '_').replace(/__+/g, '_');

      // Only add if not already set (first match wins — ordered by price ASC so cheapest first)
      if (!dbPrices[priceKey]) {
        dbPrices[priceKey] = {
          price:       Number(row.price),
          unit:        row.unit        || 'unit',
          producer:    row.producer    || 'Zoya',
          category:    row.category    || row.type || 'general',
          description: (row.description || '').substring(0, 120),
          source:      'zoya_database',
        };
      }
    });

    console.log(`✅ priceService: ${Object.keys(dbPrices).length} materials from DB for projectType="${projectType}"`);

  } catch (err) {
    console.error('❌ priceService DB error:', err.message);
    // Will fall through to fallback merge below
  }

  // ── Merge: DB prices override fallbacks for matched keys ──
  // This means:
  //   - If cement is in DB → use DB price
  //   - If rebar_16mm is NOT in DB → use fallback ₦21,000
  //   - All fallback materials are always available to the AI
  const merged = { ...NIGERIAN_FALLBACK_PRICES, ...dbPrices };

  // ── Filter by project type to reduce noise in the AI prompt ──
  const relevantCategories = {
    building:  ['concrete','masonry','steel','roofing','finishing','joinery','electrical','plumbing'],
    road:      ['concrete','steel','general'],
    drainage:  ['concrete','steel','plumbing','general'],
    fencing:   ['masonry','steel','concrete','general'],
    bridge:    ['concrete','steel','general'],
  };

  const allowed = relevantCategories[projectType] || relevantCategories.building;

  const filtered = Object.fromEntries(
    Object.entries(merged).filter(([, v]) =>
      !v.category || allowed.includes(v.category)
    )
  );

  console.log(`📦 priceService: returning ${Object.keys(filtered).length} prices for "${projectType}"`);

  return filtered;
};

module.exports = { getZoyaConstructionPrices };
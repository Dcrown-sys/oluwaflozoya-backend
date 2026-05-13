const { sql } = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const stream = require('stream');
const axios = require('axios');
const { geocodeAddress } = require ('../utils/geocode');
const { calculateEta } = require('../utils/eta');
const fetch = require('node-fetch');

 // Adjust path if your notifications controller is in a different location (e.g., '../controllers/notifications')





// 🔐 JWT secret
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY; 

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// ✅ Firebase Admin SDK Setup
const admin = require("../config/firebase");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: `${serviceAccount.project_id}.appspot.com`,
  });
}
const bucket = admin.storage().bucket();

// ✅ Multer setup
const upload = multer({ storage: multer.memoryStorage() });
exports.uploadMiddleware = upload.single('image');

// ✅ Signup (admin registration)
exports.signupAdmin = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await sql`
      INSERT INTO users (name, email, password, role)
      VALUES (${name}, ${email}, ${hashedPassword}, 'admin')
    `;

    res.status(201).json({ message: 'Admin registered successfully' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Email already exists or bad request' });
  }
};

// controllers/adminController.js

exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Fetch the admin user from database
    const admin = await sql`
      SELECT * FROM users WHERE email = ${email} AND role = 'admin'
    `;

    if (!admin || admin.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Check password
    const valid = await bcrypt.compare(password, admin[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    // Generate JWT token
    const token = jwt.sign(
      { id: admin[0].id, email: admin[0].email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send structured response including user object
    res.status(200).json({
      success: true,
      user: {
        id: admin[0].id,
        full_name: admin[0].name, // match frontend expectation
        email: admin[0].email,
        role: admin[0].role,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};


exports.getAdminAnalyticsOverview = async (req, res) => {
    try {
      // Basic counts
      const userCountResult = await sql`SELECT COUNT(*) FROM users`;
      const courierCountResult = await sql`SELECT COUNT(*) FROM users WHERE role = 'courier'`;
      const productCountResult = await sql`SELECT COUNT(*) FROM products`;
      const orderCountResult = await sql`SELECT COUNT(*) FROM orders`;
  
      // Total revenue (sum of completed payments)
      const revenueResult = await sql`
        SELECT COALESCE(SUM(amount), 0) AS total_revenue
        FROM payments
        WHERE status = 'completed'
      `;
  
      // Orders this week vs last week for growth % calculation
      const ordersThisWeekResult = await sql`
        SELECT COUNT(*) AS this_week
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '7 days'
      `;
  
      const ordersLastWeekResult = await sql`
        SELECT COUNT(*) AS last_week
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '14 days'
        AND created_at < NOW() - INTERVAL '7 days'
      `;
  
      // Calculate weekly growth %
      const thisWeek = parseInt(ordersThisWeekResult[0].this_week, 10);
      const lastWeek = parseInt(ordersLastWeekResult[0].last_week, 10);
      let weeklyGrowthPercent = 0;
      if (lastWeek > 0) {
        weeklyGrowthPercent = ((thisWeek - lastWeek) / lastWeek) * 100;
      }
  
      // Top 5 products by order quantity
      const topProductsResult = await sql`
        SELECT p.name, SUM(oi.quantity) AS total_ordered
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        GROUP BY p.name
        ORDER BY total_ordered DESC
        LIMIT 5
      `;
  
      res.json({
        totalUsers: parseInt(userCountResult[0].count, 10),
        totalCouriers: parseInt(courierCountResult[0].count, 10),
        totalProducts: parseInt(productCountResult[0].count, 10),
        totalOrders: parseInt(orderCountResult[0].count, 10),
        monthlyRevenue: parseFloat(revenueResult[0].total_revenue),
        weeklyGrowthPercent: parseFloat(weeklyGrowthPercent.toFixed(2)),
        topProducts: topProductsResult.map(row => ({
          name: row.name,
          orders: parseInt(row.total_ordered, 10)
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load analytics overview' });
    }
  };
  

// Revenue graph over time
exports.getSalesGraph = async (req, res) => {
    try {
      const results = await sql`
        SELECT
          DATE(created_at) AS date,
          SUM(amount) AS revenue
        FROM payments
        WHERE status = 'completed'
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `;
  
      const formatted = results.map(row => ({
        date: row.date.toISOString().split('T')[0],
        revenue: parseFloat(row.revenue)
      }));
  
      res.status(200).json(formatted);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load sales graph data' });
    }
  };

  // controllers/adminDeliveryController.js
  exports.getCourierTrackingStatus = async (req, res) => {
    try {
      // Get latest tracking record per delivery via lateral join or subquery
      const couriers = await sql`
        SELECT 
          u.id AS courier_id,
          u.name AS courier_name,
          u.phone,
          d.id AS delivery_id,
          d.status AS delivery_status,
          o.id AS order_id,
          dt.latitude,
          dt.longitude,
          dt.timestamp AS tracking_timestamp
        FROM users u
        LEFT JOIN deliveries d ON d.courier_id = u.id AND d.status = 'en_route'
        LEFT JOIN LATERAL (
          SELECT latitude, longitude, timestamp
          FROM delivery_tracking dt
          WHERE dt.delivery_id = d.id
          ORDER BY dt.timestamp DESC
          LIMIT 1
        ) dt ON true
        LEFT JOIN orders o ON o.id = d.order_id
        WHERE u.role = 'courier'
      `;
  
      const result = couriers.map(c => ({
        courierId: c.courier_id,
        name: c.courier_name,
        phone: c.phone,
        location: c.latitude && c.longitude ? {
          lat: c.latitude,
          lng: c.longitude,
          updatedAt: c.tracking_timestamp,
        } : null,
        currentOrder: c.order_id || null,
        deliveryId: c.delivery_id || null,
        status: c.delivery_status || 'idle',
      }));
  
      res.json(result);
    } catch (err) {
      console.error('Tracking error:', err);
      res.status(500).json({ message: 'Failed to fetch courier tracking status' });
    }
  };

  // controllers/courierController.js
  exports.updateCourierLocation = async (req, res) => {
    const { deliveryId, latitude, longitude } = req.body;
  
    if (!deliveryId || !latitude || !longitude) {
      return res.status(400).json({ error: 'Missing deliveryId, latitude, or longitude' });
    }
  
    try {
      await sql`
        INSERT INTO delivery_tracking (delivery_id, latitude, longitude, timestamp)
        VALUES (${deliveryId}, ${latitude}, ${longitude}, NOW())
      `;
  
      res.status(200).json({ message: 'Courier location updated successfully' });
    } catch (err) {
      console.error('Location update failed:', err);
      res.status(500).json({ error: 'Failed to update courier location' });
    }
  };


  // ✅ Get all products
  exports.getAllProducts = async (req, res) => {
    try {
      const result = await sql`
        SELECT p.id, p.name, p.description, p.unit, p.min_order_qty, 
               p.price, p.stock_quantity, p.available, 
               p.image_url, u.full_name AS producer_name 
        FROM products p
        LEFT JOIN users u ON p.producer_id = u.id
        ORDER BY p.created_at DESC
      `;
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Failed to fetch products' });
    }
  };
  
 // ✅ Create product with image upload
exports.createProduct = async (req, res) => {
    try {
      const { name, description, price, unit, stock_quantity, producer_id } = req.body;
      const file = req.file;
  
      let imageUrl = null;
  
      if (file) {
        const filename = `${uuidv4()}${path.extname(file.originalname)}`;
        const fileUpload = bucket.file(`products/${filename}`);
        const passthroughStream = new stream.PassThrough();
  
        passthroughStream.end(file.buffer);
        await new Promise((resolve, reject) => {
          passthroughStream
            .pipe(fileUpload.createWriteStream({
              metadata: {
                contentType: file.mimetype,
                metadata: {
                  firebaseStorageDownloadTokens: uuidv4(),
                }
              }
            }))
            .on('finish', resolve)
            .on('error', reject);
        });
  
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media`;
      }
  
      // 🔥 Save product in DB
      const result = await sql`
        INSERT INTO products (
          name, price, description, unit,
          image_url, producer_id, stock_quantity
        )
        VALUES (
          ${name}, ${price}, ${description}, ${unit},
          ${imageUrl}, ${producer_id}, ${stock_quantity}
        )
        RETURNING *;
      `;
  
      res.json({ message: 'Product added successfully', product: result[0] });
    } catch (error) {
      console.error('❌ Upload error:', error);
      res.status(500).json({ error: 'Failed to add product' });
    }
  };
  

  // ✅ Update product by ID (using postgres.js)
  exports.updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, description, unit, stock_quantity, weightKg, locations } = req.body;
  
    try {
      // Prepare updates only for defined fields
      const setParts = [];
      const values = [];
      let index = 1;
  
      if (name !== undefined) {
        setParts.push(`name = $${index++}`);
        values.push(name);
      }
      if (description !== undefined) {
        setParts.push(`description = $${index++}`);
        values.push(description);
      }
      if (unit !== undefined) {
        setParts.push(`unit = $${index++}`);
        values.push(unit);
      }
      if (stock_quantity !== undefined) {
        setParts.push(`stock_quantity = $${index++}`);
        values.push(stock_quantity);
      }
      if (weightKg !== undefined) {
        setParts.push(`weight_kg = $${index++}`);
        values.push(weightKg);
      }
  
      let updatedProduct;
      if (setParts.length > 0) {
        // Build and execute the UPDATE query
        const query = `UPDATE products SET ${setParts.join(', ')} WHERE id = $${index} RETURNING *`;
        values.push(id);
        const result = await sql.unsafe(query, values);
        updatedProduct = result[0];
        if (!updatedProduct) {
          return res.status(404).json({ message: 'Product not found' });
        }
      } else {
        // No core updates, just fetch the product
        const [product] = await sql`SELECT * FROM products WHERE id = ${id}`;
        if (!product) {
          return res.status(404).json({ message: 'Product not found' });
        }
        updatedProduct = product;
      }
  
      // Handle location price updates
      if (locations && Array.isArray(locations)) {
        for (const loc of locations) {
          if (!loc.locationId || typeof loc.price !== 'number') {
            return res.status(400).json({ message: 'Each location update must have locationId and price' });
          }
          // Validate location exists
          const [existingLoc] = await sql`SELECT 1 FROM locations WHERE id = ${loc.locationId}`;
          if (!existingLoc) {
            return res.status(400).json({ message: `Invalid locationId: ${loc.locationId} does not exist` });
          }
  
          // Upsert price (use 0 if transportCost is undefined)
          const transportCost = loc.transportCost !== undefined ? loc.transportCost : 0;
          await sql`
            INSERT INTO product_locations (product_id, location_id, price, transport_cost)
            VALUES (${id}, ${loc.locationId}, ${loc.price}, ${transportCost})
            ON CONFLICT (product_id, location_id)
            DO UPDATE SET price = EXCLUDED.price, transport_cost = EXCLUDED.transport_cost
          `;
        }
      }
  
      res.json({ message: 'Product updated successfully', product: updatedProduct });
    } catch (err) {
      console.error('Update product error:', err);
      res.status(500).json({ message: 'Failed to update product' });
    }
  };
  

  // ✅ Delete product by ID (using postgres.js)
  exports.deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
      await sql`DELETE FROM product_locations WHERE product_id = ${id}`;
      await sql`DELETE FROM products WHERE id = ${id}`;
      res.json({ message: 'Product deleted successfully' });
    } catch (err) {
      console.error('Delete product error:', err);
      res.status(500).json({ message: 'Failed to delete product' });
    }
  };



exports.createOrder = async (req, res) => {
    console.log('=== [createOrder] Incoming Request ===');
    console.log('📦 Raw body:', req.body);
  
    let {
      user_id,
      order_items,
      delivery_address,
      payment_reference,
      delivery_fee = 0,
      phone_number,
      dropoff_lat,
      dropoff_lng
    } = req.body;
  
    console.log('🔎 Extracted fields:', {
      user_id,
      order_items_count: Array.isArray(order_items) ? order_items.length : 0,
      delivery_address,
      payment_reference,
      delivery_fee,
      phone_number,
      dropoff_lat,
      dropoff_lng
    });
  
    if (!user_id || !Array.isArray(order_items) || order_items.length === 0) {
      return res.status(400).json({ message: 'Invalid order payload' });
    }
  
    try {
      // Fetch user
      console.log(`👤 Fetching user ${user_id} from DB...`);
      const [user] = await sql`
        SELECT id, address, latitude, longitude
        FROM users
        WHERE id = ${user_id}
      `;
      if (!user) {
        console.warn(`❌ User ${user_id} not found`);
        return res.status(404).json({ message: 'User not found' });
      }
      console.log('👤 User lookup result:', user);
  
      // Ensure coordinates are numbers
      dropoff_lat = dropoff_lat ? parseFloat(dropoff_lat) : null;
      dropoff_lng = dropoff_lng ? parseFloat(dropoff_lng) : null;
      console.log('🔢 Parsed dropoff coordinates:', dropoff_lat, dropoff_lng);
  
      // If missing, attempt geocoding
      if ((!dropoff_lat || !dropoff_lng) && delivery_address) {
        try {
          console.log(`📍 Geocoding address: ${delivery_address}`);
          const geoRes = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
            params: { address: delivery_address, key: process.env.GOOGLE_MAPS_KEY }
          });
          const coords = geoRes.data.results?.[0]?.geometry?.location;
          if (coords) {
            dropoff_lat = parseFloat(coords.lat);
            dropoff_lng = parseFloat(coords.lng);
            console.log(`✅ Geocoded to lat: ${dropoff_lat}, lng: ${dropoff_lng}`);
          } else {
            console.warn('⚠️ Could not geocode delivery address — fallback to user address.');
          }
        } catch (geoErr) {
          console.error('❌ Geocoding error:', geoErr.message);
        }
      }
  
      // Fallback to user's registered address if still missing
      if (!dropoff_lat || !dropoff_lng || !delivery_address) {
        delivery_address = user.address;
        dropoff_lat = parseFloat(user.latitude);
        dropoff_lng = parseFloat(user.longitude);
        console.log('↩️ Using registered address as fallback:', delivery_address);
      }
  
      // Begin transaction
      await sql.begin(async (tx) => {
        // Update user's delivery address
        console.log(`📝 Updating user ${user_id} delivery_address...`);
        await tx`
          UPDATE users SET delivery_address = ${delivery_address}
          WHERE id = ${user_id}
        `;
  
        // Calculate total
        const totalAmount = order_items.reduce(
          (sum, item) => sum + Number(item.total_price || 0),
          0
        ) + Number(delivery_fee);
        console.log('💰 Calculated total amount:', totalAmount);
  
        // Insert order
        console.log('📝 Inserting into orders table...');
        const orderResult = await tx`
          INSERT INTO orders (
            user_id, status, total_amount, payment_reference, delivery_fee,
            phone_number, delivery_address, dropoff_lat, dropoff_lng
          )
          VALUES (
            ${user_id}, 'pending', ${totalAmount}, ${payment_reference || null}, ${delivery_fee},
            ${phone_number}, ${delivery_address}, ${dropoff_lat}, ${dropoff_lng}
          )
          RETURNING id, created_at
        `;
        const orderId = orderResult[0].id;
        console.log(`🆕 Created order ${orderId} for user ${user_id}`);
        console.log('📊 Inserted order dropoff coordinates:', { dropoff_lat, dropoff_lng });
  
        // Insert order items and deduct stock
        for (const item of order_items) {
          const { product_id, quantity, unit_price, total_price } = item;
          console.log('📦 Processing order item:', item);
  
          const productData = await tx`
            SELECT id, name, stock_quantity FROM products WHERE id = ${product_id}
          `;
          if (!productData.length) throw new Error(`Product not found: ${product_id}`);
          if (productData[0].stock_quantity < quantity)
            throw new Error(`Insufficient stock for product: ${productData[0].name}`);
  
          console.log(`📉 Deducting stock: ${quantity} from product ${productData[0].name} (current stock=${productData[0].stock_quantity})`);
          await tx`
            UPDATE products SET stock_quantity = stock_quantity - ${quantity}
            WHERE id = ${product_id}
          `;
  
          await tx`
            INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
            VALUES (${orderId}, ${product_id}, ${quantity}, ${unit_price}, ${total_price})
          `;
          console.log(`✅ Added ${quantity} x ${productData[0].name} to order ${orderId}`);
        }
  
        // Final response
        console.log('✅ Final response payload:', {
          message: 'Order created successfully',
          order_id: orderId,
          total_amount: totalAmount,
          payment_reference: payment_reference || null,
          delivery_address,
          dropoff_lat,
          dropoff_lng,
          created_at: orderResult[0].created_at
        });
  
        res.status(201).json({
          message: 'Order created successfully',
          order_id: orderId,
          total_amount: totalAmount,
          payment_reference: payment_reference || null,
          delivery_address,
          dropoff_lat,
          dropoff_lng,
          created_at: orderResult[0].created_at
        });
      });
  
    } catch (err) {
      console.error('❌ Error creating order:', err.message);
      res.status(500).json({ message: err.message || 'Failed to create order' });
    }
  };
  
  
  
// =============================
// Get all orders for a specific user (buyer)
// =============================
exports.getOrdersByUser = async (req, res) => {
  const { user_id } = req.params;

  try {
    const rows = await sql`
      SELECT 
        o.id AS order_id,
        o.status,
        o.created_at,
        o.total_amount,
        o.delivery_address,
        o.courier_id,
        c.full_name AS courier_name,
        c.phone AS courier_phone,
        c.vehicle_type,
        c.vehicle_plate,
        o.distance_km,
        o.delivery_fee,
        oi.product_id,
        p.name AS product_name,
        oi.quantity,
        oi.unit_price,
        oi.total_price
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN couriers c ON o.courier_id = c.id
      WHERE o.user_id = ${user_id}
      ORDER BY o.created_at DESC
    `;

    const ordersMap = new Map();

    for (const row of rows) {
      const {
        order_id,
        status,
        created_at,
        total_amount,
        delivery_address,
        courier_id,
        courier_name,
        courier_phone,
        vehicle_type,
        vehicle_plate,
        distance_km,
        delivery_fee,
        product_id,
        product_name,
        quantity,
        unit_price,
        total_price,
      } = row;

      if (!ordersMap.has(order_id)) {
        ordersMap.set(order_id, {
          id: order_id,
          status,
          created_at,
          total_price: total_amount,
          delivery_address,
          delivery_fee,
          distance_km,
          courier: courier_id
            ? {
                id: courier_id,
                name: courier_name || null,
                phone: courier_phone || null,
                vehicle_type,
                vehicle_plate,
              }
            : null,
          items: [],
        });
      }

      ordersMap.get(order_id).items.push({
        product_id,
        product_name,
        quantity,
        unit_price,
        total_price,
      });
    }

    res.status(200).json({ success: true, data: Array.from(ordersMap.values()) });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ message: "Failed to retrieve orders" });
  }
};

/// adminController.js
exports.getOrderById = async (req, res) => {
  const { id } = req.params;
  const userId = req.query.userId; // optional: for buyer-specific access

  if (!id) {
    return res.status(400).json({ success: false, message: "Order ID is required" });
  }

  try {
    const [order] = await sql`
      SELECT 
        o.*,
        -- Buyer info
        json_build_object(
          'id', u.id,
          'name', u.full_name,
          'email', u.email,
          'phone', u.phone
        ) AS buyer,
        -- Courier info (can be null)
        json_build_object(
          'id', c.id,
          'name', c.full_name,
          'phone', c.phone,
          'vehicle_type', c.vehicle_type,
          'vehicle_plate', c.vehicle_plate
        ) AS courier,
        -- Items
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN couriers c ON c.id = o.courier_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${userId ? sql`WHERE o.id = ${id} AND o.user_id = ${userId}` : sql`WHERE o.id = ${id}`}
      GROUP BY o.id, u.id, c.id
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    console.error("❌ Error fetching order details:", err);
    res.status(500).json({ success: false, message: "Error fetching order details" });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const { tx_ref } = req.body;

    if (!tx_ref) {
      return res.status(400).json({ error: 'tx_ref is required' });
    }

    // Update payment status to cancelled (no order to delete)
    await sql`
      UPDATE payments
      SET status = 'cancelled', updated_at = NOW()
      WHERE tx_ref = ${tx_ref}
    `;

    res.json({ success: true, message: 'Payment cancelled' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};



  
// adminController.assignCourier
// exports.assignCourierToOrder = async (req, res) => {
//     const { orderId } = req.params;
//     const { pickup_address, pickup_lat, pickup_lng } = req.body;
  
//     try {
//       console.log(`ℹ️ Assigning courier for order ${orderId}...`);
  
//       // 1️⃣ Fetch order + user info (buyer = dropoff)
//       const [orderData] = await sql`
//         SELECT o.id, o.delivery_address,
//                u.address AS user_address, u.latitude AS user_lat, u.longitude AS user_lng
//         FROM orders o
//         LEFT JOIN users u ON u.id = o.user_id
//         WHERE o.id = ${orderId}
//       `;
  
//       if (!orderData) return res.status(404).json({ error: "Order not found" });
  
//       // 2️⃣ Resolve dropoff coords (buyer address)
//       let dropoffLat = orderData.user_lat;
//       let dropoffLng = orderData.user_lng;
//       let dropoffAddress = orderData.delivery_address || orderData.user_address;
  
//       if ((!dropoffLat || !dropoffLng) && dropoffAddress) {
//         const geo = await geocodeAddress(dropoffAddress);
//         if (geo) {
//           dropoffLat = geo.lat;
//           dropoffLng = geo.lng;
//         }
//       }
  
//       // 3️⃣ Find nearest courier
//       const [courier] = await sql`
//         SELECT id, full_name, phone, latitude, longitude, address
//         FROM users
//         WHERE role = 'courier'
//           AND latitude IS NOT NULL
//           AND longitude IS NOT NULL
//         ORDER BY
//           (6371 * acos(
//             cos(radians(${dropoffLat || 0})) *
//             cos(radians(latitude)) *
//             cos(radians(longitude) - radians(${dropoffLng || 0})) +
//             sin(radians(${dropoffLat || 0})) *
//             sin(radians(latitude))
//           )) ASC
//         LIMIT 1
//       `;
  
//       if (!courier) return res.status(404).json({ error: "No available couriers nearby" });
  
//       // 4️⃣ Prevent duplicate assignment
//       const [existing] = await sql`SELECT id FROM deliveries WHERE order_id = ${orderId}`;
//       if (existing) return res.status(400).json({ error: "Order already has a courier assigned" });
  
//       // 5️⃣ Resolve pickup info (from input or courier’s current location)
//       let finalPickupAddress = pickup_address || courier.address || "Courier current location";
//       let finalPickupLat = pickup_lat || courier.latitude;
//       let finalPickupLng = pickup_lng || courier.longitude;
  
//       if ((!finalPickupLat || !finalPickupLng) && finalPickupAddress) {
//         const geo = await geocodeAddress(finalPickupAddress);
//         if (geo) {
//           finalPickupLat = geo.lat;
//           finalPickupLng = geo.lng;
//         }
//       }
  
//       // 6️⃣ Insert into deliveries table
//       const [delivery] = await sql`
//         INSERT INTO deliveries (
//           order_id,
//           courier_id,
//           pickup_address,
//           pickup_latitude,
//           pickup_longitude,
//           dropoff_address,
//           dropoff_latitude,
//           dropoff_longitude,
//           status
//         )
//         VALUES (
//           ${orderId},
//           ${courier.id},
//           ${finalPickupAddress},
//           ${finalPickupLat},
//           ${finalPickupLng},
//           ${dropoffAddress},
//           ${dropoffLat},
//           ${dropoffLng},
//           'assigned'
//         )
//         RETURNING *
//       `;
  
//       // 7️⃣ Get products in this order (so courier knows what to carry)
//       const orderItems = await sql`
//         SELECT oi.product_id, p.name, oi.quantity, oi.unit_price, oi.total_price
//         FROM order_items oi
//         JOIN products p ON p.id = oi.product_id
//         WHERE oi.order_id = ${orderId}
//       `;
  
//       console.log(`🚚 Courier ${courier.id} assigned to order ${orderId}`);
  
//       res.json({
//         message: "Courier assigned successfully",
//         courier: {
//           id: courier.id,
//           full_name: courier.full_name,
//           phone: courier.phone,
//           current_latitude: courier.latitude,
//           current_longitude: courier.longitude,
//           address: courier.address || "",
//         },
//         delivery,
//         items: orderItems,
//       });
//     } catch (err) {
//       console.error("❌ Error assigning courier:", err.message);
//       res.status(500).json({ error: "Failed to assign courier" });
//     }
//   };



// get delivertracking
// controllers/adminController.js

exports.getDeliveryTracking = async (req, res) => {
    try {
      const { delivery_id } = req.params;
  
      // Fetch delivery info along with courier and buyer
      const delivery = await sql`
        SELECT 
          d.id AS delivery_id,
          d.status,
          d.assigned_at,
          d.picked_up_at,
          d.delivered_at,
          d.cancelled_at,
          d.last_location,
          d.pickup_address,
          d.dropoff_address,
          d.pickup_latitude,
          d.pickup_longitude,
          d.dropoff_latitude,
          d.dropoff_longitude,
          d.eta,
          d.distance_km,
          d.fee,
          d.bonus,
          d.points_awarded,
          d.courier_rating,
          o.id AS order_id,
          buyer.id AS buyer_id,
          buyer.full_name AS buyer_name,
          buyer.phone AS buyer_phone,
          courier.id AS courier_id,
          courier.full_name AS courier_name,
          courier.phone AS courier_phone
        FROM deliveries d
        JOIN orders o ON o.id = d.order_id
        JOIN users buyer ON buyer.id = o.user_id
        LEFT JOIN users courier ON courier.id = d.courier_id
        WHERE d.id = ${delivery_id}
      `;
  
      if (!delivery || delivery.length === 0) {
        return res.status(404).json({ error: 'Delivery not found' });
      }
  
      const deliveryData = delivery[0];
  
      // Fetch items in the order
      const items = await sql`
        SELECT 
          oi.id AS order_item_id,
          p.id AS product_id,
          p.name AS product_name,
          oi.quantity,
          oi.unit_price,
          oi.total_price
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ${deliveryData.order_id}
      `;
  
      const response = {
        delivery_id: deliveryData.delivery_id,
        status: deliveryData.status,
        timestamps: {
          assigned_at: deliveryData.assigned_at,
          picked_up_at: deliveryData.picked_up_at,
          delivered_at: deliveryData.delivered_at,
          cancelled_at: deliveryData.cancelled_at,
        },
        courier: deliveryData.courier_id
          ? {
              id: deliveryData.courier_id,
              name: deliveryData.courier_name,
              phone: deliveryData.courier_phone,
            }
          : null,
        buyer: {
          id: deliveryData.buyer_id,
          name: deliveryData.buyer_name,
          phone: deliveryData.buyer_phone,
        },
        pickup: {
          address: deliveryData.pickup_address,
          latitude: deliveryData.pickup_latitude,
          longitude: deliveryData.pickup_longitude,
        },
        dropoff: {
          address: deliveryData.dropoff_address,
          latitude: deliveryData.dropoff_latitude,
          longitude: deliveryData.dropoff_longitude,
        },
        live_location: deliveryData.last_location || null,
        eta: deliveryData.eta,
        distance_km: deliveryData.distance_km,
        fee: deliveryData.fee,
        bonus: deliveryData.bonus,
        points_awarded: deliveryData.points_awarded,
        courier_rating: deliveryData.courier_rating,
        items,
      };
  
      return res.json(response);
    } catch (error) {
      console.error('getDeliveryTracking error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
  
  
// controllers/adminController.js
exports.assignDelivery = async (req, res) => {
    const { order_id, courier_id } = req.body;
  
    if (!order_id || !courier_id) {
      return res.status(400).json({ message: 'order_id and courier_id are required' });
    }
  
    try {
      // 1. Verify order exists and is pending
      const order = await sql`SELECT * FROM orders WHERE id = ${order_id} AND status = 'pending'`;
      if (!order || order.length === 0) {
        return res.status(404).json({ message: 'Order not found or already assigned' });
      }
  
      // 2. Verify courier exists and is available
      const courier = await sql`SELECT * FROM couriers WHERE user_id = ${courier_id} AND is_available = true`;
      if (!courier || courier.length === 0) {
        return res.status(404).json({ message: 'Courier not found or not available' });
      }
  
      // 3. Create delivery
      const [delivery] = await sql`
        INSERT INTO deliveries (order_id, courier_id, status, assigned_at)
        VALUES (${order_id}, ${courier_id}, 'assigned', NOW())
        RETURNING *;
      `;
  
      // 4. Update order status
      await sql`UPDATE orders SET status = 'assigned' WHERE id = ${order_id}`;
  
      return res.status(200).json({ message: 'Courier assigned successfully', delivery });
    } catch (err) {
      console.error('Error assigning delivery:', err);
      return res.status(500).json({ message: 'Failed to assign courier' });
    }
  };
  
  

  // adminController.updateCourierLocation
  exports.updateCourierLocation = async (req, res) => {
    const { courier_id, order_id, lat, lng } = req.body;
  
    if (!order_id || lat == null || lng == null) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Invalid coordinates' });
    }
  
    try {
      // Ensure courier belongs to order
      const [order] = await sql`
        SELECT courier_id FROM deliveries
        WHERE order_id = ${order_id} LIMIT 1
      `;
      if (!order || order.courier_id !== courier_id) {
        return res.status(403).json({ message: 'Courier not assigned to this order' });
      }
  
      // Save to history
      await sql`
        INSERT INTO courier_locations (courier_id, order_id, lat, lng)
        VALUES (${courier_id}, ${order_id}, ${lat}, ${lng})
      `;
  
      // Update live location in orders table
      const locObj = { lat: Number(lat), lng: Number(lng), updated_at: new Date().toISOString() };
      await sql`
        UPDATE orders SET courier_location = ${JSON.stringify(locObj)}
        WHERE id = ${order_id}
      `;
  
      // Emit to subscribers
      try {
        const io = req.app.get('io') || global.io;
        if (io) {
          io.to(`order:${order_id}`).emit('courier:location', { order_id, lat, lng });
        }
      } catch (e) { /* ignore emit errors */ }
  
      res.json({ success: true });
    } catch (err) {
      console.error('updateCourierLocation error', err);
      res.status(500).json({ message: 'Failed to update location' });
    }
  };
  

  // Fetch all couriers with their latest delivery status and location
  exports.getCourierTrackingStatus = async (req, res) => {
    try {
      // Fetch all couriers with optional active deliveries
      const couriers = await sql`
        SELECT 
          u.id AS courier_id,
          u.full_name AS courier_name,
          u.phone AS courier_phone,
          u.latitude,
          u.longitude,
          d.id AS delivery_id,
          d.order_id,
          d.status AS delivery_status,
          d.eta AS delivery_eta,
          d.assigned_at AS delivery_created_at,
          d.picked_up_at AS delivery_updated_at
        FROM users u
        LEFT JOIN deliveries d
          ON u.id = d.courier_id AND d.status != 'completed'
        WHERE u.role = 'courier'
        ORDER BY u.full_name ASC
      `;
  
      // Map to clean format for frontend
      const formatted = couriers.map((c) => ({
        id: c.courier_id,
        full_name: c.courier_name,
        phone: c.courier_phone,
        latitude: c.latitude,
        longitude: c.longitude,
        delivery: c.delivery_id
          ? {
              id: c.delivery_id,
              order_id: c.order_id,
              status: c.delivery_status,
              eta: c.delivery_eta,
              created_at: c.delivery_created_at, // now using assigned_at
              updated_at: c.delivery_updated_at, // now using picked_up_at
            }
          : null,
      }));
  
      res.json({
        success: true,
        couriers: formatted,
      });
    } catch (error) {
      console.error('Error fetching courier tracking status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch courier tracking status',
      });
    }
  };
  
  
  

  // adminController.getNearestCouriers
exports.getNearestCouriers = async (req, res) => {
    try {
      const { latitude, longitude, limit = 5 } = req.query; // from buyer location or pickup location
  
      if (!latitude || !longitude) {
        return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
      }
  
      const couriers = await sql`
        SELECT 
          u.id AS courier_id,
          u.full_name AS courier_name,
          u.phone AS courier_phone,
          d.latitude,
          d.longitude,
          d.status,
          (
            6371 * acos(
              cos(radians(${latitude})) *
              cos(radians(d.latitude)) *
              cos(radians(d.longitude) - radians(${longitude})) +
              sin(radians(${latitude})) *
              sin(radians(d.latitude))
            )
          ) AS distance_km
        FROM users u
        JOIN deliveries d ON u.id = d.courier_id
        WHERE u.role = 'courier' 
          AND d.status = 'available'
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
        ORDER BY distance_km ASC
        LIMIT ${limit};
      `;
  
      res.json({ success: true, couriers });
    } catch (error) {
      console.error('Error fetching nearest couriers:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch nearest couriers' });
    }
  };
  
  

  // PATCH /orders/:id/status
  exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'status required' });
  
    try {
      const updated = await sql`
        UPDATE orders SET status = ${status}
        WHERE id = ${id}
        RETURNING *;
      `;
  
      if (!updated.length) return res.status(404).json({ message: 'Order not found' });
  
      const order = updated[0];
  
      // pull user fcm token
      const userRow = await sql`SELECT id, full_name, fcm_token FROM users WHERE id = ${order.user_id}`;
      const user = userRow[0];
  
      // store notification in DB
      const title = 'Order Update';
      const body = `Your order #${String(order.id).slice(0,6)} is now ${status}`;
  
      await sql`
        INSERT INTO notifications (user_id, title, body, data)
        VALUES (${order.user_id}, ${title}, ${body}, ${JSON.stringify({ type: 'order_status', orderId: order.id, status })})
      `;
  
      // send FCM if available
      if (user?.fcm_token) {
        await admin.messaging().send({
          token: user.fcm_token,
          notification: { title, body },
          data: { type: 'order_status', orderId: `${order.id}`, status },
        });
      }
  
      res.json({ message: 'Order status updated', order });
    } catch (err) {
      console.error('updateOrderStatus error', err);
      res.status(500).json({ message: 'Failed to update status' });
    }
  };

  exports.addLocation = async (req, res) => {
    try {
      const { name, address, latitude, longitude, region } = req.body;
  
      if (!name || !address) {
        return res.status(400).json({ message: 'Location name and address are required' });
      }
  
      // Ensure no undefined values; set defaults
      let lat = latitude ? parseFloat(latitude) : null;
      let lng = longitude ? parseFloat(longitude) : null;
      let reg = region !== undefined ? region : null;  // Prevents undefined
  
      // Check for duplicates
      const [existing] = await sql`SELECT * FROM locations WHERE address = ${address}`;
      if (existing) {
        return res.status(409).json({ message: 'Location with this address already exists' });
      }
  
      // Geocode if lat/lng not provided
      if (!lat || !lng) {
        try {
          const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
          const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`);
          if (response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            lat = location.lat;
            lng = location.lng;
          } else {
            return res.status(400).json({ message: 'Unable to geocode address. Please provide latitude and longitude manually.' });
          }
        } catch (geocodeErr) {
          console.error('Geocoding error:', geocodeErr);
          return res.status(500).json({ message: 'Geocoding failed. Try manual lat/lng.' });
        }
      }
  
      // Validate lat/lng (now they should be numbers)
      if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'Invalid latitude or longitude' });
      }
  
      const [location] = await sql`
        INSERT INTO locations (name, address, latitude, longitude, region)
        VALUES (${name}, ${address}, ${lat}, ${lng}, ${reg})
        RETURNING *
      `;
  
      res.status(201).json({ message: 'Location created successfully', location });
    } catch (err) {
      console.error('Error adding location:', err);
      res.status(500).json({ message: 'Failed to create location' });
    }
  };

  // ✅ Get all producers (for product creation dropdown)
// Add Producer (to producers table)
exports.addProducer = async (req, res) => {
  try {
    const { name, location_id } = req.body;

    if (!name || !location_id) {
      return res.status(400).json({ message: 'Producer name and location_id are required' });
    }

    // Validate location exists
    const [location] = await sql`SELECT id, latitude, longitude FROM locations WHERE id = ${location_id}`;
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Optional: Check if producer with same name in same location exists
    const [existing] = await sql`SELECT * FROM producers WHERE name = ${name} AND location_id = ${location_id}`;
    if (existing) {
      return res.status(409).json({ message: 'Producer with this name already exists in this location' });
    }

    let logoUrl = null;
    if (req.file) {
      // Same logo upload logic as before
      const imageBuffer = req.file.buffer;
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const bucket = admin.storage().bucket();
      const file = bucket.file(`producers/${fileName}`);

      await file.save(imageBuffer, {
        metadata: { contentType: req.file.mimetype },
      });

      [logoUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '03-09-2491',
      });
    }

    // Insert producer tied to location (inherit lat/lng)
    const [producer] = await sql`
      INSERT INTO producers (name, logo_url, latitude, longitude, location_id)
      VALUES (${name}, ${logoUrl}, ${location.latitude}, ${location.longitude}, ${location_id})
      RETURNING id, name, logo_url, latitude, longitude, location_id
    `;

    res.status(201).json({ message: 'Producer created successfully', producer });
  } catch (err) {
    console.error('Error adding producer:', err);
    res.status(500).json({ message: 'Failed to create producer' });
  }
};
  
  // Get All Producers (from producers table)
  exports.getAllProducers = async (req, res) => {
    try {
      const producers = await sql`
        SELECT 
          p.id, 
          p.name, 
          p.logo_url, 
          p.latitude, 
          p.longitude, 
          l.id AS location_id,  -- Added: Include location ID
          l.name AS location_name,  -- Existing: Readable location name
          p.created_at
        FROM producers p
        LEFT JOIN locations l ON p.location_id = l.id  -- JOIN to get location details
        ORDER BY p.created_at DESC
      `;
      res.status(200).json(producers);
    } catch (err) {
      console.error('Error fetching producers:', err);
      res.status(500).json({ error: 'Failed to fetch producers' });
    }
  };

  exports.getProductsByProducer = async (req, res) => {
    const { producerId } = req.params;
    if (!producerId) {
      return res.status(400).json({ message: "producerId is required" });
    }
    try {
      const products = await sql`
        SELECT p.id, p.name, p.description, p.unit, p.stock_quantity, p.image_url, p.weight_kg,
               COALESCE(
                 JSON_AGG(
                   JSON_BUILD_OBJECT(
                     'location_id', pl.location_id,
                     'location_name', l.name,
                     'price', pl.price,
                     'transport_cost', pl.transport_cost
                   )
                 ) FILTER (WHERE pl.location_id IS NOT NULL),
                 '[]'::json
               ) AS locations
        FROM products p
        LEFT JOIN product_locations pl ON p.id = pl.product_id
        LEFT JOIN locations l ON pl.location_id = l.id
        WHERE p.producer_id = ${producerId}
        GROUP BY p.id, p.name, p.description, p.unit, p.stock_quantity, p.image_url, p.weight_kg
        ORDER BY p.created_at DESC
      `;
      res.status(200).json(products);
    } catch (err) {
      console.error('Error fetching products:', err);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  };
  // controllers/adminController.js

  exports.addProduct = async (req, res) => {
    try {
      const {
        name,
        description,
        unit,
        price,  // Added: Accept price as top-level field
        stock_quantity,
        producer_id,
        category_slug,
        category_name,
        locations,
        producer_location,
        weightKg
      } = req.body;
  
      // Parse locations if it's a string
      let parsedLocations = [];
      if (locations) {
        parsedLocations = typeof locations === 'string' ? JSON.parse(locations) : locations;
      }
  
      if (!name || !stock_quantity || !unit || !producer_id || !category_slug || !price || parsedLocations.length === 0) {
        return res.status(400).json({ message: 'Missing required fields (name, stock_quantity, unit, producer_id, category_slug, price, and at least one location)' });
      }
  
      // Validate at least 2 images
      if (!req.files || req.files.length < 2) {
        return res.status(400).json({ message: 'At least 2 image files are required' });
      }
  
      // Validate producer exists
      const [producer] = await sql`SELECT id FROM producers WHERE id = ${producer_id}`;
      if (!producer) {
        return res.status(404).json({ message: 'Producer not found' });
      }
  
      // Upload multiple images to Firebase Storage
      const imageUrls = [];
      for (const file of req.files) {
        const imageBuffer = file.buffer;
        const fileName = `${Date.now()}-${file.originalname}`;
        const bucket = admin.storage().bucket();
        const firebaseFile = bucket.file(`products/${fileName}`);
        await firebaseFile.save(imageBuffer, {
          metadata: { contentType: file.mimetype },
        });
        const [imageUrl] = await firebaseFile.getSignedUrl({
          action: 'read',
          expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        });
        imageUrls.push(imageUrl);
      }
  
      // Update producer with location if provided (optional)
      if (producer_location && producer_location.lat && producer_location.lng) {
        await sql`
          UPDATE producers
          SET latitude = ${producer_location.lat}, longitude = ${producer_location.lng}
          WHERE id = ${producer_id}
        `;
      }
  
    // Get or create category
let category = await sql`SELECT id FROM categories WHERE slug = ${category_slug}`;
if (!category || category.length === 0) {
  const categoryName = category_name || category_slug;
  // Check if a category with this name already exists (to avoid duplicate name error)
  const existingByName = await sql`SELECT id, slug FROM categories WHERE name = ${categoryName}`;
  if (existingByName && existingByName.length > 0) {
    category = existingByName[0];  // Reuse existing category
  } else {
    const [newCategory] = await sql`
      INSERT INTO categories (name, slug)
      VALUES (${categoryName}, ${category_slug})
      RETURNING *
    `;
    category = newCategory;
  }
} else {
  category = category[0];
}
  
      const created_by = req.admin?.id || 'e73622f4-7dde-4d15-8d4c-0bc764c4cf52';
  
      // Insert product (store single image URL and price)
      const imageUrl = imageUrls[0] || null;  // Store only the first image URL
  
      try {
        const result = await sql`
          INSERT INTO products (
            name,
            description,
            unit,
            price,
            stock_quantity,
            image_url,
            producer_id,
            category_id,
            created_by,
            weight_kg
          )
          VALUES (
            ${name},
            ${description},
            ${unit},
            ${parseFloat(price)},
            ${stock_quantity},
            ${imageUrl},
            ${producer_id},
            ${category.id},
            ${created_by},
            ${weightKg || 1}
          )
          RETURNING *
        `;
  
        const product = result[0];
        if (!product) {
          throw new Error('Product insert failed - no row returned');
        }
  
        // Insert into product_locations for each location (with price)
        for (const loc of parsedLocations) {
          if (!loc.locationId) {
            return res.status(400).json({ message: 'Each location must have locationId' });
          }
  
          // Validate location exists
          const [existingLoc] = await sql`SELECT 1 FROM locations WHERE id = ${loc.locationId}`;
          if (!existingLoc) {
            return res.status(400).json({ message: `Invalid locationId: ${loc.locationId} does not exist` });
          }
  
          // Update locations table with lat/lng if provided
          if (loc.lat && loc.lng) {
            await sql`
              UPDATE locations
              SET latitude = ${loc.lat}, longitude = ${loc.lng}
              WHERE id = ${loc.locationId}
            `;
          }
  
          // Updated: Include price in product_locations INSERT
          await sql`
            INSERT INTO product_locations (product_id, location_id, price, transport_cost)
            VALUES (${product.id}, ${loc.locationId}, ${parseFloat(price)}, ${loc.transportCost || 0})
          `;
        }
  
        res.status(201).json({ message: 'Product added successfully with locations', product });
      } catch (insertError) {
        console.error('Insert error:', insertError);  // Log DB insert error
        throw insertError;  // Re-throw to outer catch
      }
    } catch (err) {
      console.error('❌ Add product error:', err);
      res.status(500).json({ message: 'Failed to add product' });
    }
  };
  
  exports.calculateTransport = async (req, res) => {
    const { originLat, originLng, destLat, destLng, weightKg = 1, baseCost = 0, productId } = req.body;  // Added productId for context
    try {
      // Validate inputs
      if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: 'Missing required coordinates (originLat, originLng, destLat, destLng)' });
      }
  
      const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
      if (!GOOGLE_API_KEY) {
        return res.status(500).json({ error: 'Google API key not configured' });
      }
  
      const response = await axios.get(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${GOOGLE_API_KEY}`);
      
      // Check API response status
      if (response.data.status !== 'OK') {
        return res.status(400).json({ error: `Google API error: ${response.data.status}` });
      }
  
      const element = response.data.rows[0]?.elements[0];
      if (!element || element.status !== 'OK') {
        return res.status(400).json({ error: 'No route found or invalid coordinates' });
      }
  
      const distanceKm = element.distance.value / 1000;
  
      // Transport methods (can be adjusted for realism)
      const methods = [
        { name: 'Motorcycle', capacity: 5, ratePerKm: 2, loadFactor: 0.5 },
        { name: 'Cab', capacity: 50, ratePerKm: 5, loadFactor: 1 },
        { name: 'Bus', capacity: Infinity, ratePerKm: 10, loadFactor: 2 }
      ];
  
      let selectedMethod = methods[0];
      for (const method of methods) {
        if (weightKg <= method.capacity) {
          selectedMethod = method;
          break;
        }
      }
  
      const distanceCost = distanceKm * selectedMethod.ratePerKm;
      const loadCost = weightKg * selectedMethod.loadFactor;
      const totalCost = distanceCost + loadCost + baseCost;
  
      res.json({
        productId,  // Include for linking
        distanceKm,
        method: selectedMethod.name,
        estimatedCost: totalCost,
        breakdown: { distanceCost, loadCost, baseCost }
      });
    } catch (err) {
      console.error('Transport calculation error:', err);
      res.status(500).json({ error: 'Failed to calculate transport' });
    }
  };
  // ✅ Get all locations (for dropdowns in frontend)
exports.getAllLocations = async (req, res) => {
  try {
    const locations = await sql`
      SELECT id, name, address, latitude, longitude, region
      FROM locations
      ORDER BY name ASC
    `;
    res.status(200).json(locations);
  } catch (err) {
    console.error('Error fetching locations:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
};
  
// PROMO CODE: Validate
exports.validatePromoCode = async (req, res) => {
    const { code } = req.body;
  
    try {
      const [promo] = await sql`
        SELECT * FROM promo_codes
        WHERE code = ${code}
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
      `;
  
      if (!promo) {
        return res.status(404).json({ message: 'Invalid or expired promo code' });
      }
  
      if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
        return res.status(400).json({ message: 'Promo code has been fully used' });
      }
  
      return res.status(200).json({ promo });
    } catch (error) {
      console.error('Validate promo error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  };
  
  // PROMO CODE: Redeem after order
  exports.redeemPromoCode = async (req, res) => {
    const { userId, code, orderId } = req.body;
  
    try {
      const [promo] = await sql`
        SELECT * FROM promo_codes WHERE code = ${code}
      `;
  
      if (!promo || !promo.is_active) {
        return res.status(400).json({ message: 'Promo code not valid' });
      }
  
      // Track redemption
      await sql`
        INSERT INTO promo_redemptions (user_id, promo_code_id, order_id)
        VALUES (${userId}, ${promo.id}, ${orderId})
      `;
  
      // Increment usage
      await sql`
        UPDATE promo_codes
        SET uses_count = uses_count + 1
        WHERE id = ${promo.id}
      `;
  
      return res.status(200).json({ message: 'Promo redeemed successfully' });
    } catch (error) {
      console.error('Redeem promo error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  };
  
  // GET notifications by role and user
  let ioInstance;

  exports.initSocketIO = (io) => {
    ioInstance = io;
  };
  
  // GET notifications by userId (no socket needed)
  exports.getNotifications = async (req, res) => {
    const { userId } = req.query;
  
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId query parameter' });
    }
  
    try {
      const notifications = await sql`
        SELECT id, user_id, title, body, data, read, created_at
        FROM notifications
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
  
      res.status(200).json({ notifications });
    } catch (err) {
      console.error('Error fetching notifications:', err);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  };
  
  // CREATE new notification with socket emit
  exports.createNotification = async (input, res = null) => {
    const { userId, title, body, data } = input.userId ? input : input.body;
  
    if (!userId || !title || !body) {
      if (res) return res.status(400).json({ error: 'Missing userId, title or body' });
      throw new Error('Missing userId, title or body');
    }
  
    try {
      const inserted = await sql`
        INSERT INTO notifications (user_id, title, body, data, read, created_at)
        VALUES (${userId}, ${title}, ${body}, ${data || null}, false, NOW())
        RETURNING id, user_id, title, body, data, read, created_at
      `;
  
      const newNotification = inserted[0];
  
      if (ioInstance) {
        ioInstance.to(`user_${userId}`).emit('newNotification', newNotification);
      }
  
      if (res) {
        return res.status(201).json({ message: 'Notification created', notification: newNotification });
      } else {
        return newNotification;
      }
    } catch (error) {
      console.error('Error creating notification:', error);
      if (res) {
        return res.status(500).json({ error: 'Failed to create notification' });
      } else {
        throw error;
      }
    }
  };

  
  // MARK notification as read
  exports.markNotificationAsRead = async (req, res) => {
    const { id } = req.params;
  
    if (!id) {
      return res.status(400).json({ error: 'Missing notification id in URL' });
    }
  
    try {
      const result = await sql`
        UPDATE notifications
        SET read = true
        WHERE id = ${id}
        RETURNING id
      `;
  
      if (!result || result.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }
  
      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      console.error('Error updating notification:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  };
  


  // adminController.js or shared userController.js
exports.updateAccountInfo = async (req, res) => {
    const { userId, name, email } = req.body;
  
    try {
      await sql`
        UPDATE users
        SET name = ${name}, email = ${email}
        WHERE id = ${userId}
      `;
  
      res.status(200).json({ message: 'Account updated successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update account info' });
    }
  };

// controllers/ratingController.js
exports.rateCourier = async (req, res) => {
  try {
    const { courierId, orderId, rating, feedback, skipped } = req.body;
    const userId = req.user.id; // from verifyToken

    if (!courierId || !orderId)
      return res.status(400).json({ message: "Missing courierId or orderId" });

    // Ensure user owns this order
    const order = await db.Order.findOne({ where: { id: orderId, userId } });
    if (!order) return res.status(403).json({ message: "Unauthorized action" });

    // Prevent double rating
    const existingRating = await db.Rating.findOne({ where: { orderId } });
    if (existingRating)
      return res.status(400).json({ message: "Order already rated or skipped" });

    // Record rating or skip
    const newRating = await db.Rating.create({
      courierId,
      userId,
      orderId,
      rating: skipped ? null : rating,
      feedback,
      skipped,
    });

    // Update courier performance only if not skipped
    if (!skipped && rating) {
      const courier = await db.Courier.findByPk(courierId);
      if (courier) {
        courier.totalRatings += 1;
        courier.ratingSum += rating;
        courier.averageRating = courier.ratingSum / courier.totalRatings;
        courier.weeklyPoints += rating * 10; // ⭐ 10 pts per star
        await courier.save();
      }
    }

    // Mark order as rated or skipped
    await db.Order.update(
      { ratingStatus: skipped ? "skipped" : "rated" },
      { where: { id: orderId } }
    );

    res.status(201).json({
      success: true,
      message: skipped
        ? "You skipped rating this courier."
        : "Courier rated successfully!",
      data: newRating,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

  

//   change password
exports.changePassword = async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;

  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Get the current password hash
    const userResult = await sql`
      SELECT password FROM users WHERE id = ${userId}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    // 2. Check if password hash exists (fix for the bcrypt error)
    if (!user.password) {
      console.error(`Password hash missing for user ID: ${userId}`);  // Log for debugging
      return res.status(400).json({ error: 'Password not set for this user. Please reset your password.' });
    }

    // 3. Compare with current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    // 4. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 5. Update in DB
    await sql`
      UPDATE users SET password = ${hashedPassword} WHERE id = ${userId}
    `;

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

//   change phone number
exports.changePhoneNumber = async (req, res) => {
    const { userId, phone } = req.body;
  
    try {
      await sql`
        UPDATE users SET phone = ${phone}
        WHERE id = ${userId}
      `;
  
      res.status(200).json({ message: 'Phone number updated successfully' });
    } catch (err) {
      console.error('Error updating phone:', err);
      res.status(500).json({ error: 'Server error updating phone number' });
    }
  };
  

  // =============================
// ✅ GET ALL CATEGORIES
// =============================
exports.getCategories = async (req, res) => {
  try {
    const categories = await sql`
      SELECT id, name, slug FROM categories ORDER BY name ASC;
    `;

    res.json({
      success: true,
      data: categories,
      message: 'Categories fetched successfully',
    });
  } catch (err) {
    console.error('❌ Error fetching categories:', err);
    res.status(500).json({ success: false, message: 'Internal server error fetching categories' });
  }
};
  
  
  // =============================
  // ✅ GET PRODUCTS BY CATEGORY ID
  // =============================
  // GET /api/admin/products/category/:categoryId
  exports.getProductsByCategory = async (req, res) => {
    try {
      const { categoryId } = req.params;
  
      if (!categoryId) {
        return res.status(400).json({ message: 'categoryId is required' });
      }
  
      const products = await sql`
        SELECT * FROM products WHERE category_id = ${categoryId}
      `;
  
      res.status(200).json(products);
    } catch (error) {
      console.error('Error fetching products by category:', error);
      res.status(500).json({ message: 'Failed to fetch products for category', error: error.message });
    }
  };
  


  exports.getProducersByCategory = async (req, res) => {
    try {
      const { categoryId } = req.params;
      const { sort_by = 'name_asc', user_lat, user_lng, limit = 10, offset = 0 } = req.query;
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);
  
      // Validate category exists
      const [category] = await sql`SELECT id FROM categories WHERE id = ${categoryId}`;
      if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
  
      // Validate location for distance sorting
      let distanceSort = sort_by === 'distance_asc';
      if (distanceSort && (!user_lat || !user_lng)) {
        return res.status(400).json({ success: false, message: 'user_lat and user_lng required for distance sorting' });
      }
  
      // Build ORDER BY dynamically (safe for postgres.js)
      let orderBy = 'p.name ASC';  // Default
      if (distanceSort) {
        orderBy = 'distance_km ASC';
      }
  
      // Execute query with conditional elements (no append needed)
      const producers = await sql`
        SELECT DISTINCT 
          p.id, p.name, p.location, p.phone, p.logo_url, p.latitude, p.longitude,
          CASE WHEN ${distanceSort} THEN 
            (6371 * acos(cos(radians(${parseFloat(user_lat)})) * cos(radians(p.latitude)) * cos(radians(p.longitude - ${parseFloat(user_lng)})) + sin(radians(${parseFloat(user_lat)})) * sin(radians(p.latitude))))
          ELSE NULL END AS distance_km
        FROM producers p
        INNER JOIN products pr ON p.id = pr.producer_id
        WHERE pr.category_id = ${categoryId} AND pr.available = true
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `;
  
      // Format distance
      producers.forEach(p => { if (p.distance_km) p.distance_km = parseFloat(p.distance_km.toFixed(2)); });
  
      res.json({
        success: true,
        data: producers,
        pagination: { total: producers.length, limit: limitNum, offset: offsetNum },
        message: 'Producers fetched successfully',
      });
    } catch (err) {
      console.error('❌ Error fetching producers:', err);
      res.status(500).json({ success: false, message: 'Internal server error fetching producers' });
    }
  };


  exports.getProductsByProducer = async (req, res) => {
    try {
      const { producerId } = req.params;
      const { sort_by = 'name_asc', limit = 10, offset = 0 } = req.query;
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);
  
      // Validate producer exists and get details
      const [producer] = await sql`
        SELECT id, name, location, latitude, longitude FROM producers WHERE id = ${producerId}
      `;
      if (!producer) return res.status(404).json({ success: false, message: 'Producer not found' });
  
      // Build ORDER BY dynamically (safe for postgres.js)
      let orderBy = 'pr.name ASC';  // Default
      if (sort_by === 'price_desc') orderBy = 'pr.price DESC';
      // Add more if needed
  
      // Execute query with conditional elements (no append needed)
      const products = await sql`
        SELECT 
          pr.id, pr.name, pr.description, pr.price, pr.stock_quantity, pr.image_url, pr.weight_kg,
          pl.transport_cost
        FROM products pr
        LEFT JOIN product_locations pl ON pr.id = pl.product_id
        WHERE pr.producer_id = ${producerId} AND pr.available = true
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `;
  
      // Format data
      products.forEach(p => {
        p.price = parseFloat(p.price);
        p.transport_cost = parseFloat(p.transport_cost || 0);
        p.total_estimated_cost = p.price + p.transport_cost;  // For planning
      });
  
      res.json({
        success: true,
        data: { producer: producer, products: products },
        pagination: { total: products.length, limit: limitNum, offset: offsetNum },
        message: 'Products fetched successfully',
      });
    } catch (err) {
      console.error('❌ Error fetching products:', err);
      res.status(500).json({ success: false, message: 'Internal server error fetching products' });
    }
  };


  exports.searchProducts = async (req, res) => {
    try {
      const { search, limit = 10, offset = 0 } = req.query;
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);
  
      if (!search || search.trim().length < 2) {
        return res.json({ success: true, data: [], message: 'Search query too short' });
      }
  
      // Search products by name (case-insensitive), include producer details
      const products = await sql`
        SELECT 
          pr.id, pr.name, pr.description, pr.price, pr.stock_quantity, pr.image_url, pr.weight_kg,
          p.id AS producer_id, p.name AS producer_name, p.location
        FROM products pr
        INNER JOIN producers p ON pr.producer_id = p.id
        WHERE pr.available = true AND LOWER(pr.name) LIKE LOWER(${`%${search}%`})
        ORDER BY pr.name ASC
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `;
  
      res.json({
        success: true,
        data: products,
        message: 'Products searched successfully',
      });
    } catch (err) {
      console.error('❌ Error searching products:', err);
      res.status(500).json({ success: false, message: 'Internal server error searching products' });
    }
  };


  exports.getAllProducts = async (req, res) => {
    try {
      const products = await sql`
        SELECT 
          pr.id, pr.name, pr.description, pr.price, pr.stock_quantity, pr.image_url, pr.weight_kg, pr.unit,
          p.id AS producer_id, p.name AS producer_name, p.location, p.latitude, p.longitude
        FROM products pr
        INNER JOIN producers p ON pr.producer_id = p.id
        WHERE pr.available = true
        ORDER BY pr.name ASC
      `;
      res.json({ success: true, data: products, message: 'All products fetched successfully' });
    } catch (err) {
      console.error('❌ Error fetching all products:', err);
      res.status(500).json({ success: false, message: 'Internal server error fetching products' });
    }
  };

  const crypto = require('crypto');
  const flutterwave = require('../utils/flutterwave');
  
  

  // Helper: Create order and order items in DB
  async function createOrder(user_id, items) {
    const orderId = uuidv4();
  
    // Calculate total amount from items (assuming you have a products table)
    let totalAmount = 0;
  
    for (const item of items) {
      const product = await sql`SELECT price FROM products WHERE id = ${item.product_id}`;
      if (!product.length) throw new Error(`Product not found: ${item.product_id}`);
      totalAmount += product[0].price * item.quantity;
    }
  
    // Insert order
    await sql`
      INSERT INTO orders (id, user_id, total, status, created_at)
      VALUES (${orderId}, ${user_id}, ${totalAmount}, 'pending', NOW())
    `;
  
    // Insert order items
    for (const item of items) {
      const product = await sql`SELECT price FROM products WHERE id = ${item.product_id}`;
      const price = product[0].price;
  
      await sql`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
        VALUES (${orderId}, ${item.product_id}, ${item.quantity}, ${price}, ${price * item.quantity})
      `;
    }
  
    return { orderId, totalAmount };
  }
  
  exports.createPaymentLink = async (req, res) => {
    try {
      const {
        user_id,
        order_id,
        items,
        email,
        name,
        phone,
        delivery_address,
        payment_type = 'order',
      } = req.body;
  
      // Validate input
      if (!user_id || !/^[0-9a-fA-F-]{36}$/.test(user_id)) {
        return res.status(400).json({ error: 'Valid user_id is required' });
      }
      if (!['order', 'delivery'].includes(payment_type)) {
        return res.status(400).json({ error: 'Invalid payment_type' });
      }
  
      let totalAmount = 0;
  
      // Calculate total for ORDER payments
      if (payment_type === 'order') {
        if (!items?.length) return res.status(400).json({ error: 'Items are required for order payment' });
        if (!delivery_address) return res.status(400).json({ error: 'Delivery address required' });
  
        let subtotal = 0;
        const uniqueProducts = new Set();
  
        for (const item of items) {
          const [product] = await sql`SELECT price FROM products WHERE id = ${item.product_id}`;
          if (!product) throw new Error(`Product not found: ${item.product_id}`);
  
          subtotal += Number(product.price) * Number(item.quantity);
          uniqueProducts.add(item.product_id);
        }
  
        const vat = Math.round(subtotal * 0.075);
        const appFee = Math.round(uniqueProducts.size * 1000);
        totalAmount = Math.round(subtotal + vat + appFee);
      }
  
      // Handle DELIVERY payments
      else if (payment_type === 'delivery') {
        if (!order_id) return res.status(400).json({ error: 'order_id required for delivery payment' });
  
        const [existingOrder] = await sql`SELECT delivery_fee FROM orders WHERE id = ${order_id}`;
        if (!existingOrder) return res.status(404).json({ error: 'Order not found' });
  
        totalAmount = Number(existingOrder.delivery_fee);
  
        // ✅ Bug 3 fix — guard against zero/null delivery fee
        if (!totalAmount || totalAmount <= 0) {
          return res.status(400).json({ error: 'Delivery fee is not set for this order' });
        }
      }
  
      // Generate tx_ref
      let tx_ref;
      if (order_id) {
        tx_ref = `order-${Date.now()}-${order_id}`;
      } else {
        const tempOrderId = crypto.randomUUID(); // ✅ Bug 2 fix — crypto now imported
        tx_ref = `order-${Date.now()}-${tempOrderId}`;
      }
  
      // Flutterwave Payment Link
      const payload = {
        tx_ref,
        amount: Number(totalAmount.toFixed(2)),
        currency: 'NGN',
        redirect_url: 'oluwoflomobile://payment-success',
        customer: {
          email: email || 'zoyaprocurementcompany@gmail.com',
          name: name || 'Valued Customer',
          phonenumber: phone || '08000000000',
        },
        customizations: {
          title: payment_type === 'order' ? 'Zoya Order Payment' : 'Zoya Delivery Payment',
          description:
            payment_type === 'order'
              ? `Payment for order (VAT + Service Fee included)`
              : `Delivery fee for order ${order_id}`,
        },
      };
  
      console.log('🟢 [createPaymentLink] Flutterwave Payload:', payload);
  
      const fwRes = await axios.post('https://api.flutterwave.com/v3/payments', payload, {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!fwRes.data || fwRes.data.status !== 'success') {
        console.error('❌ Flutterwave rejected:', fwRes.data);
        return res.status(400).json({
          error: fwRes.data?.message || 'Failed to create payment link',
          details: fwRes.data,
        });
      }
  
      // ✅ Bug 4 fix — safe JSON stringify for items
      const itemsToSave = typeof items === 'string' ? items : JSON.stringify(items || []);
  
      const paymentId = uuidv4();
      await sql`
        INSERT INTO payments (
          id, order_id, user_id, amount, status, tx_ref,
          payment_type, items, delivery_address, phone, name, email, created_at
        )
        VALUES (
          ${paymentId},
          ${order_id || null},
          ${user_id},
          ${totalAmount},
          'pending',
          ${tx_ref},
          ${payment_type},
          ${itemsToSave},
          ${delivery_address || ''},
          ${phone || ''},
          ${name || ''},
          ${email || ''},
          NOW()
        )
      `;
  
      return res.status(200).json({
        success: true,
        payment_id: paymentId,
        payment_type,
        payment_url: fwRes.data.data.link,
        tx_ref,
        total_amount: totalAmount,
      });
  
    } catch (err) {
      console.error('❌ createPaymentLink error (deep):', {
        message: err.message,
        data: err.response?.data,
        stack: err.stack,
      });
      return res.status(500).json({
        error: err.response?.data?.message || err.message || 'Internal server error',
      });
    }
  };
  // ============================
  // 🚀 1. Initiate Payment (legacy)
  // ============================
  exports.initiatePayment = async (req, res) => {
    try {
      const { amount, user_id, order_id, email, name, phone, payment_type = 'order' } = req.body;
  
      if (!amount || !user_id || !order_id) {
        return res.status(400).json({ message: 'Missing required payment fields' });
      }
  
      if (!['order', 'delivery'].includes(payment_type)) {
        return res.status(400).json({ message: 'Invalid payment_type' });
      }
  
      const tx_ref = `${payment_type}-${Date.now()}-${uuidv4()}`;
  
      // 1️⃣ Create Flutterwave payment
      const response = await axios.post(
        'https://api.flutterwave.com/v3/payments',
        {
          tx_ref,
          amount,
          currency: 'NGN',
          payment_options: 'card,banktransfer,ussd',
          customer: { email, name, phonenumber: phone },
          customizations: {
            title: payment_type === 'order' ? 'Zoya Order Payment' : 'Zoya Delivery Payment',
            description: payment_type === 'order' ? `Payment for order ${order_id}` : `Delivery fee for order ${order_id}`,
            logo: 'https://zoyaprocurement.com/logo.png',
          },
          redirect_url: `${process.env.FRONTEND_URL}/payment-success?order_id=${order_id}&payment_type=${payment_type}`,
        },
        {
          headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        }
      );
  
      // 2️⃣ Save payment in DB
      await sql`
        INSERT INTO payments (id, order_id, user_id, amount, status, payment_reference, payment_type, created_at)
        VALUES (${uuidv4()}, ${order_id}, ${user_id}, ${amount}, 'pending', ${tx_ref}, ${payment_type}, NOW())
      `;
  
      return res.status(200).json({
        success: true,
        payment_url: response.data.data.link,
        tx_ref,
        payment_type,
      });
  
    } catch (err) {
      console.error('❌ initiatePayment error:', err.response?.data || err.message);
      return res.status(500).json({ message: 'Failed to initiate payment' });
    }
  };
  
  
 // ============================
// ✅ 2. Verify Payment (Manual)
// ============================
// ============================
// ✅ 2. Verify Payment (Manual)
// ============================
exports.verifyPayment = async (req, res) => {
  try {
    const { tx_ref } = req.query;
    if (!tx_ref) return res.status(400).json({ message: 'tx_ref is required' });

    console.log('🔍 Verifying payment for tx_ref:', tx_ref);

    // 1️⃣ Find payment
    const [payment] = await sql`SELECT * FROM payments WHERE tx_ref = ${tx_ref}`;
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    console.log('📋 Full payment record:', payment);  // Log the entire payment object

    if (payment.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Payment already verified', payment });
    }

    // 2️⃣ Verify with Flutterwave
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );

    const paymentData = response.data?.data;
    if (!paymentData) throw new Error('Invalid verification response');

    console.log('🔄 Flutterwave status:', paymentData.status);

    // 3️⃣ Map status
    const fwStatus = (paymentData.status || '').toLowerCase();
    let newStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) newStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) newStatus = 'cancelled';
    else if (fwStatus === 'pending') newStatus = 'pending';
    else newStatus = 'cancelled';

    // 4️⃣ Update payment status
    await sql`
      UPDATE payments
      SET status = ${newStatus}, updated_at = NOW()
      WHERE tx_ref = ${tx_ref}
    `;

    // 5️⃣ Create order only if completed
// 5️⃣ Create order only if completed
if (newStatus === 'completed' && payment.payment_type === 'order') {
  // Parse items from JSON string to array
  const items = JSON.parse(payment.items || '[]');
  if (!items?.length) throw new Error('No items found for order creation');

  console.log('📦 Parsed items:', items);  // Log to confirm parsing

  // Set safe defaults to handle undefined/null
  const safeFields = {
    delivery_address: payment.delivery_address ?? '',
    phone: payment.phone ?? '',
    name: payment.name ?? '',
    email: payment.email ?? '',
  };

  // Ensure amount is a number
  const amountNumber = Number(payment.amount) || 0;

  // Log all VALUES for debugging
  const valuesArray = [
    payment.user_id,
    'paid',
    safeFields.delivery_address,
    safeFields.phone,
    safeFields.name,
    safeFields.email,
    tx_ref,
    amountNumber
  ];
  console.log('📝 Full VALUES array for orders INSERT:', valuesArray);

  await sql.begin(async (tx) => {
    const [newOrder] = await tx`
      INSERT INTO orders (user_id, status, delivery_address, phone_number, name, email, payment_reference, total_amount)
      VALUES (
        ${payment.user_id}, 
        'paid', 
        ${safeFields.delivery_address}, 
        ${safeFields.phone}, 
        ${safeFields.name}, 
        ${safeFields.email}, 
        ${tx_ref}, 
        ${amountNumber}
      )
      RETURNING id
    `;

    for (const item of items) {
      console.log('🔍 Processing item:', item);  // Log each item
      const [product] = await tx`SELECT price FROM products WHERE id = ${item.product_id}`;
      if (!product) throw new Error(`Product not found: ${item.product_id}`);

      const itemTotal = Number(product.price) * Number(item.quantity);
      await tx`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
        VALUES (${newOrder.id}, ${item.product_id}, ${item.quantity}, ${product.price}, ${itemTotal})
      `;
    }

    // Send notification
    await exports.createNotification({
      userId: payment.user_id,
      title: 'Order Placed Successfully',
      body: `Your order #${newOrder.id} has been placed. Total: ₦${amountNumber}. You'll receive updates soon.`,
      data: { order_id: newOrder.id },
    });
  });
}

    return res.status(200).json({ success: true, status: newStatus, payment });
  } catch (err) {
    console.error('❌ verifyPayment error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'Failed to verify payment' });
  }
};
  // ============================
  // 🏦 3. Create Virtual Account
  // ============================
  exports.createFlutterwaveVirtualAccount = async (req, res) => {
    try {
      const { email, bvn, first_name, last_name, phone } = req.body;
  
      const response = await flutterwave.post('/virtual-account-numbers', {
        email,
        is_permanent: true,
        bvn,
        tx_ref: `ZoyaAcct-${Date.now()}`,
        phonenumber: phone,
        firstname: first_name,
        lastname: last_name,
      });
  
      return res.status(200).json({
        success: true,
        virtualAccount: response.data.data,
      });
    } catch (err) {
      console.error('❌ [Virtual Account Error]', err.response?.data || err.message);
      res.status(500).json({ message: 'Failed to create virtual account' });
    }
  };
  
  // ============================
  // 🔁 4. Flutterwave Webhook
  // ============================
  exports.flutterwaveWebhook = async (req, res) => {
    try {
      const hash = req.headers['verif-hash'];
      if (!hash || hash !== FLW_SECRET_HASH) {
        console.log('⚠️ Invalid Flutterwave signature');
        return res.status(401).send('Unauthorized');
      }
  
      const payload = JSON.parse(req.body.toString('utf8'));
      console.log('✅ Webhook received:', payload);
  
      if (payload.event === 'charge.completed') {
        const data = payload.data;
        const status = data?.status;
        const txRef = data?.tx_ref;
        const flwRef = data?.id;
        const amount = data?.amount;
        const email = data?.customer?.email;
  
        console.log({ status, txRef, flwRef, amount, email });
  
        if (status === 'successful' && txRef && flwRef) {
          await sql`
            UPDATE payments
            SET status = 'successful', payment_reference = ${flwRef}
            WHERE payment_reference = ${txRef};
          `;
        } else {
          console.warn('⚠️ Skipped DB update due to missing values');
        }
      }
  
      return res.status(200).send('Webhook received');
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).send('Server error');
    }
  };


  // in adminController.js
exports.saveFcmToken = async (req, res) => {
    const userId = req.user?.id || req.body.user_id; // adapt to your auth
    const { fcmToken } = req.body;
    if (!userId || !fcmToken) return res.status(400).json({ message: 'Missing fields' });
  
    try {
      await sql`UPDATE users SET fcm_token = ${fcmToken} WHERE id = ${userId}`;
      res.json({ success: true });
    } catch (err) {
      console.error('Error saving fcm token:', err);
      res.status(500).json({ message: 'Failed to save token' });
    }
  };



  exports.availableCouriers = async (req, res) => {
    try {
      const couriers = await sql`
        SELECT u.id, u.full_name, u.phone, d.current_location
        FROM users u
        JOIN deliveries d ON u.id = d.courier_id
        WHERE u.role = 'courier' 
        AND d.status = 'pending'
      `;
      res.json(couriers);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error fetching couriers' });
    }
  };
  
  exports.nearestCourier = async (req, res) => {
    const { orderId } = req.params;
    try {
      const [orderLocation] = await sql`
        SELECT destination_location
        FROM orders
        WHERE id = ${orderId}
      `;
      if (!orderLocation) return res.status(404).json({ error: 'Order not found' });
  
      const nearestCourier = await sql`
        SELECT u.id, u.full_name, u.phone, d.current_location,
        ST_Distance(d.current_location, ${orderLocation.destination_location}) AS distance
        FROM users u
        JOIN deliveries d ON u.id = d.courier_id
        WHERE u.role = 'courier' 
        AND d.status = 'pending'
        ORDER BY distance ASC
        LIMIT 1
      `;
      res.json(nearestCourier[0] || {});
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error finding nearest courier' });
    }
  };
  





// controllers/courierController.js

exports.getCourierDashboard = async (req, res) => {
  try {
    const userId = req.params.courierId;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const [courier] = await sql`
      SELECT id FROM couriers WHERE user_id = ${userId}
    `;
    if (!courier) {
      return res.status(404).json({ success: false, message: "Courier not found" });
    }
    const courierId = courier.id;

    const fetchByStatus = async (statuses) => {
      const rows = await sql`
        SELECT
          d.id AS delivery_id,
          d.order_id,
          d.status,
          d.delivery_fee,
          d.fee,
          d.bonus,
          d.points_awarded,
          d.pickup_address,
          d.dropoff_address,
          d.distance_km,
          u.full_name AS user_name,
          u.phone AS user_phone
        FROM deliveries d
        JOIN orders o ON o.id = d.order_id
        JOIN users u ON o.user_id = u.id
        WHERE d.courier_id = ${courierId}
        AND d.status = ANY(${statuses})
        ORDER BY d.updated_at DESC
      `;

      for (const row of rows) {
        row.items = await sql`
          SELECT
            oi.product_id,
            p.name AS product_name,
            oi.quantity,
            oi.total_price
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ${row.order_id}
        `;
      }

      return rows;
    };

    const pendingOrders = await fetchByStatus(["pending", "enroute"]);
    const inProgressOrders = await fetchByStatus(["in_transit"]);
    const completedOrders = await fetchByStatus(["delivered"]);
    const cancelledOrders = await fetchByStatus(["cancelled"]);

    const [stats] = await sql`
      SELECT
        COALESCE(SUM(fee + bonus), 0) AS earnings,
        COALESCE(SUM(points_awarded), 0) AS points,
        COUNT(*) FILTER (WHERE status = 'delivered') AS completed_count
      FROM deliveries
      WHERE courier_id = ${courierId}
    `;

    res.json({
      success: true,
      pendingOrders,
      inProgressOrders,
      completedOrders,
      cancelledOrders,
      stats: {
        earnings: Number(stats.earnings),
        points: Number(stats.points),
        completedCount: Number(stats.completed_count),
      },
    });

  } catch (err) {
    console.error("Courier dashboard error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch courier dashboard" });
  }
};

  

  // controllers/deliveries.js
  exports.pickupOrder = async (req, res) => {
    try {
      const userId = req.user?.id;
      const { delivery_id } = req.params;
  
      if (!userId) return res.status(401).json({ success: false, message: "Invalid user token" });
      if (!delivery_id) return res.status(400).json({ success: false, message: "Delivery ID required" });
  
      // Map user -> courier
      const [courier] = await sql`SELECT id FROM couriers WHERE user_id = ${userId} LIMIT 1`;
      if (!courier) return res.status(404).json({ success: false, message: "Courier not found for this user" });
      const courierId = courier.id;
  
      // Fetch delivery
      const [delivery] = await sql`
        SELECT id AS delivery_id, order_id, status, pickup_address, dropoff_address
        FROM deliveries
        WHERE id = ${delivery_id}
          AND courier_id = ${courierId}
        LIMIT 1
      `;
      if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found" });
  
      // Only allow pickup when buyer has paid (status = 'enroute')
      if (!['pending', 'enroute'].includes(delivery.status)) {
        return res.status(400).json({ 
          success: false, 
          message: `Cannot pick up delivery with status: ${delivery.status}` 
        });
      }
      // Update deliveries -> in_transit (and set picked_up_at)
      await sql`
        UPDATE deliveries
        SET status = 'in_transit',
            picked_up_at = NOW(),
            updated_at = NOW()
        WHERE id = ${delivery_id}
          AND courier_id = ${courierId}
          AND status = 'enroute'
      `;
  
      // Update orders -> picked_up / in_transit mapping if you use orders.status
      await sql`
        UPDATE orders
        SET status = 'picked_up',
            updated_at = NOW()
        WHERE id = ${delivery.order_id}
      `;
  
      return res.json({
        success: true,
        message: "Order marked as picked up (in_transit)",
        pickup_address: delivery.pickup_address,
        dropoff_address: delivery.dropoff_address
      });
    } catch (err) {
      console.error("Pickup error:", err);
      return res.status(500).json({ success: false, message: "Failed to pick up order" });
    }
  };
  
  

// controllers/deliveryController.js

// controllers/adminController.js
// controllers/adminController.js
exports.updateDeliveryStatus = async (req, res) => {
    const { deliveryId } = req.params;
    const { status } = req.body;
  
    try {
      let query;
  
      if (status === "picked_up") {
        query = sql`
          UPDATE deliveries
          SET status = ${status},
              picked_up_at = NOW()
          WHERE id = ${deliveryId}
          RETURNING *;
        `;
      } else if (status === "delivered") {
        query = sql`
          UPDATE deliveries
          SET status = ${status},
              delivered_at = NOW()
          WHERE id = ${deliveryId}
          RETURNING *;
        `;
      } else if (status === "cancelled") {
        query = sql`
          UPDATE deliveries
          SET status = ${status},
              cancelled_at = NOW()
          WHERE id = ${deliveryId}
          RETURNING *;
        `;
      } else if (status === "assigned") {
        query = sql`
          UPDATE deliveries
          SET status = ${status},
              assigned_at = NOW()
          WHERE id = ${deliveryId}
          RETURNING *;
        `;
      } else {
        return res.status(400).json({ error: "Invalid status update" });
      }
  
      const [updated] = await query;
  
      if (!updated) {
        return res.status(404).json({ error: "Delivery not found" });
      }
  
      res.json({ success: true, delivery: updated });

    } catch (err) {
      console.error("updateDeliveryStatus error:", err);
      res.status(500).json({ error: "Failed to update delivery status" });
    }
  };
  
  

  
  exports.deliverOrder = async (req, res) => {
    try {
      const { orderId, courierId, rating } = req.body;
  
      const order = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
      if (!order[0]) return res.status(404).json({ message: 'Order not found' });
  
      const distanceKm = Number(order[0].distance_km || 0);
      const fee = Number(order[0].delivery_fee || 0);
      const bonus = rating >= 4 ? 5 : 0;
      const points = Math.ceil(distanceKm * 2 + bonus);
  
      // Update orders
      await sql`
        UPDATE orders
        SET status = 'delivered',
            delivered_at = NOW(),
            courier_rating = ${rating},
            points_awarded = ${points},
            bonus = ${bonus},
            fee = ${fee}
        WHERE id = ${orderId}
      `;
  
      // Update deliveries
      await sql`
        UPDATE deliveries
        SET status = 'delivered',
            delivered_at = NOW(),
            points_awarded = ${points},
            bonus = ${bonus},
            courier_rating = ${rating}
        WHERE order_id = ${orderId} AND courier_id = ${courierId}
      `;
  
      // Update courier totals
      await sql`
        UPDATE couriers
        SET total_points = COALESCE(total_points,0) + ${points},
            total_earnings = COALESCE(total_earnings,0) + ${fee + bonus},
            completed_orders = COALESCE(completed_orders,0) + 1
        WHERE id = ${courierId}
      `;
  
      res.json({ message: 'Order delivered', points, bonus });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Failed to deliver order' });
    }
  };


  exports.getCourierStats = async (req, res) => {
    const { courierId } = req.params;
    try {
      // Completed orders
      const completedOrders = await sql`
        SELECT id, delivery_fee, bonus
        FROM orders
        WHERE courier_id = ${courierId} AND status = 'delivered'
      `;
  
      const completedCount = completedOrders.length;
      const points = completedOrders.reduce((sum, o) => sum + (o.delivery_fee || 0) + (o.bonus || 0), 0); // example points logic
      const earnings = completedOrders.reduce((sum, o) => sum + (o.delivery_fee || 0) + (o.bonus || 0), 0);
  
      // Simple tier logic
      let tier = 'Bronze';
      if (points > 500) tier = 'Silver';
      if (points > 1000) tier = 'Gold';
      if (points > 2000) tier = 'Platinum';
  
      res.json({
        success: true,
        stats: { completed: completedCount, points, earnings, tier }
      });
    } catch (err) {
      console.error('getCourierStats error', err);
      res.status(500).json({ success: false, message: 'Failed to fetch courier stats' });
    }
  };

  
  exports.getCourierRatingsSummary = async (req, res) => {
    try {
      const { courierId } = req.params;
  
      const ratings = await sql`
        SELECT courier_rating, points_awarded FROM orders
        WHERE courier_id = ${courierId} AND courier_rating IS NOT NULL
      `;
  
      const count = ratings.length;
      const average = count ? (ratings.reduce((sum, r) => sum + r.courier_rating, 0) / count) : 0;
      const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let bonusPoints = 0;
  
      ratings.forEach(r => {
        breakdown[r.courier_rating] = (breakdown[r.courier_rating] || 0) + 1;
        bonusPoints += r.points_awarded || 0;
      });
  
      const tier = pointsTier(bonusPoints); // helper function to determine tier
  
      res.json({ success: true, summary: { count, average, breakdown, bonusPoints, tier } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to fetch ratings' });
    }
  };
  
  function pointsTier(points) {
    if (points >= 1000) return 'Platinum';
    if (points >= 500) return 'Gold';
    if (points >= 200) return 'Silver';
    return 'Bronze';
  }

  
  exports.getCourierReferralLink = async (req, res) => {
    try {
      const { courierId } = req.params;
      // For example: https://app.link/referral?code=COURIER123
      const link = `https://yourapp.link/referral?code=${courierId}`;
      res.json({ success: true, link });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to fetch referral link' });
    }
  };

  // controllers/adminController.js
  exports.markOrderDelivered = async (req, res) => {
    try {
      const { order_id } = req.body;
      const userId = req.user.id;
  
      if (!order_id) return res.status(400).json({ success: false, message: "order_id required" });
  
      // Map user -> courier id
      const [courier] = await sql`SELECT id FROM couriers WHERE user_id = ${userId} LIMIT 1`;
      if (!courier) return res.status(403).json({ success: false, message: "Courier account not found" });
      const courierId = courier.id;
  
      // Verify courier assigned to this delivery
      const [delivery] = await sql`
        SELECT id, status
        FROM deliveries
        WHERE order_id = ${order_id}
          AND courier_id = ${courierId}
        LIMIT 1
      `;
      if (!delivery) return res.status(403).json({ success: false, message: "Not authorized for this delivery" });
  
      // Only allow delivered from in_transit or picked_up
      if (!["in_transit", "picked_up"].includes(delivery.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot mark delivered when delivery status is ${delivery.status}`
        });
      }
  
      // Update deliveries -> delivered
      await sql`
        UPDATE deliveries
        SET status = 'delivered',
            delivered_at = NOW(),
            updated_at = NOW()
        WHERE id = ${delivery.id}
      `;
  
      // Update orders -> delivered
      await sql`
        UPDATE orders
        SET status = 'delivered',
            delivered_at = NOW(),
            updated_at = NOW()
        WHERE id = ${order_id}
      `;
  
      // Optionally: compute points/bonus/earnings here (you may already have another function)
      return res.status(200).json({ success: true, message: 'Order marked as delivered successfully' });
    } catch (error) {
      console.error('Mark delivered error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  };
  

  exports.getMyDeliveries = async (req, res) => {
    try {
      const courierUserId = req.user.id;
      const courierRow = await sql`SELECT id FROM couriers WHERE user_id = ${courierUserId} LIMIT 1`;
  
      if (!courierRow || courierRow.length === 0) {
        return res.status(404).json({ success: false, message: "Courier not found for this user" });
      }
      const courierId = courierRow[0].id;
  
      const deliveries = await sql`
        SELECT 
          d.id,
          d.order_id,
          d.status,
          d.pickup_address,
          d.dropoff_address,
          d.delivery_fee,
          d.picked_up_at,
          d.delivered_at,
          d.assigned_at
        FROM deliveries d
        WHERE d.courier_id = ${courierId}
          AND d.status IN ('pending', 'enroute', 'in_transit', 'picked_up')
        ORDER BY d.created_at DESC
      `;
  
      return res.json({ success: true, deliveries });
    } catch (error) {
      console.error("Courier Delivery Error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
  
  

  // Mark order as delivered
exports.courierDeliverOrder = async (req, res) => {
    try {
      const { orderId, courierId } = req.body;
      if (!orderId || !courierId) return res.status(400).json({ success: false, message: 'OrderId and CourierId required' });
  
      // Update order table
      await sql`
        UPDATE orders
        SET status = 'delivered', updated_at = now()
        WHERE id = ${orderId} AND courier_id = ${courierId} AND status = 'en_route'
      `;
  
      // Update deliveries table
      await sql`
        UPDATE deliveries
        SET status = 'delivered', delivered_at = now()
        WHERE order_id = ${orderId} AND courier_id = ${courierId}
      `;
  
      res.json({ success: true, message: 'Order marked as delivered' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  };

  
  // Submit courier rating & bonus points
exports.courierRateOrder = async (req, res) => {
    try {
      const orderId = req.params.id;
      const { rating, notes } = req.body;
      const courierId = req.body.courierId;
  
      if (!orderId || !rating || !courierId) return res.status(400).json({ success: false, message: 'Missing required fields' });
  
      // Insert into courier_ratings table (create if it doesn't exist)
      await sql`
        INSERT INTO courier_ratings (order_id, courier_id, rating, notes, created_at)
        VALUES (${orderId}, ${courierId}, ${rating}, ${notes || ''}, now())
      `;
  
      // Optionally calculate bonus points
      const points = rating * 10; // Example: 5★ = 50 points, 1★ = 10 points
      await sql`
        UPDATE couriers
        SET points = coalesce(points, 0) + ${points}
        WHERE user_id = ${courierId}
      `;
  
      res.json({ success: true, message: 'Rating submitted', pointsAwarded: points });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  };

  // Fetch courier delivery history
// controllers/courierController.js (or adminController)
exports.getCourierDeliveryHistory = async (req, res) => {
    try {
      const courierId = req.user?.id; // JWT sets req.user
      console.log('[getCourierDeliveryHistory] courierId from JWT:', courierId);
  
      if (!courierId) {
        console.warn('[getCourierDeliveryHistory] Invalid courier token');
        return res.status(401).json({ success: false, message: 'Invalid courier token' });
      }
  
      // Fetch deliveries joined with orders
      const deliveries = await sql`
        SELECT d.id AS delivery_id, d.status, d.assigned_at, d.picked_up_at, d.delivered_at,
               d.cancel_reason, d.eta, d.distance_km,
               o.id AS order_id, o.user_id, o.name AS user_name, o.phone_number AS user_phone,
               o.delivery_address, o.delivery_fee AS fee
        FROM deliveries d
        JOIN orders o ON o.id = d.order_id
        WHERE d.courier_id = ${courierId}
        ORDER BY d.assigned_at DESC
      `;
      console.log(`[getCourierDeliveryHistory] fetched ${deliveries.length} deliveries`);
  
      // For each delivery, fetch order items
      const deliveriesWithItems = await Promise.all(
        deliveries.map(async d => {
          const items = await sql`
            SELECT oi.id, oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.total_price
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ${d.order_id}
          `;
          console.log(`[getCourierDeliveryHistory] order ${d.order_id} has ${items.length} items`);
  
          return {
            id: d.delivery_id,
            order_id: d.order_id,
            status: d.status,
            fee: d.fee || 0,
            distance: d.distance_km || 0,
            user_name: d.user_name || 'N/A',
            user_phone: d.user_phone || 'N/A',
            delivery_address: d.delivery_address || '',
            assigned_at: d.assigned_at,
            picked_up_at: d.picked_up_at,
            delivered_at: d.delivered_at,
            cancel_reason: d.cancel_reason || null,
            eta: d.eta || null,
            items: items.map(i => ({
              id: i.id,
              product_id: i.product_id,
              product_name: i.product_name,
              quantity: i.quantity,
              unit_price: i.unit_price,
              total_price: i.total_price
            }))
          };
        })
      );
  
      console.log('[getCourierDeliveryHistory] returning response with deliveries:', deliveriesWithItems.length);
      return res.json({ success: true, deliveries: deliveriesWithItems });
    } catch (err) {
      console.error('[getCourierDeliveryHistory] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch delivery history' });
    }
  };
  

  // Get all tickets for a courier
  exports.getCourierTickets = async (req, res) => {
    try {
      const { courierId } = req.params; // ✅ from route param
  
      if (!courierId) {
        console.error("❌ Missing courierId from params");
        return res.status(400).json({ error: "Courier ID is required" });
      }
  
      const tickets = await sql`
        SELECT id, subject, message, status, created_at
        FROM courier_tickets
        WHERE courier_id = ${courierId}
        ORDER BY created_at DESC;
      `;
  
      res.json({ success: true, tickets });
    } catch (err) {
      console.error("❌ Error fetching courier tickets:", err);
      res.status(500).json({ success: false, message: "Failed to fetch tickets" });
    }
  };
  
  // Create new ticket
  exports.createCourierTicket = async (req, res) => {
    try {
      const { message, subject } = req.body;
      const { courierId } = req.params; // ✅ from route param
  
      if (!courierId) {
        console.error("❌ Missing courierId from params");
        return res.status(400).json({ error: "Courier ID is required" });
      }
  
      const [ticket] = await sql`
        INSERT INTO courier_tickets (courier_id, subject, message, status)
        VALUES (${courierId}, ${subject || "Courier Support"}, ${message}, 'open')
        RETURNING *;
      `;
  
      res.json(ticket);
    } catch (err) {
      console.error("Error creating courier ticket:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  
  
  
  

  // POST /admin/courier/:courierId/availability
// controllers/adminController.js

exports.updateCourierAvailability = async (req, res) => {
    try {
      const { courier_id, is_available, latitude, longitude } = req.body;
  
      if (!courier_id) {
        return res.status(400).json({ error: "courier_id is required" });
      }
  
      const [updated] = await sql`
        UPDATE couriers
        SET 
          is_available = ${is_available},
          latitude = ${latitude},
          longitude = ${longitude},
          updated_at = now()
        WHERE user_id = ${courier_id}  -- 🔑 fix: use user_id
        RETURNING *;
      `;
  
      if (!updated) {
        return res.status(404).json({ error: "Courier not found" });
      }
  
      res.json({ message: "Courier availability updated", courier: updated });
    } catch (error) {
      console.error("updateCourierAvailability error", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  

  
  // GET /admin/courier/:courierId/referral-link
exports.getCourierReferralLink = async (req, res) => {
    const { courierId } = req.params;
    try {
      // Example: generate or fetch referral code from couriers table
      const [courier] = await sql`
        SELECT referral_code
        FROM couriers
        WHERE user_id = ${courierId}
      `;
  
      if (!courier) return res.status(404).json({ success: false, message: 'Courier not found' });
  
      // If no referral code, generate one
      let code = courier.referral_code;
      if (!code) {
        code = `CR-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await sql`UPDATE couriers SET referral_code = ${code} WHERE user_id = ${courierId}`;
      }
  
      res.json({ success: true, link: `https://yourapp.link/ref/${code}` });
    } catch (err) {
      console.error('getCourierReferralLink error', err);
      res.status(500).json({ success: false, message: 'Failed to get referral link' });
    }
  };
  
  // ✅ Get all ads
exports.getAds = async (req, res) => {
    try {
      const ads = await sql`SELECT * FROM ads ORDER BY created_at DESC`;
      res.json(ads);
    } catch (error) {
      console.error("Error fetching ads:", error);
      res.status(500).json({ error: "Failed to fetch ads" });
    }
  };
  
  // ✅ Create ad
  exports.createAd = async (req, res) => {
    const { title, image_url, link } = req.body;
    try {
      const [newAd] = await sql`
        INSERT INTO ads (title, image_url, link)
        VALUES (${title}, ${image_url}, ${link})
        RETURNING *;
      `;
      res.status(201).json(newAd);
    } catch (error) {
      console.error("Error creating ad:", error);
      res.status(500).json({ error: "Failed to create ad" });
    }
  };
  
  // ✅ Delete ad
  exports.deleteAd = async (req, res) => {
    const { id } = req.params;
    try {
      await sql`DELETE FROM ads WHERE id = ${id}`;
      res.json({ message: "Ad deleted" });
    } catch (error) {
      console.error("Error deleting ad:", error);
      res.status(500).json({ error: "Failed to delete ad" });
    }
  };
  


  // Get all featured products
  exports.getFeaturedProducts = async (req, res) => {
    try {
      const featuredProducts = await sql`
       SELECT id, name, price, description, image_url, stock_quantity
        FROM products
        WHERE featured = true
        ORDER BY created_at DESC
      `;
      res.json(featuredProducts);
    } catch (err) {
      console.error("Error fetching featured products:", err);
      res.status(500).json({ error: "Failed to fetch featured products" });
    }
  };
  
  
  // Set products as featured
  exports.setFeaturedProducts = async (req, res) => {
    try {
      const { productIds } = req.body; // array of UUIDs
  
      if (!productIds || !Array.isArray(productIds)) {
        return res.status(400).json({ error: "productIds must be an array of UUIDs" });
      }
  
      await sql`
        UPDATE products
        SET featured = true
        WHERE id IN (${sql(productIds)})
      `;
  
      res.json({ message: "Products marked as featured successfully" });
    } catch (err) {
      console.error("Error setting featured products:", err);
      res.status(500).json({ error: "Failed to set featured products" });
    }
  };

  exports.deleteProducer = async (req, res) => {
    try {
      const { id } = req.params; // Producer ID from URL params (e.g., /api/admin/producers/:id)
  
      if (!id) {
        return res.status(400).json({ error: "Producer ID is required" });
      }
  
      // First, delete all products associated with this producer (to handle foreign key constraints)
      await sql`
        DELETE FROM products
        WHERE producer_id = ${id}
      `;
  
      // Then, delete the producer
      const result = await sql`
        DELETE FROM producers
        WHERE id = ${id}
        RETURNING id
      `;
  
      if (result.length === 0) {
        return res.status(404).json({ error: "Producer not found" });
      }
  
      res.json({ message: "Producer and associated products deleted successfully" });
    } catch (err) {
      console.error("Error deleting producer:", err);
      res.status(500).json({ error: "Failed to delete producer" });
    }
  };
  
  
// Toggle featured status for a single product
exports.toggleFeatured = async (req, res) => {
  try {
    const { productId, featured } = req.body;

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    await sql`
      UPDATE products
      SET featured = ${featured}
      WHERE id = ${productId}
    `;

    res.json({ message: "Product featured status updated successfully" });
  } catch (err) {
    console.error("Error toggling featured:", err);
    res.status(500).json({ error: "Failed to toggle featured status" });
  }
};

  // Remove featured products
  exports.removeFeaturedProducts = async (req, res) => {
    try {
      const { productIds } = req.body;
      if (!productIds || !Array.isArray(productIds)) {
        return res.status(400).json({ error: "productIds must be an array of UUIDs" });
      }
  
      await sql`
        UPDATE products
        SET featured = false
        WHERE id IN (${sql(productIds)})
      `;
  
      res.json({ message: "Products un-featured successfully" });
    } catch (err) {
      console.error("Error removing featured products:", err);
      res.status(500).json({ error: "Failed to remove featured products" });
    }
  };
  


  exports.getBestSellers = async (req, res) => {
    try {
      // Parse query params (defaults: limit=10, no period for all-time)
      const limit = Math.min(parseInt(req.query.limit) || 10, 100); // Cap at 100 for safety
      const period = req.query.period ? parseInt(req.query.period) : null; // Days (e.g., 30); null for all-time
  
      // Build query conditionally
      let query = `
        SELECT 
          p.id, 
          p.name, 
          p.image_url, 
          p.price,
          COUNT(oi.id) as order_count,
          COALESCE(SUM(oi.quantity), 0) as total_quantity_sold,
          COALESCE(SUM(oi.quantity * p.price), 0) as total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
      `;
  
      if (period && period > 0) {
        query += ` WHERE oi.created_at > NOW() - INTERVAL '${period} days'`;
      }
  
      query += `
        GROUP BY p.id
        ORDER BY total_quantity_sold DESC  -- Change to: order_count DESC for "most ordered", or total_revenue DESC for revenue
        LIMIT ${limit}
      `;
  
      // Use sql.unsafe for dynamic query (ensure no user input in query string to avoid injection)
      const bestSellers = await sql.unsafe(query);
  
      res.json({ success: true, data: bestSellers });
    } catch (err) {
      console.error("Error fetching best sellers:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };
  
  // ✅ Get Trending (last 30 days)
  exports.getTrending = async (req, res) => {
    try {
      const trending = await sql`
        SELECT 
          p.id, 
          p.name, 
          p.image_url, 
          p.price,
          COUNT(oi.id) as order_count
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY p.id
        ORDER BY order_count DESC
        LIMIT 10;
      `;
  
      res.json({ success: true, data: trending });
    } catch (err) {
      console.error("Error fetching trending products:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };

  // ✅ Get Trending / Best Sellers
exports.getTrendingProducts = async (req, res) => {
    try {
      const products = await sql`
        SELECT 
          p.id,
          p.name,
          p.price,
          p.image_url,
          COALESCE(SUM(oi.quantity), 0) as total_sold
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
        GROUP BY p.id
        ORDER BY total_sold DESC
        LIMIT 10
      `;
  
      res.json({ success: true, data: products });
    } catch (error) {
      console.error("Error fetching trending products:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };


// controllers/adminController.js

exports.searchProducts = async (req, res) => {
    try {
      const { search } = req.query;
  
      if (!search || search.trim().length < 1) {
        return res.status(400).json({ message: "Search query too short" });
      }
  
      const products = await sql`
        SELECT 
          p.id, 
          p.name, 
          p.description, 
          p.price, 
          p.image_url,
          pr.id AS producer_id,
          pr.name AS producer_name
        FROM products p
        JOIN producers pr ON pr.id = p.producer_id
        WHERE LOWER(p.name) LIKE ${"%" + search.toLowerCase() + "%"}
           OR LOWER(p.description) LIKE ${"%" + search.toLowerCase() + "%"}
           OR LOWER(pr.name) LIKE ${"%" + search.toLowerCase() + "%"}
        ORDER BY p.created_at DESC
        LIMIT 20;
      `;
  
      res.json(products);
    } catch (err) {
      console.error("❌ searchProducts error:", err);
      res.status(500).json({ message: "Server error" });
    }
  };

  exports.getProductById = async (req, res) => {
    try {
      const { id } = req.params;
  
      if (!id) {
        return res.status(400).json({ message: "Product ID is required" });
      }
  
      // Fetch product by ID, joining with producers for additional data
      const products = await sql`
        SELECT 
          p.id, 
          p.name, 
          p.description, 
          p.price, 
          p.image_url,
          p.stock_quantity,
          pr.id AS producer_id,
          pr.name AS producer_name
        FROM products p
        JOIN producers pr ON pr.id = p.producer_id
        WHERE p.id = ${id}
        LIMIT 1;
      `;
  
      if (products.length === 0) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
  
      const product = products[0]; // Since LIMIT 1, take the first (and only) result
  
      res.json({
        success: true,
        data: {
          id: product.id,
          name: product.name,
          price: product.price,
          image_url: product.image_url,
          stock_quantity: product.stock_quantity,
          description: product.description,
          producer_id: product.producer_id,
          producer_name: product.producer_name,
          // Add more fields if needed
        },
      });
    } catch (err) {
      console.error("❌ getProductById error:", err);
      res.status(500).json({ message: "Server error" });
    }
  };





  // ============================================
// ENGINEER WITHDRAWALS
// ============================================

// GET ALL ENGINEER WITHDRAWALS
exports.getEngineerWithdrawals = async (req, res) => {
  try {
    const withdrawals = await sql`
      SELECT
        ew.id,
        ew.engineer_id,
        ew.amount,
        ew.status,
        ew.bank_name,
        ew.account_number,
        ew.account_name,
        ew.created_at,
        ew.updated_at,
        u.full_name,
        u.email
      FROM engineer_withdrawals ew
      JOIN users u
        ON u.id = ew.engineer_id
      ORDER BY ew.created_at DESC
    `;

    return res.status(200).json({
      success: true,
      withdrawals,
    });
  } catch (error) {
    console.error("getEngineerWithdrawals error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch engineer withdrawals",
    });
  }
};

// UPDATE WITHDRAWAL STATUS FOR ENGINEERS
exports.updateEngineerWithdrawalStatus = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "under_review",
      "approved",
      "paid",
      "rejected",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal status",
      });
    }

    const result = await sql`
      UPDATE engineer_withdrawals
      SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${withdrawalId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Withdrawal status updated successfully",
      withdrawal: result[0],
    });
  } catch (error) {
    console.error("updateEngineerWithdrawalStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update withdrawal status",
    });
  }
};


  // ✅ Confirm payment and update order status after Flutterwave callback
// exports.confirmPayment = async (req, res) => {
//   const { tx_ref } = req.body;
//   const token = req.headers.authorization?.split(' ')[1];
//   if (!tx_ref) {
//     return res.status(400).json({ message: 'Transaction reference missing' });
//   }

//   try {
//     // Verify payment on Flutterwave
//     const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
//       headers: {
//         Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
//       },
//     });

//     const data = await verifyRes.json();

//     if (!data?.data || data.data.status !== 'successful') {
//       return res.status(400).json({ message: 'Payment not successful or invalid reference' });
//     }

//     // ✅ Update the order in DB
//     await prisma.orders.updateMany({
//       where: { tx_ref },
//       data: {
//         payment_status: 'paid',
//         order_status: 'pending_assignment', // waiting for courier
//         updated_at: new Date(),
//       },
//     });

    // ✅ Optionally, auto-assign courier if you want immediate dispatch
    // const order = await prisma.orders.findFirst({ where: { tx_ref } });
    // if (order) await assignCourierAutomatically(order);

//     return res.json({ message: 'Payment verified and order updated successfully' });
//   } catch (error) {
//     console.error('❌ confirmPayment error:', error);
//     return res.status(500).json({ message: 'Error verifying payment', error: error.message });
//   }
// };


  
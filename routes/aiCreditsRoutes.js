// routes/aiCreditsRoutes.js
const express = require('express');
const router = express.Router(); // ✅ MISSING THIS!
const axios = require('axios');
const { verifyToken } = require('../middleware/auth'); // Adjust path if needed
const { sql } = require('../db');

router.post('/purchase', verifyToken, async (req, res) => {
  const { credits, amount } = req.body;
  const txRef = `AI-CREDITS-${req.user.id}-${Date.now()}`;
  
  try {
    const fwRes = await axios.post('https://api.flutterwave.com/v3/payments', {
      tx_ref: txRef, 
      amount, 
      currency: 'NGN',
      redirect_url: `${process.env.BASE_URL || 'https://oluwaflozoya-backend.onrender.com'}/api/ai/credits/callback`,
      customer: { 
        email: req.user.email, 
        name: req.user.full_name || req.user.username 
      },
      meta: { 
        user_id: req.user.id, 
        credits 
      },
      customizations: { 
        title: 'Zoya AI Credits',
        description: `${credits} AI Credits`
      },
    }, { 
      headers: { 
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      } 
    });
    
    res.json({ 
      success: true,
      payment_link: fwRes.data.data.link, 
      tx_ref: txRef 
    });
  } catch (error) {
    console.error('❌ Flutterwave error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Payment initiation failed' 
    });
  }
});

// Callback handler
router.post('/callback', async (req, res) => {
  try {
    const { tx_ref, status } = req.body;
    
    if (status === 'successful') {
      // Extract user_id and credits from tx_ref
      const match = txRef.match(/AI-CREDITS-(\d+)-(\d+)/);
      if (match) {
        const userId = match[1];
        const credits = parseInt(match[2]); // You'll need to store this in DB
        
        // Add credits to user
        await sql`
          UPDATE users 
          SET ai_credits = COALESCE(ai_credits, 0) + ${credits}
          WHERE id = ${userId}
        `;
        
        console.log(`✅ Added ${credits} AI credits to user ${userId}`);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Callback error:', error);
    res.status(500).send('Error');
  }
});

router.get('/balance', verifyToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT ai_credits FROM users WHERE id = ${req.user.id}
    `;
    res.json({ 
      success: true, 
      balance: result[0]?.ai_credits || 0 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch balance' });
  }
});

module.exports = router; // ✅ EXPORT ROUTER!
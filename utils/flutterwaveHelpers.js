const axios = require('axios');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yourfrontend.com';

async function createDeliveryPaymentLink(data) {
  try {
    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: data.tx_ref,
        amount: data.amount,
        currency: data.currency || 'NGN',
        redirect_url: data.redirect_url,
        customer: {
          email: data.customer.email,
          name: data.customer.name,
        },
        meta: {
          user_id: data.user_id,
          order_id: data.order_id,
          payment_type: data.payment_type,
        },
        customizations: {
          title: 'Oluwaflo Delivery Payment',
          description: 'Pay your delivery fee securely via Flutterwave',
          logo: `${FRONTEND_URL}/logo.png`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      id: response.data.data.id,
      link: response.data.data.link,
    };
  } catch (error) {
    console.error('❌ Flutterwave link error:', error.response?.data || error.message);
    throw new Error('Failed to create payment link with Flutterwave');
  }
}

module.exports = { createDeliveryPaymentLink };

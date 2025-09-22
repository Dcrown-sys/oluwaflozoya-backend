const axios = require('axios');

const FLUTTERWAVE_SECRET_KEY = process.env.FLW_SECRET_KEY || 'FLWSECK_TEST-7eb72d6335ac2a50c2a5db44532c1ca8-X'; // Replace with your real test key

const flutterwave = axios.create({
  baseURL: 'https://api.flutterwave.com/v3',
  headers: {
    Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

// Initiate a payment
const initiatePayment = async ({ amount, email, tx_ref, currency = 'NGN', redirect_url }) => {
  try {
    const res = await flutterwave.post('/payments', {
      tx_ref,
      amount,
      currency,
      redirect_url,
      customer: {
        email,
      },
      customizations: {
        title: 'Zoya App Payment',
        description: 'Payment for product(s)',
      },
    });

    return res.data;
  } catch (err) {
    console.error('Flutterwave error:', err.response?.data || err.message);
    throw new Error('Failed to initiate payment with Flutterwave.');
  }
};

module.exports = {
  initiatePayment,
};

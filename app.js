const express = require('express');
require('dotenv').config();
const mysql = require('mysql');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const fs = require('fs');
const Jimp = require('jimp');
const cors = require('cors');
const WebSocket = require('ws');
const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Function to create a MySQL connection
function createDbConnection() {
    const db = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    db.connect(err => {
        if (err) {
            console.error('Error connecting to database:', err);
            setTimeout(createDbConnection, 2000); // Try to reconnect after 2 seconds
        } else {
            console.log('Connected to database');
        }
    });

    db.on('error', err => {
        console.error('Database error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            createDbConnection(); // Reconnect to the database
        } else {
            throw err;
        }
    });

    return db;
}

const db = createDbConnection();


/***********************************************************
 *Websocket Setup 
 */

// Store connected clients
let connectedClients = [];

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.on('message', (message) => {
        console.log(`Received: ${message}`);
    });
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});


app.use(cors());

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/processed-uploads', express.static('processed-uploads'));
app.use('/finalized-uploads', express.static('finalized-uploads'));
app.use(express.json({ limit: '50mb' })); // Set limit to handle large payloads

/***********************************************************
 * 
 * 
 * Helper Functions
 * 
 * 
 ***********************************************************/

const DEFAULT_CUSTOMER_ID = 1;


// Function to notify STL generation machines
function notifySTLGeneration(orderID) {
    connectedClients.forEach(client => {
        client.send(JSON.stringify({ event: 'generateSTL', orderID: orderID }));
    });
}

function createOrder(db, customerId = DEFAULT_CUSTOMER_ID) {
    return new Promise((resolve, reject) => {
        const sql = "INSERT INTO customer_order (customer_id, order_date, order_status) VALUES (?, NOW(), 'submitted_pending')";
        db.query(sql, [customerId], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results.insertId);
            }
        });
    });
}



async function saveOrderItem(db, details) {
    try {
        const priceQuery = 'SELECT item_price FROM item WHERE id = ?';
        console.log("Fetching item price for item: ", details);
        const itemResult = await queryDB(db, priceQuery, [details.item_id]);
        if (itemResult.length === 0) {
            throw new Error('Item not found');
        }
        const itemPrice = itemResult[0].item_price;

        const sql = `INSERT INTO order_item (order_id, item_id, item_status, has_hangars, item_price) VALUES (?, ?, 'pending', ?, ?)`;
        const result = await queryDB(db, sql, [details.order_id, details.item_id, details.has_hangars, itemPrice]);
        console.log(`Order item created: Order ID: ${details.order_id}, Item ID: ${details.item_id}, Price: ${itemPrice}`);
        return result.insertId;
    } catch (error) {
        console.error("Error saving order item:", error);
        throw error; // Rethrow to handle it in the calling function
    }
}

async function saveOrderItemImage(db, details) {
    try {
        const sql = `INSERT INTO order_item_image (order_item_id, image_filepath, image_status) VALUES (?, ?, 'pending')`;
        await queryDB(db, sql, [details.order_item_id, details.filepath]);
        console.log("Order item image saved with filepath:", details.filepath);
    } catch (error) {
        console.error("Error saving order item image:", error);
        throw error; // Rethrow to handle it in the calling function
    }
}

// Helper function to perform database queries with promises
function queryDB(db, sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

async function processImage(image, filename) {
    try {
        const outputPath = path.join(__dirname, 'processed-uploads', filename);
        console.log(`Processing image and converting to grayscale, saving to: ${outputPath}`);
        const base64Data = image.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const jimpImage = await Jimp.read(buffer);

        jimpImage.grayscale();
        await jimpImage.writeAsync(outputPath);

        console.log(`Image processed and saved to: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('Error processing image:', error);
        throw error;
    }
}

/***********************************************************
 * 
 * 
 * Route Handlers
 * 
 * 
 ***********************************************************/

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/selection', (req, res) => {
    res.render('selection');
});

app.get('/customize', (req, res) => {
    const bundle = req.query.bundle;
    res.render('customize', { bundle });
});

app.post('/upload', async (req, res) => {
    const orderData = req.body;
    try {
        const orderId = await createOrder(db, DEFAULT_CUSTOMER_ID);
        console.log(`Order created with ID: ${orderId}`);
        const items = [];
        let itemDetails = [];
        
        orderData.images.forEach(image => {
            if (image.aspectRatio === '4x4') {
                itemDetails.push(image);
                if (itemDetails.length === 2) {
                    items.push(itemDetails);
                    itemDetails = [];
                }
            } else {
                items.push([image]);
            }
        });

        if (itemDetails.length > 0) {
            items.push(itemDetails);
        }

        const promises = items.map(async (itemGroup, index) => {
            let itemId;
            if (itemGroup.length === 2) {
                itemId = 7; // Double 4x4
            } else if (itemGroup[0].aspectRatio === '4x4') {
                itemId = 6; // Single 4x4
            } else if (itemGroup[0].aspectRatio === '4x6') {
                itemId = 8; // Single 4x6
            } else if (itemGroup[0].aspectRatio === '6x4') {
                itemId = 9; // Single 6x4
            } else {
                throw new Error('Unsupported aspect ratio');
            }

            const orderItemId = await saveOrderItem(db, {
                order_id: orderId,
                item_id: itemId,
                has_hangars: itemGroup.some(image => image.hangars === 'yes')
            });

            console.log(`Order item created with ID: ${orderItemId}`);

            return Promise.all(itemGroup.map(async (image, imgIndex) => {
                const filename = `order_${orderId}_item_${orderItemId}_image_${imgIndex + 1}.png`;
                const filepath = await processImage(image.src, filename);

                await saveOrderItemImage(db, {
                    order_item_id: orderItemId,
                    filepath: filename
                });
            }));
        });

        await Promise.all(promises);
        res.json({ orderID: orderId });
    } catch (error) {
        console.error('Error processing order:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/review', async (req, res) => {
    const orderID = req.query.orderID;

    try {
        const orderQuery = `
            SELECT oi.id AS order_item_id, oi.item_id, oi.item_price, i.item_name, oii.image_filepath
            FROM order_item oi
            JOIN item i ON oi.item_id = i.id
            LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id
            WHERE oi.order_id = ?
        `;
        const orderItems = await queryDB(db, orderQuery, [orderID]);

        const items = orderItems.reduce((acc, item) => {
            if (!acc[item.order_item_id]) {
                acc[item.order_item_id] = {
                    itemName: item.item_name,
                    itemPrice: item.item_price,
                    images: []
                };
            }
            acc[item.order_item_id].images.push(item.image_filepath);
            return acc;
        }, {});

        res.render('review', { items, orderID });
    } catch (error) {
        console.error('Error retrieving order items:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/checkout', async (req, res) => {
    const orderID = req.query.orderID;

    try {
        const orderDetails = await getOrderDetails(orderID);
        if (!orderDetails) {
            res.status(404).send('Order not found');
            return;
        }

        // Calculate subtotal, shipping, tax, and total
        const subtotal = calculateSubtotal(orderDetails.items);
        const shipping = 10.00; // Assuming a flat rate for simplicity
        const tax = subtotal * 0.08; // Assuming an 8% tax rate
        const total = subtotal + shipping + tax;

        res.render('checkout', {
            orderID: orderID,
            subtotal: subtotal,
            shipping: shipping,
            tax: tax,
            total: total
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).send('Server error');
    }
});

function calculateSubtotal(items) {
    return Object.values(items).reduce((sum, item) => sum + item.itemPrice, 0);
}




app.post('/complete-order', async (req, res) => {
    const {
        orderID, firstName, lastName, email, phoneNumber,
        addressLine1, addressLine2, city, state, zip, stripeToken, subtotal, shipping, tax, total
    } = req.body;

    try {
        const customerResult = await queryDB(db, 'SELECT * FROM customer WHERE email = ?', [email]);
        let customerID;
        if (customerResult.length > 0) {
            customerID = customerResult[0].id;
            await queryDB(db, 'UPDATE customer SET name = ?, phone = ?, address1 = ?, address2 = ?, city = ?, state = ?, zip = ? WHERE id = ?',
                [`${firstName} ${lastName}`, phoneNumber, addressLine1, addressLine2, city, state, zip, customerID]);
        } else {
            const newCustomerResult = await queryDB(db, 'INSERT INTO customer (name, email, phone, address1, address2, city, state, zip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [`${firstName} ${lastName}`, email, phoneNumber, addressLine1, addressLine2, city, state, zip]);
            customerID = newCustomerResult.insertId;
        }

        await queryDB(db, 'UPDATE customer_order SET customer_id = ?, order_total = ?, stripe_order_id = ?, order_status = ? WHERE id = ?',
            [customerID, total, stripeToken, 'submitted_paid', orderID]);

        const charge = await stripe.charges.create({
            amount: Math.round(total * 100), // Amount in cents
            currency: 'usd',
            description: `Order #${orderID}`,
            source: stripeToken,
        });

        // Store the last 4 digits of the card
        const last4 = charge.payment_method_details.card.last4;
        await queryDB(db, 'UPDATE customer_order SET card_last4 = ? WHERE id = ?', [last4, orderID]);

        // Notify the STL generation machine
        await notifySTLGeneration(orderID);

        res.json({ success: true, orderID: orderID });
    } catch (error) {
        console.error('Error completing order:', error);
        res.json({ success: false, error: 'Payment processing failed' });
    }
});




app.post('/process-image', async (req, res) => {
    const { filename, brightness, contrast, orderItemId } = req.body;

    try {
        const inputPath = path.join(__dirname, 'processed-uploads', filename);
        const outputPath = path.join(__dirname, 'finalized-uploads', filename);
        console.log(`Processing image with brightness: ${brightness}, contrast: ${contrast}, from: ${inputPath}, saving to: ${outputPath}`);

        const jimpImage = await Jimp.read(inputPath);

        jimpImage.brightness(parseFloat(brightness)).contrast(parseFloat(contrast));
        await jimpImage.writeAsync(outputPath);

        res.json({ success: true, filename });
    } catch (error) {
        console.error('Error processing image:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/complete-order', async (req, res) => {
    const { orderID, firstName, lastName, email, phoneNumber, addressLine1, addressLine2, city, state, zip, stripeToken } = req.body;

    try {
        // Check if the customer already exists
        let customer = await getCustomerByEmail(email);
        if (!customer) {
            // Create a new customer
            const createCustomerQuery = `
                INSERT INTO customer (name, email, phone, address1, address2, city, state, zip, stripe_customer_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const results = await queryDB(db, createCustomerQuery, [firstName + ' ' + lastName, email, phoneNumber, addressLine1, addressLine2, city, state, zip, null]);
            customer = { id: results.insertId, email, name: firstName + ' ' + lastName, phone: phoneNumber, address1: addressLine1, address2: addressLine2, city, state, zip };
        }

        // Assign the order to the customer
        const updateOrderCustomerQuery = 'UPDATE customer_order SET customer_id = ? WHERE id = ?';
        await queryDB(db, updateOrderCustomerQuery, [customer.id, orderID]);

        // Fetch order details from the database to calculate the total amount
        const orderDetails = await getOrderDetails(orderID);
        const subtotal = calculateSubtotal(orderDetails);
        const shipping = 10.00; // Example shipping cost
        const tax = subtotal * 0.08; // Example tax rate of 8%
        const total = subtotal + shipping + tax;

        // Create the Stripe charge
        const charge = await stripe.charges.create({
            amount: total * 100, // Amount in cents
            currency: 'usd',
            description: `Order ${orderID}`,
            source: stripeToken,
            metadata: { orderID }
        });

        // Update the order status in the database
        const updateOrderStatusQuery = 'UPDATE customer_order SET order_status = ?, stripe_order_id = ? WHERE id = ?';
        await queryDB(db, updateOrderStatusQuery, ['submitted_paid', charge.id, orderID]);

        // Respond with success
        res.json({ success: true, orderID });
    } catch (error) {
        console.error('Error completing order:', error.message);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

async function getCustomerByEmail(email) {
    const query = 'SELECT * FROM customer WHERE email = ?';
    const results = await queryDB(db, query, [email]);
    return results[0];
}

function calculateTotalAmount(orderDetails) {
    // Implement this function to calculate the total amount based on the order details
    // This is just a placeholder implementation
    let total = 0;
    for (const item of Object.values(orderDetails.items)) {
        total += item.itemPrice;
    }
    // Add shipping, tax, etc.
    total += 10; // Example shipping cost
    total += total * 0.08; // Example tax rate of 8%
    return total;
}


// Function to fetch order details
async function getOrderDetails(orderID) {
    const query = 'SELECT * FROM customer_order WHERE id = ?';
    const results = await queryDB(db, query, [orderID]);
    if (results.length === 0) {
        console.error(`Order not found for ID: ${orderID}`);
        return null;
    }

    let order = results[0];
    console.log('Fetched order:', order);

    const itemsQuery = 'SELECT oi.id as order_item_id, oi.item_price, oii.image_filepath FROM order_item oi LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id WHERE oi.order_id = ?';
    const itemsResults = await queryDB(db, itemsQuery, [orderID]);
    console.log('Fetched items:', itemsResults);

    const items = {};
    itemsResults.forEach(result => {
        if (!items[result.order_item_id]) {
            items[result.order_item_id] = {
                itemPrice: result.item_price,
                images: []
            };
        }
        items[result.order_item_id].images.push(result.image_filepath);
    });

    order = {
        ...order,
        items,
        subtotal: calculateSubtotal(items),
        shipping: 10.00, // Example shipping cost
        tax: calculateSubtotal(items) * 0.08, // Example tax rate of 8%
        total: calculateSubtotal(items) + 10.00 + calculateSubtotal(items) * 0.08
    };

    console.log('Order details:', order);
    return order;
}








app.get('/order-confirmation', async (req, res) => {
    const orderID = req.query.orderID;
    try {
        const orderDetails = await getOrderDetails(orderID);
        if (!orderDetails) {
            res.status(404).send('Order not found');
            return;
        }

        const customerDetailsQuery = 'SELECT * FROM customer WHERE id = ?';
        const customerDetailsResult = await queryDB(db, customerDetailsQuery, [orderDetails.customer_id]);
        const customerDetails = customerDetailsResult[0];

        res.render('order-confirmation', { orderDetails, customerDetails });
    } catch (error) {
        console.error('Error fetching order or customer details:', error);
        res.status(500).send('Server error');
    }
});





async function getCustomerDetails(customerID) {
    const query = 'SELECT * FROM customer WHERE id = ?';
    const results = await queryDB(db, query, [customerID]);
    if (results.length === 0) {
        return null;
    }
    return results[0];
}

async function getOrderDetails(orderID) {
    const query = `
        SELECT co.*, c.*, oi.id AS order_item_id, oi.item_price, oii.image_filepath 
        FROM customer_order co
        LEFT JOIN customer c ON co.customer_id = c.id
        LEFT JOIN order_item oi ON co.id = oi.order_id
        LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id
        WHERE co.id = ?`;

    const results = await queryDB(db, query, [orderID]);

    if (results.length === 0) {
        console.error(`Order not found for ID: ${orderID}`);
        return null;
    }

    const order = {
        id: results[0].id,
        customer_id: results[0].customer_id,
        order_date: results[0].order_date,
        order_status: results[0].order_status,
        order_total: results[0].order_total,
        stripe_order_id: results[0].stripe_order_id,
        customer: {
            name: results[0].name,
            email: results[0].email,
            phone: results[0].phone,
            address1: results[0].address1,
            address2: results[0].address2,
            city: results[0].city,
            state: results[0].state,
            zip: results[0].zip
        },
        items: {}
    };

    results.forEach(result => {
        if (!order.items[result.order_item_id]) {
            order.items[result.order_item_id] = {
                itemPrice: result.item_price,
                images: []
            };
        }
        order.items[result.order_item_id].images.push(result.image_filepath);
    });

    order.subtotal = calculateSubtotal(order.items);
    order.shipping = 10.00; // Example shipping cost
    order.tax = order.subtotal * 0.08; // Example tax rate of 8%
    order.total = order.subtotal + order.shipping + order.tax;

    console.log('Order details:', order);
    return order;
}

function calculateSubtotal(items) {
    let subtotal = 0;
    if (items && Object.values(items).length > 0) {
        for (const item of Object.values(items)) {
            subtotal += item.itemPrice;
        }
    }
    return subtotal;
}









// Server setup

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});




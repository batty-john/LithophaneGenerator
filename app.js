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
const ftp = require("basic-ftp");

// Function to create a MySQL connection pool
const pool = mysql.createPool({
    connectionLimit: 10, // Adjust this based on your needs
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

/***********************************************************
 * WebSocket Setup 
 ***********************************************************/

// Store connected clients
let connectedClients = [];

wss.on('connection', (ws) => {
    console.log('Client connected');
    connectedClients.push(ws); // Add the connected client to the list

    ws.on('message', (message) => {
        console.log(`Received: ${message}`);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        connectedClients = connectedClients.filter(client => client !== ws); // Remove the client from the list
    });
});

app.use(cors());

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: '50000mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/processed-uploads', express.static(path.join(__dirname, 'processed-uploads')));
app.use('/finalized-uploads', express.static(path.join(__dirname, 'finalized-uploads')));

// Serve images from remote server
app.get('/remote-uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const remoteUrl = `https://${process.env.SFTP_HOST}/${process.env.SFTP_REMOTE_DIR}/${filename}`;
    res.redirect(remoteUrl);
});

app.use(express.json({ limit: '5000mb' })); // Set limit to handle large payloads

// Basic Authentication Middleware
const basicAuth = (req, res, next) => {
    const auth = { login: process.env.DASHBOARD_USER, password: process.env.DASHBOARD_PASS }; // Replace with your username and password

    // Parse login and password from headers
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // Verify login and password are set and correct
    if (login && password && login === auth.login && password === auth.password) {
        return next();
    }

    // Access denied...
    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Authentication required.');
};

/***********************************************************
 * Helper Functions
 ***********************************************************/

const DEFAULT_CUSTOMER_ID = 1;

async function updateOrderStatus(orderID, status) {
    const query = 'UPDATE customer_order SET order_status = ? WHERE id = ?';
    await queryDB(query, [status, orderID]);
}

function notifySTLGeneration(orderID, items) {
    console.log('Notifying STL generation machine for order:', orderID);
    connectedClients.forEach(client => {
        if (Array.isArray(items)) {
            const formattedItems = items.map(item => ({
                itemID: item.itemID,
                itemPrice: item.itemPrice,
                aspectRatio: item.aspectRatio, // Include the aspect ratio
                hanger: item.hanger,
                images: item.images.map(img => img.imageFile),
                printed: item.printed
            }));
            client.send(JSON.stringify({ event: 'generateSTL', orderID: orderID, items: formattedItems }));
        } else {
            console.error('Items is not an array:', items);
        }
    });
}


// Helper function to perform database queries with promises using connection pool
function queryDB(sql, params) {
    return new Promise((resolve, reject) => {
        pool.query(sql, params, (error, results) => {
            if (error) {
                console.error(`Error executing query: ${sql} with params: ${params}`, error);
                return reject(error);
            }
            resolve(results);
        });
    });
}

function createOrder(customerId = DEFAULT_CUSTOMER_ID) {
    return new Promise((resolve, reject) => {
        const sql = "INSERT INTO customer_order (customer_id, order_date, order_status) VALUES (?, NOW(), 'submitted_pending')";
        pool.query(sql, [customerId], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results.insertId);
            }
        });
    });
}

async function saveOrderItem(details) {
    try {
        const priceQuery = 'SELECT item_price FROM item WHERE id = ?';
        console.log("Fetching item price for item: ", details);
        const itemResult = await queryDB(priceQuery, [details.item_id]);
        if (itemResult.length === 0) {
            throw new Error('Item not found');
        }
        const itemPrice = itemResult[0].item_price;

        const sql = `INSERT INTO order_item (order_id, item_id, item_status, has_hangars, item_price) VALUES (?, ?, 'pending', ?, ?)`;
        const result = await queryDB(sql, [details.order_id, details.item_id, details.has_hangars, itemPrice]);
        console.log(`Order item created: Order ID: ${details.order_id}, Item ID: ${details.item_id}, Price: ${itemPrice}`);
        return result.insertId;
    } catch (error) {
        console.error("Error saving order item:", error);
        throw error; // Rethrow to handle it in the calling function
    }
}

async function saveOrderItemImage(details) {
    try {
        const sql = `INSERT INTO order_item_image (order_item_id, image_filepath, image_status) VALUES (?, ?, 'pending')`;
        await queryDB(sql, [details.order_item_id, details.filepath]);
        console.log("Order item image saved with filepath:", details.filepath);
    } catch (error) {
        console.error("Error saving order item image:", error);
        throw error; // Rethrow to handle it in the calling function
    }
}

async function ensureDirectory(client, remoteDir) {
    const parts = remoteDir.split('/');
    for (let i = 1; i < parts.length; i++) {
        const part = parts.slice(0, i + 1).join('/');
        try {
            await client.ensureDir(part);
        } catch (err) {
            console.error(`Error ensuring directory: ${part}`, err);
            throw err;
        }
    }
}

async function processImage(image, filename) {
    const localOutputPath = path.join(__dirname, 'processed-uploads', filename);
    const remoteOutputPath = `/app/${filename}`;
    const remoteDir = path.dirname(remoteOutputPath);

    try {
        console.log(`Processing image and converting to grayscale, saving to: ${localOutputPath}`);
        const base64Data = image.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const jimpImage = await Jimp.read(buffer);

        jimpImage.grayscale();
        await jimpImage.writeAsync(localOutputPath);

        console.log(`Image processed and saved to: ${localOutputPath}`);

        const client = new ftp.Client();
        client.ftp.verbose = true;

        try {
            await client.access({
                host: process.env.FTP_HOST,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
                secure: false // Set to true if you're using FTPS
            });

            console.log(`Ensuring remote directory exists: ${remoteDir}`);
            await ensureDirectory(client, remoteDir);

            console.log(`Uploading to remote server: ${remoteOutputPath}`);
            await client.uploadFrom(localOutputPath, remoteOutputPath);
            console.log(`Image uploaded to remote server: ${remoteOutputPath}`);
        } catch (err) {
            console.error('Error during FTP upload:', err);
            throw err;
        } finally {
            client.close();
        }

        return remoteOutputPath;
    } catch (error) {
        console.error('Error processing image:', error.message);
        throw error;
    }
}

/***********************************************************
 * Route Handlers
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
        const orderId = await createOrder(DEFAULT_CUSTOMER_ID);
        console.log(`Order created with ID: ${orderId}`);

        const items = [];

        // Check if it's a lightbox bundle
        if (orderData.bundle === 'lightbox') {
            items.push(orderData.images);
        } else {
            // Handle individual pictures
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
        }

        const promises = items.map(async (itemGroup) => {
            let itemId;
            if (orderData.bundle === 'lightbox') {
                itemId = 5; // Lightbox Bundle ID, replace with actual ID if needed
            } else if (itemGroup.length === 2) {
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

            const orderItemId = await saveOrderItem({
                order_id: orderId,
                item_id: itemId,
                has_hangars: itemGroup.some(image => image.hangars === 'yes')
            });

            console.log(`Order item created with ID: ${orderItemId}`);

            await Promise.all(itemGroup.map(async (image, imgIndex) => {
                const filename = `order_${orderId}_item_${orderItemId}_image_${imgIndex + 1}.png`;
                const filepath = await processImage(image.src, filename);

                await saveOrderItemImage({
                    order_item_id: orderItemId,
                    filepath: filename
                });
            }));
        });

        await Promise.all(promises);

        // Fetch all items for the order
        const itemsQuery = `SELECT * FROM order_item WHERE order_id = ?`;
        const itemsResult = await queryDB(itemsQuery, [orderId]);
        const fetchedItems = itemsResult.map(item => ({
            itemID: item.id,
            itemPrice: item.price, // Ensure the price is correctly fetched from the database
            photoSize: item.photo_size,
            hanger: item.has_hangars,
            imageFile: item.image_filepath,
            printed: item.printed
        }));

        // Calculate the subtotal after saving all items
        const subtotal = calculateSubtotal(fetchedItems);
        console.log(`Order ${orderId} subtotal: ${subtotal}`);

        res.json({ orderID: orderId, subtotal });
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
        const orderItems = await queryDB(orderQuery, [orderID]);

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
        const shipping = 0; // Assuming a flat rate for simplicity
        const tax = subtotal * 0.075; // Assuming an 8% tax rate
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
    const uniqueItems = items.reduce((acc, item) => {
        if (!acc[item.itemID]) {
            acc[item.itemID] = item;
        }
        return acc;
    }, {});
    return Object.values(uniqueItems).reduce((sum, item) => sum + item.itemPrice, 0);
}

app.post('/complete-order', async (req, res) => {
    const {
        orderID, firstName, lastName, email, phoneNumber,
        addressLine1, addressLine2, city, state, zip, stripeToken
    } = req.body;

    try {
        // Check if the customer already exists
        let customer = await getCustomerByEmail(email);
        if (!customer) {
            // Create a new customer
            const createCustomerQuery = `
                INSERT INTO customer (name, email, phone, address1, address2, city, state, zip, stripe_customer_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const results = await queryDB(createCustomerQuery, [firstName + ' ' + lastName, email, phoneNumber, addressLine1, addressLine2, city, state, zip, null]);
            customer = { id: results.insertId, email, name: firstName + ' ' + lastName, phone: phoneNumber, address1: addressLine1, address2: addressLine2, city, state, zip };
        }

        // Assign the order to the customer
        const updateOrderCustomerQuery = 'UPDATE customer_order SET customer_id = ? WHERE id = ?';
        await queryDB(updateOrderCustomerQuery, [customer.id, orderID]);

        // Fetch order details from the database to calculate the total amount
        const orderDetails = await getOrderDetails(orderID);
        const subtotal = calculateSubtotal(orderDetails.items);
        const shipping = 0.00; // Example shipping cost
        const tax = subtotal * 0.08; // Example tax rate of 8%
        const total = subtotal + shipping + tax;

        // Create the Stripe charge
        const charge = await stripe.charges.create({
            amount: Math.round(total * 100), // Amount in cents
            currency: 'usd',
            description: `Order #${orderID}`,
            source: stripeToken,
            metadata: { orderID },
            receipt_email: email,
            shipping: {
                name: `${firstName} ${lastName}`,
                address: {
                    line1: addressLine1,
                    line2: addressLine2,
                    city: city,
                    state: state,
                    postal_code: zip,
                    country: 'US',
                },
                phone: phoneNumber,
            },
        });

        // Store the last 4 digits of the card
        const last4 = charge.payment_method_details.card.last4;
        await queryDB('UPDATE customer_order SET order_total = ?, stripe_order_id = ?, card_last4 = ?, order_status = ? WHERE id = ?',
            [total, charge.id, last4, 'submitted_paid', orderID]);

        // Fetch order items to pass to notifySTLGeneration
        const items = await getOrderItems(orderID);

        // Notify STL generation machines
        notifySTLGeneration(orderID, items);

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

async function getCustomerByEmail(email) {
    const query = 'SELECT * FROM customer WHERE email = ?';
    const results = await queryDB(query, [email]);
    return results[0];
}

async function getOrderItems(orderID) {
    const query = `
        SELECT oi.id as itemID, oi.item_price as itemPrice, oi.has_hangars as hanger,
               oii.image_filepath as imageFile, oi.item_id as itemTypeID
        FROM order_item oi
        LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id
        WHERE oi.order_id = ?
    `;
    const results = await queryDB(query, [orderID]);

    // Map item IDs to aspect ratios
    const aspectRatioMap = {
        5: '4x4',
        6: '4x4',
        7: '4x4',
        8: '4x6',
        9: '6x4'
    };

    // Group images by order item
    const items = results.reduce((acc, row) => {
        const existingItem = acc.find(item => item.itemID === row.itemID);
        if (existingItem) {
            existingItem.images.push({ imageFile: row.imageFile });
        } else {
            acc.push({
                itemID: row.itemID,
                itemPrice: row.itemPrice,
                aspectRatio: aspectRatioMap[row.itemTypeID] || 'unknown', // Fetch aspect ratio based on itemTypeID
                hanger: row.hanger,
                images: [{ imageFile: row.imageFile }],
                printed: false // Default to false if printed status is not in the database
            });
        }
        return acc;
    }, []);

    return items;
}


async function getOrderDetails(orderID) {
    const query = `
        SELECT co.*, c.name as customer_name, oi.id AS order_item_id, oi.item_price, 
               oii.image_filepath, oi.has_hangars
        FROM customer_order co
        LEFT JOIN customer c ON co.customer_id = c.id
        LEFT JOIN order_item oi ON co.id = oi.order_id
        LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id
        WHERE co.id = ?
    `;

    const results = await queryDB(query, [orderID]);

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
        card_last4: results[0].card_last4,
        customer: {
            name: results[0].customer_name,
            email: results[0].email,
            phone: results[0].phone,
            address1: results[0].address1,
            address2: results[0].address2,
            city: results[0].city,
            state: results[0].state,
            zip: results[0].zip
        },
        items: []
    };

    results.forEach(result => {
        order.items.push({
            itemID: result.order_item_id,
            itemPrice: result.item_price,
            photoSize: '4x6', // Example, adjust according to your data
            hanger: result.has_hangars,
            imageFile: result.image_filepath,
            printed: false // Add this flag if required
        });
    });

    order.subtotal = calculateSubtotal(order.items);
    order.shipping = 0; // Example shipping cost
    order.tax = order.subtotal * 0.075; // Example tax rate of 8%
    order.total = order.subtotal + order.shipping + order.tax;

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
        const customerDetailsResult = await queryDB(customerDetailsQuery, [orderDetails.customer_id]);
        const customerDetails = customerDetailsResult[0];

        res.render('order-confirmation', { orderDetails, customerDetails });
    } catch (error) {
        console.error('Error fetching order or customer details:', error);
        res.status(500).send('Server error');
    }
});

async function getCustomerDetails(customerID) {
    const query = 'SELECT * FROM customer WHERE id = ?';
    const results = await queryDB(query, [customerID]);
    if (results.length === 0) {
        return null;
    }
    return results[0];
}

app.get('/dashboard', basicAuth, async (req, res) => {
    try {
        const query = `
            SELECT co.id as orderID, c.name, co.order_date, co.order_status, co.order_total,
                   COUNT(oi.id) as pictureCount, 
                   CASE WHEN co.box_included THEN 'Y' ELSE 'N' END as boxIncluded
            FROM customer_order co
            LEFT JOIN customer c ON co.customer_id = c.id
            LEFT JOIN order_item oi ON co.id = oi.order_id
            GROUP BY co.id, c.name, co.order_date, co.order_status, co.order_total, co.box_included
            ORDER BY co.order_date DESC
        `;
        
        
        const results = await queryDB(query);
        
        
        res.render('dashboard', { orders: results });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).send('Server error');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/quote', (req, res) => {
    res.render('quote');
});

app.post('/quote', async (req, res) => {
    const { name, email, location, size, details } = req.body;

    try {
        // Save the lead to the database
        const sql = `INSERT INTO leads (name, email, location, size, details) VALUES (?, ?, ?, ?, ?)`;
        await queryDB(sql, [name, email, location, size, details]);

        // Optionally, send an email notification about the new lead
        // await sendEmailNotification({ name, email, location, size, details });

        res.send('Thank you for your request! We will get back to you soon.');
    } catch (error) {
        console.error('Error saving quote request:', error);
        res.status(500).send('An error occurred while processing your request.');
    }
});



app.get('/api/orders', async (req, res) => {
    const { filter, search } = req.query;
    let filterQuery = '';
    let searchQuery = '';

    if (filter) {
        filterQuery = 'WHERE co.order_status = ?';
    }

    if (search) {
        searchQuery = `AND (c.name LIKE ? OR co.id LIKE ?)`;
    }

    const query = `
        SELECT co.id as orderID, c.name, co.order_date, co.order_status, co.order_total,
               CASE WHEN co.box_included THEN 'Y' ELSE 'N' END as boxIncluded
        FROM customer_order co
        LEFT JOIN customer c ON co.customer_id = c.id
        ${filterQuery} ${searchQuery}
        GROUP BY co.id, c.name, co.order_date, co.order_status, co.order_total, co.box_included
        ORDER BY co.order_date DESC
    `;

    try {
        const params = [];
        if (filter) params.push(filter);
        if (search) {
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }
        const results = await queryDB(query, params);

        // Process results to calculate pictureCount and box inclusion
        const processedResults = await Promise.all(results.map(async order => {
            const itemsQuery = 'SELECT * FROM order_item WHERE order_id = ?';
            const items = await queryDB(itemsQuery, [order.orderID]);
            let pictureCount = 0;

            items.forEach(item => {
                if (item.item_id === 5) {
                    pictureCount += 5; // Lightbox
                } else if (item.item_id === 7) {
                    pictureCount += 2; // Double 4x4
                } else {
                    pictureCount += 1;
                }
            });

            return {
                ...order,
                pictureCount,
                boxIncluded: items.some(item => item.item_id === 5) ? 'Y' : order.boxIncluded
            };
        }));

        res.json(processedResults);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/order/:orderID', async (req, res) => {
    const { orderID } = req.params;

    try {
        const orderDetails = await getOrderDetails(orderID);
        if (!orderDetails) {
            console.log(`Order with ID ${orderID} not found`);
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json(orderDetails);
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/update-order-status', async (req, res) => {
    const { orderID, status } = req.body;

    try {
        const query = 'UPDATE customer_order SET order_status = ? WHERE id = ?';
        await queryDB(query, [status, orderID]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/order-status', async (req, res) => {
    const { orderID, status } = req.body;

    try {
        const updateOrderStatusQuery = 'UPDATE customer_order SET order_status = ? WHERE id = ?';
        await queryDB(updateOrderStatusQuery, [status, orderID]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/order-item-status', async (req, res) => {
    const { orderID, itemID, status, isChecked } = req.body;

    try {
        const updateOrderItemStatusQuery = 'UPDATE order_item SET item_status = ? WHERE order_id = ? AND id = ?';
        const newStatus = isChecked ? status : 'pending'; // Assuming 'pending' is the default status
        await queryDB(updateOrderItemStatusQuery, [newStatus, orderID, itemID]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating order item status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/resend-stl', async (req, res) => {
    const { orderID, itemID } = req.body;

    try {
        const query = `
            SELECT oi.id as order_item_id, oi.item_price, oii.image_filepath, oi.has_hangars, oi.item_id
            FROM order_item oi
            LEFT JOIN order_item_image oii ON oi.id = oii.order_item_id
            WHERE oi.order_id = ? AND oi.id = ?
        `;
        const results = await queryDB(query, [orderID, itemID]);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Item not found in order' });
        }

        const item = {
            itemID: results[0].order_item_id,
            itemPrice: results[0].item_price,
            hanger: results[0].has_hangars,
            images: results.map(result => ({ imageFile: result.image_filepath })),
            printed: false // Assuming the printed status is false for resend
        };

        // Determine the aspect ratio based on the item_id
        let aspectRatio;
        if (results[0].item_id === 5 || results[0].item_id === 6 || results[0].item_id === 7) {
            aspectRatio = '4x4';
        } else if (results[0].item_id === 8) {
            aspectRatio = '4x6';
        } else if (results[0].item_id === 9) {
            aspectRatio = '6x4';
        } else {
            throw new Error('Unsupported item_id for aspect ratio');
        }

        item.aspectRatio = aspectRatio;

        notifySTLGeneration(orderID, [item]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error resending STL request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


async function sendEmailNotification(lead) {
    let transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.NOTIFICATION_EMAIL,
        subject: 'New Quote Request',
        text: `You have a new quote request from ${lead.name} (${lead.email}).\n\nLocation: ${lead.location}\nSize: ${lead.size}\nDetails: ${lead.details}`
    };

    await transporter.sendMail(mailOptions);
}

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


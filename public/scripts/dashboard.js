document.addEventListener('DOMContentLoaded', () => {
    loadOrders('submitted_paid');

    document.getElementById('filter-incomplete').addEventListener('click', () => {
        loadOrders('submitted_pending');
    });

    document.getElementById('filter-paid').addEventListener('click', () => {
        loadOrders('submitted_paid');
    });

    document.getElementById('filter-processing').addEventListener('click', () => {
        loadOrders('processing');
    });

    document.getElementById('filter-completed').addEventListener('click', () => {
        loadOrders('completed_pending');
    });

    document.getElementById('filter-shipped').addEventListener('click', () => {
        loadOrders('completed_shipped');
    });

    document.getElementById('filter-delivered').addEventListener('click', () => {
        loadOrders('completed_delivered');
    });

    document.getElementById('search').addEventListener('input', (event) => {
        loadOrders(null, event.target.value);
    });
});

function loadOrders(filter = null, search = '') {
    fetch(`/api/orders?filter=${filter}&search=${search}`)
        .then(response => response.json())
        .then(orders => {
            console.log('Fetched orders:', orders);
            const ordersTable = document.getElementById('orders');
            ordersTable.innerHTML = '';
            orders.forEach(order => {
                const orderRow = document.createElement('tr');
                orderRow.innerHTML = `
                    <td>${order.name}</td>
                    <td>${order.orderID}</td>
                    <td>${order.order_total}</td>
                    <td>${order.order_status}</td>
                    <td>${order.pictureCount}</td>
                    <td>${order.boxIncluded}</td>
                    <td>${order.order_status}</td>
                `;
                orderRow.addEventListener('click', () => {
                    toggleOrderDetails(order.orderID);
                });
                ordersTable.appendChild(orderRow);
            });
        })
        .catch(error => {
            console.error('Error fetching orders:', error);
        });
}

function toggleOrderDetails(orderID) {
    const orderDetailsRow = document.getElementById(`order-details-${orderID}`);
    if (orderDetailsRow) {
        orderDetailsRow.style.display = orderDetailsRow.style.display === 'none' ? 'table-row' : 'none';
    } else {
        fetch(`/api/order/${orderID}`)
            .then(response => response.json())
            .then(order => {
                const orderDetailsRow = document.createElement('tr');
                orderDetailsRow.id = `order-details-${orderID}`;
                orderDetailsRow.innerHTML = `
                    <td colspan="7">
                        <div class="order-details">
                            <div class="items">
                                ${order.items ? order.items.map(item => `
                                    <div class="item">
                                        <img src="/finalized-uploads/${item.image_filepath}" alt="Image">
                                        <p>Photo Size: ${item.photoSize}</p>
                                        <p>Hanger: ${item.hasHangars ? 'Y' : 'N'}</p>
                                        <button onclick="resendSTL(${orderID}, ${item.order_item_id})">Resend STL</button>
                                        <a href="/finalized-uploads/${item.image_filepath}" target="_blank">View Final Image</a>
                                    </div>
                                `).join('') : 'No items found.'}
                            </div>
                            <label>
                                <input type="checkbox" onchange="updateOrderStatus(${orderID}, 'completed_pending', this.checked)"> Order Complete
                            </label>
                            <label>
                                <input type="checkbox" onchange="updateOrderStatus(${orderID}, 'completed_delivered', this.checked)"> Order Picked Up
                            </label>
                        </div>
                    </td>
                `;
                const ordersTable = document.getElementById('orders');
                ordersTable.appendChild(orderDetailsRow);
            })
            .catch(error => {
                console.error('Error fetching order details:', error);
            });
    }
}

function resendSTL(orderID, itemID) {
    fetch(`/api/resend-stl`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderID, itemID })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('STL generation request sent successfully');
        } else {
            alert('Failed to send STL generation request');
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function updateOrderStatus(orderID, status, isChecked) {
    if (isChecked) {
        fetch(`/api/order-status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orderID, status })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(`Order status updated to ${status}`);
            } else {
                alert('Failed to update order status');
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
    }
}







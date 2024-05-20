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

    document.getElementById('filter-pending').addEventListener('click', () => {
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
                    <td>${order.paymentStatus}</td>
                    <td>${order.pictureCount}</td>
                    <td>${order.boxIncluded}</td>
                    <td>${order.order_status}</td>
                `;
                orderRow.addEventListener('click', () => {
                    toggleOrderDetails(order.orderID);
                });
                ordersTable.appendChild(orderRow);

                const detailsRow = document.createElement('tr');
                detailsRow.classList.add('order-details');
                detailsRow.style.display = 'none';
                detailsRow.innerHTML = `
                    <td colspan="7">
                        <div id="order-details-${order.orderID}">Loading...</div>
                    </td>
                `;
                ordersTable.appendChild(detailsRow);
            });
        })
        .catch(error => {
            console.error('Error fetching orders:', error);
        });
}

function toggleOrderDetails(orderID) {
    const detailsRow = document.querySelector(`#order-details-${orderID}`).parentElement.parentElement;
    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = '';
        loadOrderDetails(orderID);
    } else {
        detailsRow.style.display = 'none';
    }
}

function loadOrderDetails(orderID) {
    fetch(`/api/order/${orderID}`)
        .then(response => response.json())
        .then(order => {
            console.log('Fetched order details:', order);
            const orderDetailsDiv = document.getElementById(`order-details-${orderID}`);
            if (order.items && Array.isArray(order.items)) {
                orderDetailsDiv.innerHTML = order.items.map(item => `
                    <div class="item">
                        <h4>Photo Size: ${item.photoSize}</h4>
                        <p>Hanger: ${item.hanger ? 'Y' : 'N'}</p>
                        <button onclick="resendSTL(${order.id}, ${item.itemID})">Resend STL</button>
                        <a href="/finalized-uploads/${item.imageFile}" target="_blank">View Finalized Image</a>
                        <label>
                            <input type="checkbox" ${item.printed ? 'checked' : ''} onclick="togglePrinted(${order.id}, ${item.itemID}, this.checked)"> Printed
                        </label>
                    </div>
                `).join('');
            } else {
                orderDetailsDiv.innerHTML = '<p>No items found for this order.</p>';
            }
        })
        .catch(error => {
            console.error('Error fetching order details:', error);
        });
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

function togglePrinted(orderID, itemID, printed) {
    fetch(`/api/toggle-printed`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderID, itemID, printed })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Printed status updated successfully');
        } else {
            alert('Failed to update printed status');
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

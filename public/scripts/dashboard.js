document.addEventListener('DOMContentLoaded', () => {
    loadOrders();

    document.getElementById('filter-incomplete').addEventListener('click', () => {
        loadOrders('incomplete');
    });

    document.getElementById('search').addEventListener('input', (event) => {
        loadOrders(null, event.target.value);
    });
});

function loadOrders(filter = null, search = '') {
    fetch(`/api/orders?filter=${filter}&search=${search}`)
        .then(response => response.json())
        .then(orders => {
            const ordersTable = document.getElementById('orders');
            ordersTable.innerHTML = '';
            orders.forEach(order => {
                const orderRow = document.createElement('tr');
                orderRow.innerHTML = `
                    <td>${order.name}</td>
                    <td>${order.orderNumber}</td>
                    <td>${order.orderTotal}</td>
                    <td>${order.paymentStatus}</td>
                    <td>${order.pictureCount}</td>
                    <td>${order.boxIncluded ? 'Y' : 'N'}</td>
                    <td>${order.orderStatus}</td>
                `;
                orderRow.addEventListener('click', () => {
                    loadOrderDetails(order.orderID);
                });
                ordersTable.appendChild(orderRow);
            });
        });
}

function loadOrderDetails(orderID) {
    fetch(`/api/order/${orderID}`)
        .then(response => response.json())
        .then(order => {
            const itemDetailsDiv = document.getElementById('item-details');
            itemDetailsDiv.innerHTML = `
                <h3>${order.name} ${order.orderNumber}</h3>
                ${order.items.map(item => `
                    <div class="item">
                        <h4>Photo Size: ${item.photoSize}</h4>
                        <p>Hanger: ${item.hanger ? 'Y' : 'N'}</p>
                        <button onclick="resendSTL(${order.orderID}, ${item.itemID})">Resend STL</button>
                    </div>
                `).join('')}
            `;
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

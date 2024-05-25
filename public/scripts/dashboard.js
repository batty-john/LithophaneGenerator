document.addEventListener('DOMContentLoaded', () => {
    const filterButtons = document.querySelectorAll('.filters button');
    const searchInput = document.getElementById('search');
    const ordersTableBody = document.getElementById('orders');
    let openDetailsRow = null;

    const orderStatuses = [
        'submitted_pending',
        'submitted_paid',
        'processing',
        'completed_pending',
        'completed_shipped',
        'completed_delivered'
    ];

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterOrders(button.id.replace('filter-', ''));
        });
    });

    searchInput.addEventListener('input', () => {
        filterOrders(searchInput.value);
    });

    fetchOrders();

    function fetchOrders() {
        console.log('Fetching orders...');
        fetch('/api/orders')
            .then(response => response.json())
            .then(data => {
                console.log('Orders fetched:', data);
                renderOrders(data);
                attachEventListeners();
            })
            .catch(error => console.error('Error fetching orders:', error));
    }

    function renderOrders(orders) {
        ordersTableBody.innerHTML = '';
        orders.forEach(order => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${order.name}</td>
                <td>${order.orderID}</td>
                <td>$${order.order_total || '0.00'}</td>
                <td>${order.pictureCount}</td>
                <td>${order.boxIncluded}</td>
                <td>${order.order_status}</td>
            `;
            row.setAttribute('data-order-id', order.orderID);
            row.setAttribute('data-order-status', order.order_status);
            ordersTableBody.appendChild(row);

            const detailsRow = document.createElement('tr');
            const detailsCell = document.createElement('td');
            detailsCell.colSpan = 6; // Update colSpan to match the new column count
            detailsCell.classList.add('order-details');
            detailsRow.appendChild(detailsCell);
            ordersTableBody.appendChild(detailsRow);
        });
    }

    function filterOrders(criteria) {
        console.log('Filtering orders with criteria:', criteria);

        // Close any open order details when filtering
        if (openDetailsRow) {
            const openDetailsCell = openDetailsRow.querySelector('.order-details');
            openDetailsCell.classList.remove('visible');
            openDetailsCell.innerHTML = '';
            openDetailsRow = null;
        }

        const rows = ordersTableBody.querySelectorAll('tr');
        rows.forEach(row => {
            if (row.querySelector('.order-details')) return;
            const orderStatus = row.getAttribute('data-order-status');
            if (criteria === '' || orderStatus === criteria || row.textContent.toLowerCase().includes(criteria.toLowerCase())) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
        attachEventListeners();
    }

    function toggleOrderDetails(row, orderID) {
        console.log('Toggling order details for order ID:', orderID);
        const detailsRow = row.nextElementSibling;
        const detailsCell = detailsRow.querySelector('.order-details');

        if (detailsCell.classList.contains('visible')) {
            console.log('Closing order details for order ID:', orderID);
            detailsCell.classList.remove('visible');
            detailsCell.innerHTML = '';
            openDetailsRow = null;
        } else {
            if (openDetailsRow) {
                console.log('Closing previously open order details');
                const openDetailsCell = openDetailsRow.querySelector('.order-details');
                openDetailsCell.classList.remove('visible');
                openDetailsCell.innerHTML = '';
            }

            console.log('Fetching details for order ID:', orderID);
            fetch(`/api/order/${orderID}`)
                .then(response => response.json())
                .then(data => {
                    console.log('Fetched order details:', data);
                    renderOrderDetails(detailsCell, data);
                    detailsCell.classList.add('visible');
                    openDetailsRow = detailsRow;
                })
                .catch(error => console.error('Error fetching order details:', error));
        }
    }

    function renderOrderDetails(detailsCell, order) {
        detailsCell.innerHTML = `
            <h3>Order ID: ${order.id}</h3>
            <p>Name: ${order.customer.name}</p>
            <p>Email: ${order.customer.email}</p>
            <p>Phone: ${order.customer.phone}</p>
            <p>Address 1: ${order.customer.address1}</p>
            <p>Address 2: ${order.customer.address2}</p>
            <p>City: ${order.customer.city}</p>
            <p>State: ${order.customer.state}</p>
            <p>Zip: ${order.customer.zip}</p>
            <p>Order Total: $${order.subtotal}</p>
            <p>Order Status: 
                <select class="status-dropdown" name="order-status" data-order-id="${order.id}">
                    ${orderStatuses.map(status => `<option value="${status}" ${order.order_status === status ? 'selected' : ''}>${status.replace('_', ' ')}</option>`).join('')}
                </select>
            </p>
            <button class="close-details">Close</button>
            <div class="items">
                ${order.items.map(item => `
                    <div class="item">
                        <p>Photo Size: ${item.photoSize}</p>
                        <p>Hanger: ${item.hanger ? 'Yes' : 'No'}</p>
                        <p>Image File: ${item.imageFile}</p>
                        <p>Printed: ${item.printed ? 'Yes' : 'No'}</p>
                        <button class="resend-stl" data-order-id="${order.id}" data-item-id="${item.itemID}">Resend STL</button>
                    </div>
                `).join('')}
            </div>
        `;

        detailsCell.querySelector('.close-details').addEventListener('click', () => {
            console.log('Closing order details via button');
            detailsCell.classList.remove('visible');
            detailsCell.innerHTML = '';
            openDetailsRow = null;
        });

        detailsCell.querySelectorAll('.status-dropdown').forEach(dropdown => {
            dropdown.addEventListener('change', updateOrderStatus);
        });

        detailsCell.querySelectorAll('.resend-stl').forEach(button => {
            button.addEventListener('click', resendSTL);
        });
    }

    function resendSTL(event) {
        const button = event.target;
        const orderID = button.getAttribute('data-order-id');
        const itemID = button.getAttribute('data-item-id');

        console.log('Resending STL for order ID:', orderID, 'item ID:', itemID);

        fetch('/api/resend-stl', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orderID, itemID })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('STL resend successfully');
                    alert('STL resend successfully');
                } else {
                    console.log('Error resending STL');
                    alert('Error resending STL');
                }
            })
            .catch(error => console.error('Error resending STL:', error));
    }

    function updateOrderStatus(event) {
        const dropdown = event.target;
        const orderID = dropdown.getAttribute('data-order-id');
        const status = dropdown.value;

        console.log('Updating order status:', { orderID, status });

        fetch('/api/update-order-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orderID, status })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Order status updated successfully');
                    alert('Order status updated successfully');
                    fetchOrders();
                } else {
                    console.log('Error updating order status');
                    alert('Error updating order status');
                }
            })
            .catch(error => console.error('Error updating order status:', error));
    }

    function attachEventListeners() {
        console.log('Attaching event listeners to order rows');
        const rows = ordersTableBody.querySelectorAll('tr:not(.order-details)');
        rows.forEach(row => {
            const orderID = row.getAttribute('data-order-id');
            if (orderID) {
                row.removeEventListener('click', rowClickHandler);
                row.addEventListener('click', rowClickHandler);
            }
        });
    }

    function rowClickHandler(event) {
        const row = event.currentTarget;
        const orderID = row.getAttribute('data-order-id');
        if (!event.target.matches('.status-dropdown') && !event.target.matches('.close-details')) {
            console.log('Order row clicked:', orderID);
            toggleOrderDetails(row, orderID);
        }
    }

    attachEventListeners();
});




















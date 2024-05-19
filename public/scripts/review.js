document.addEventListener('DOMContentLoaded', () => {
    const confirmButton = document.querySelector('.complete');
    const orderID = '<%= orderId %>';

    confirmButton.addEventListener('click', processImages);

    function processImages() {
        const images = document.querySelectorAll('.image-container img');
        const promises = Array.from(images).map((img, index) => {
            return new Promise((resolve, reject) => {
                const brightness = document.getElementById(`brightness-${img.dataset.orderItemId}-${img.dataset.index}`).value;
                const contrast = document.getElementById(`contrast-${img.dataset.orderItemId}-${img.dataset.index}`).value;

                fetch(`/process-image`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        filename: img.dataset.filename,
                        brightness: brightness / 100, // Adjust to Jimp scale
                        contrast: contrast / 100, // Adjust to Jimp scale
                        orderItemId: img.dataset.orderItemId
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        resolve();
                    } else {
                        reject(data.error);
                    }
                })
                .catch(reject);
            });
        });

        Promise.all(promises)
            .then(() => {
                window.location.href = `/checkout?orderID=${orderID}`;
            })
            .catch(error => {
                console.error('Error processing images:', error);
            });
    }
});



document.addEventListener('DOMContentLoaded', () => {
    const uploadPhotoInput = document.getElementById('uploadPhoto');
    const cropperContainer = document.getElementById('cropper-container');
    const aspectRatioSelect = document.getElementById('aspectRatioSelect');
    const hangarsToggle = document.getElementById('hangarsToggle');
    const processAndUploadNextButton = document.getElementById('processAndUploadNext');
    const processAndCheckoutButton = document.getElementById('processAndCheckout');
    const thumbnailSection = document.querySelector('.thumbnail-section');
    const loadingIndicator = document.createElement('div');

    let cropper;
    let imagesData = [];
    let currentImageIndex = 0;
    const maxImages = bundle === 'lightbox' ? 5 : 1;

    loadingIndicator.id = 'loadingIndicator';
    loadingIndicator.innerText = 'Processing... Please wait.';
    loadingIndicator.style.display = 'none';
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.padding = '20px';
    loadingIndicator.style.backgroundColor = '#fff';
    loadingIndicator.style.border = '1px solid #ccc';
    loadingIndicator.style.zIndex = '1000';
    document.body.appendChild(loadingIndicator);

    console.log('Initial setup:');
    console.log('Bundle:', bundle);
    console.log('Max Images:', maxImages);

    uploadPhotoInput.addEventListener('change', handleFileUpload);
    aspectRatioSelect.addEventListener('change', updateAspectRatio);
    processAndUploadNextButton.addEventListener('click', processAndUploadNext);
    processAndCheckoutButton.addEventListener('click', processAndProceedToCheckout);

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                cropperContainer.innerHTML = `<img id="cropperImage" src="${e.target.result}">`;
                const imageElement = document.getElementById('cropperImage');
                cropper = new Cropper(imageElement, {
                    aspectRatio: getAspectRatio(),
                    viewMode: 1,
                    scalable: true,
                    zoomable: true,
                    movable: true,
                    responsive: true,
                });
                console.log('File uploaded and Cropper initialized.');
            };
            reader.readAsDataURL(file);
        }
    }

    function getAspectRatio() {
        const aspectRatioMap = {
            '4x4': 1,
            '4x6': 2 / 3,
            '6x4': 3 / 2
        };
        return aspectRatioMap[aspectRatioSelect.value];
    }

    function updateAspectRatio() {
        if (cropper) {
            cropper.setAspectRatio(getAspectRatio());
            console.log('Aspect ratio updated:', aspectRatioSelect.value);
        }
    }

    function processAndUploadNext() {
        if (cropper) {
            const canvas = cropper.getCroppedCanvas();
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result;
                    imagesData.push({
                        src: dataUrl,
                        aspectRatio: aspectRatioSelect.value,
                        hangars: hangarsToggle.value
                    });
                    if (bundle === 'individual') {
                        addThumbnail(currentImageIndex, dataUrl);
                        currentImageIndex++;
                    } else {
                        updateThumbnail(currentImageIndex, dataUrl);
                        currentImageIndex++;
                    }
                    console.log('Image processed and uploaded:', dataUrl);
                    clearCropper();
                    checkMaxImages();
                };
                reader.readAsDataURL(blob);
            });
        }
    }

    function processAndProceedToCheckout() {
        loadingIndicator.style.display = 'block';
        const orderData = {
            images: imagesData
        };
        console.log('Order data to be sent:', orderData);
        fetch('/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        })
        .then(response => response.json())
        .then(data => {
            loadingIndicator.style.display = 'none';
            window.location.href = `/review?orderID=${data.orderID}`;
        })
        .catch(error => {
            loadingIndicator.style.display = 'none';
            console.error('Error:', error);
        });
    }

    function updateThumbnail(index, src) {
        const thumbnail = document.getElementById(`thumb${index + 1}`);
        if (thumbnail) {
            thumbnail.style.backgroundImage = `url(${src})`;
            console.log('Thumbnail updated:', { index, src });
        }
    }

    function addThumbnail(index, src) {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'thumbnail';
        thumbnail.id = `thumb${index + 1}`;
        thumbnail.style.backgroundImage = `url(${src})`;
        thumbnailSection.appendChild(thumbnail);
        console.log('Thumbnail added:', { index, src });
    }

    function clearCropper() {
        uploadPhotoInput.value = '';
        cropperContainer.innerHTML = '';
        cropper = null;
        console.log('Cropper cleared.');
    }

    function checkMaxImages() {
        console.log('Checking max images:', { currentImageIndex, maxImages });
        if (bundle === 'lightbox' && currentImageIndex >= maxImages) {
            processAndUploadNextButton.style.display = 'none';
            processAndCheckoutButton.style.display = 'block';
            processAndCheckoutButton.disabled = false;
            console.log('Lightbox bundle: Showing "Process and Proceed to Checkout" button.');
        } else if (bundle === 'individual' && currentImageIndex >= maxImages) {
            processAndUploadNextButton.style.display = 'block';
            processAndCheckoutButton.style.display = 'block';
            processAndCheckoutButton.disabled = false;
            console.log('Individual bundle: Showing both buttons.');
        } else {
            processAndUploadNextButton.style.display = 'block';
            processAndCheckoutButton.style.display = 'none';
            console.log('Default: Showing "Process and Upload Next" button.');
        }
    }

    processAndCheckoutButton.disabled = true;
    checkMaxImages();
});


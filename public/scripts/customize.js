document.addEventListener('DOMContentLoaded', () => {
    const uploadPhotoInput = document.getElementById('uploadPhoto');
    const cropperContainer = document.getElementById('cropper-container');
    const aspectRatioSelect = document.getElementById('aspectRatioSelect');
    const hangarsToggle = document.getElementById('hangarsToggle');
    const processAndUploadNextButton = document.getElementById('processAndUploadNext');
    const processAndCheckoutButton = document.getElementById('processAndCheckout');
    const thumbnailSection = document.querySelector('.thumbnail-section');

    let cropper;
    let imagesData = [];
    let currentImageIndex = 0;
    let maxImages = bundle === 'lightbox' ? 5 : 1;

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
                        maxImages++;
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
        if (bundle === 'lightbox' && currentImageIndex < maxImages - 1) {
            processAndUploadNext();
        } else {
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
                window.location.href = `/review?orderID=${data.orderID}`;
            })
            .catch(error => console.error('Error:', error));
        }
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
        if (bundle === 'lightbox' && currentImageIndex >= maxImages - 1) {
            processAndUploadNextButton.style.display = 'none';
            processAndCheckoutButton.style.display = 'block';
            console.log('Lightbox bundle: Showing "Process and Proceed to Checkout" button.');
        } else if (bundle === 'individual' && currentImageIndex >= maxImages - 1) {
            processAndUploadNextButton.style.display = 'block';
            processAndCheckoutButton.style.display = 'block';
            console.log('Individual bundle: Showing both buttons.');
        } else {
            processAndUploadNextButton.style.display = 'block';
            processAndCheckoutButton.style.display = 'none';
            console.log('Default: Showing "Process and Upload Next" button.');
        }
    }

    checkMaxImages();
});


let imageSettings = {};  
let cropper = null;  
let currentActiveImageId = null;  
let currentAspectRatio = 1;  
let currentZoomLevel = 0;  
let currentRotationDegree = 0;  
let currentCropperX = 0;  
let currentCropperY = 0;  
let processImages = {};  
let allImagesProcessed = false;
let uploadedFiles = []; 

document.addEventListener('DOMContentLoaded', function() {
    const packageType = new URLSearchParams(window.location.search).get('package');
    const fileInput = document.getElementById('file-input');
    const uploadButton = document.getElementById('upload-btn');
    const instructions = document.getElementById('instructions');
    const contrastSlider = document.getElementById('contrast-slider');
    const brightnessSlider = document.getElementById('brightness-slider');

    if (packageType === 'lightbox') {
        instructions.textContent = 'Please upload exactly 5 images for the Lightbox Bundle.';
    } else {
        instructions.textContent = 'Please upload your images:';
    }

    contrastSlider.addEventListener('input', function() {
        updateFilters();
        saveImageSettings();
    });

    brightnessSlider.addEventListener('input', function() {
        updateFilters();
        saveImageSettings();
    });

    uploadButton.addEventListener('click', function() {
        fileInput.click(); 
    });

    fileInput.addEventListener('change', function(event) {
        if (event.target.files.length > 0) {
            addImage(Array.from(event.target.files)); 
        }
    });

    document.querySelectorAll('[data-aspect-ratio]').forEach(button => {
        button.addEventListener('click', function() {
            const aspectRatio = parseFloat(this.dataset.aspectRatio);
            updateAspectRatio(aspectRatio);
            saveImageSettings(currentActiveImageId); 
            updateActiveButton(this.id); 
        });
    });

    document.getElementById('hangers').addEventListener('change', updateHangers);
    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('rotate-left').addEventListener('click', rotateLeft);
    document.getElementById('rotate-right').addEventListener('click', rotateRight);
    document.getElementById('move-left').addEventListener('click', moveLeft);
    document.getElementById('move-right').addEventListener('click', moveRight);
    document.getElementById('move-up').addEventListener('click', moveUp);
    document.getElementById('move-down').addEventListener('click', moveDown);
    document.getElementById('process-btn').addEventListener('click', processCurrentImage);
    document.getElementById('proceed-btn').addEventListener('click', proceedToCheckout);
});

function addImage(files) {
    const uploadedImagesContainer = document.getElementById('uploaded-images');

    files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageId = `img-${Date.now()}-${index}`;
            uploadedFiles.push(file); 
            const div = document.createElement('div');
            div.className = 'image-container';
            div.id = imageId;
            div.innerHTML = `<img class="thumb" src="${e.target.result}" alt="${escape(file.name)}">
                             <button class="remove-btn" onclick="removeImage('${imageId}')">Remove</button>`;
            div.addEventListener('click', () => {
                setActiveImage(imageId);
            });
            uploadedImagesContainer.appendChild(div);
        };
        reader.readAsDataURL(file);
    });

    if (uploadedFiles.length === 1) {
        setActiveImage(`img-${Date.now()}-0`); 
    }
}

function removeImage(imageId) {
    const imageElement = document.getElementById(imageId);
    if (!imageElement) {
        console.error("Image element not found.");
        return;
    }

    const imageIndex = uploadedFiles.findIndex((item, idx) => 
        `img-${Date.now()}-${idx}` === imageId);
    if (imageIndex !== -1) {
        uploadedFiles.splice(imageIndex, 1); 
    }

    imageElement.parentNode.removeChild(imageElement);

    if (imageElement.classList.contains('active')) {
        const remainingImages = document.querySelectorAll('.image-container');
        if (remainingImages.length > 0) {
            setActiveImage(remainingImages[0].id); 
        }
    }
}

function setActiveImage(imageId) {
    currentActiveImageId = imageId;

    document.querySelectorAll('.image-container').forEach(container => {
        container.classList.remove('active');
    });

    const selectedImageContainer = document.getElementById(imageId);
    if (!selectedImageContainer) {
        console.error("Selected image container not found.");
        return;
    }
    selectedImageContainer.classList.add('active');

    const imageElement = selectedImageContainer.querySelector('img');
    if (!imageElement) {
        console.error("No image found in the selected container.");
        return;
    }

    createCropperInstance(imageElement, getImageSettings(imageId));
}

function createCropperInstance(imageElement, settings) {
    const imageEditingSection = document.getElementById('image-editing');
    loadImageSettings(currentActiveImageId);

    imageEditingSection.innerHTML = '';
    const newImageElement = document.createElement('img');
    newImageElement.src = imageElement.src;
    imageEditingSection.appendChild(newImageElement);
    document.getElementById('image-to-edit').style.display = 'block';
    document.getElementById('cropper-controls').style.display = 'block';
    document.getElementById('sliders').style.display = 'block';
    document.getElementById('size-toggle').style.display = 'block';
    document.getElementById('hanger-toggle').style.display = 'block';
    document.getElementById('process-btn').style.display = 'block';

    if (cropper) {
        cropper.destroy();
    }

    cropper = new Cropper(newImageElement, {
        aspectRatio: settings.aspectRatio || 1,
        viewMode: 1,
        dragMode: 'crop',
        autoCropArea: 1,
        restore: false,
        guides: false,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        zoomOnWheel: false,
        ready: function() {
            if (settings.cropData) {
                cropper.setCropBoxData(settings.cropData.cropBoxData);
                cropper.setCanvasData(settings.cropData.canvasData);
            }
            if (settings.zoom) {
                currentZoomLevel = settings.zoom;
            }
            cropper.zoomTo(currentZoomLevel);
            if (settings.rotation) {
                currentRotationDegree = settings.rotation;
            }
            cropper.rotateTo(settings.rotation);
            updateFilters();
            updateActiveButtonByAspectRatio(settings.aspectRatio);
            cropper.move(currentCropperX, currentCropperY);
        },
        cropend: function() {
            saveImageSettings();
        }
    });
}

function getImageSettings(imageId) {
    return imageSettings[imageId] || {
        contrast: 100,
        brightness: 100,
        aspectRatio: 1,
        hangers: false,
        cropData: {
            cropBoxData: null,
            canvasData: null
        }
    };
}

function loadImageSettings(imageId) {
    const settings = getImageSettings(imageId);
    if (settings) {
        const contrastSlider = document.getElementById('contrast-slider');
        const brightnessSlider = document.getElementById('brightness-slider');

        contrastSlider.value = settings.contrast;
        brightnessSlider.value = settings.brightness;
        updateFilters();

        if (cropper) {
            if (settings.cropData) {
                cropper.setCropBoxData(settings.cropData.cropBoxData);
                cropper.setCanvasData(settings.cropData.canvasData);
            }
            cropper.setAspectRatio(settings.aspectRatio || 1);
            currentZoomLevel = settings.zoom || 0;
            cropper.zoomTo(currentZoomLevel);
            currentRotationDegree = settings.rotation || 0;
            cropper.rotateTo(currentRotationDegree);
            currentCropperX = settings.x || 0;
            currentCropperY = settings.y || 0;
            cropper.move(currentCropperX, currentCropperY);
        }

        const hangerCheckbox = document.getElementById('hangers');
        hangerCheckbox.checked = settings.hangers;
    } else {
        const contrastSlider = document.getElementById('contrast-slider');
        const brightnessSlider = document.getElementById('brightness-slider');
        contrastSlider.value = 100;
        brightnessSlider.value = 100;
        updateFilters();
        if (cropper) {
            cropper.setAspectRatio(1);
            cropper.reset();
        }
    }
}

function saveImageSettings() {
    const imageId = currentActiveImageId;
    if (!imageId || !cropper) {
        console.error("No active image ID or cropper instance available to save settings.");
        return;
    }

    const cropBoxData = cropper.getCropBoxData();
    const canvasData = cropper.getCanvasData();

    imageSettings[imageId] = {
        contrast: parseInt(document.getElementById('contrast-slider').value),
        brightness: parseInt(document.getElementById('brightness-slider').value),
        aspectRatio: cropper.options.aspectRatio,
        hangers: document.getElementById('hangers').checked,
        cropData: {
            cropBoxData: cropBoxData,
            canvasData: canvasData
        },
        zoom: currentZoomLevel,
        rotation: currentRotationDegree,
        x: currentCropperX,
        y: currentCropperY
    };

    console.log("Settings saved for image:", imageId, imageSettings[imageId]);
}

function updateFilters() {
    const imageElement = document.querySelector('.cropper-view-box img');
    const canvasElement = document.querySelector('.cropper-canvas');

    if (imageElement && canvasElement) {
        const contrast = (document.getElementById('contrast-slider').value - 100) / 100;
        const brightness = (document.getElementById('brightness-slider').value - 100) / 100;
        imageElement.style.filter = `contrast(${1 + contrast}) brightness(${1 + brightness}) grayscale(100%)`;
        canvasElement.style.filter = `contrast(${1 + contrast}) brightness(${1 + brightness}) grayscale(100%)`;
    } else {
        console.error("Unable to find image elements for applying filters.");
    }
}

function updateAspectRatio(aspectRatio) {
    if (cropper) {
        cropper.setAspectRatio(parseFloat(aspectRatio));
    }
}

function updateHangers() {
    const hangersCheckbox = document.getElementById('hangers');
    const isHangersEnabled = hangersCheckbox.checked;

    if (currentActiveImageId && imageSettings[currentActiveImageId]) {
        imageSettings[currentActiveImageId].hangers = isHangersEnabled;
        console.log("Hangers setting updated for image:", currentActiveImageId, isHangersEnabled);
    } else {
        console.error("No active image or settings found to update hangers.");
    }
    saveImageSettings();
}

async function processImage(imageId) {
    console.log(`Processing image ${imageId}...`);
    return new Promise((resolve, reject) => {
        const canvas = cropper.getCroppedCanvas();
        if (!canvas) {
            reject(`Failed to get cropped canvas for image ${imageId}.`);
            return;
        }
        canvas.toBlob((blob) => {
            if (blob) {
                processImages[imageId] = blob;
                console.log(`Image ${imageId} processed.`);
                resolve();
            } else {
                reject(`Failed to create blob for image ${imageId}.`);
            }
        }, 'image/jpeg');
    });
}

function proceedToCheckout() {
    console.log("Preparing to submit processed images to server...");
    const formData = new FormData();

    Object.keys(processImages).forEach((imageId, index) => {
        const imageBlob = processImages[imageId];
        const imageName = `image${index}.jpeg`;
        formData.append('images', imageBlob, imageName);

        const settings = imageSettings[imageId];
        formData.append(`brightness_${index}`, settings.brightness);
        formData.append(`contrast_${index}`, settings.contrast);
        formData.append(`hangers_${index}`, settings.hangers);
        formData.append(`aspectRatio_${index}`, settings.aspectRatio);
        formData.append(`item_id_${index}`, settings.item_id);
    });

    fetch('/api/upload-images', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Server responded with ' + response.status);
        }
        return response.json();
    })
    .then(data => {
        console.log("Images uploaded successfully:", data);
        window.location.href = `/review?order_id=${data.order_id}`;
    })
    .catch(error => {
        console.error("Failed to upload images:", error);
    });
}

function processCurrentImage() {
    console.log("Processing current image...");
    const imageId = currentActiveImageId;
    if (!imageId) {
        console.error("No image is currently selected for processing.");
        return;
    }

    const imageContainer = document.getElementById(imageId);
    if (!imageContainer) {
        console.error("Failed to find the container for the active image.");
        return;
    }

    const canvas = cropper.getCroppedCanvas();
    if (canvas) {
        canvas.toBlob((blob) => {
            processImages[imageId] = blob;
            console.log(`Image ${imageId} processed successfully.`);
            imageSettings[imageId].processed = true;
            addProcessedIndicator(imageContainer);
            checkAllImagesProcessed();
        }, 'image/jpeg');
    } else {
        console.error("Failed to get cropped canvas.");
    }
}

function checkAllImagesProcessed() {
    allImagesProcessed = Object.values(imageSettings).every(setting => setting.processed);
    const proceedButton = document.getElementById('proceed-btn');
    if (allImagesProcessed) {
        proceedButton.disabled = false;
        proceedButton.classList.add('enabled');
        proceedButton.textContent = 'Proceed to Checkout';
    } else {
        proceedButton.disabled = true;
        proceedButton.classList.remove('enabled');
        proceedButton.textContent = 'Process all images to proceed to checkout';
    }
}

function addProcessedIndicator(imageContainer) {
    if (!imageContainer.querySelector('.processed-indicator')) {
        const checkmark = document.createElement('span');
        checkmark.className = 'processed-indicator';
        checkmark.innerHTML = '&#10003;';
        checkmark.style.color = 'green';
        checkmark.style.fontSize = '24px';
        checkmark.style.position = 'absolute';
        checkmark.style.top = '5px';
        checkmark.style.right = '5px';
        imageContainer.appendChild(checkmark);
    }
}

function updateActiveButtonByAspectRatio(aspectRatio) {
    document.querySelectorAll('[data-aspect-ratio]').forEach(button => {
        if (parseFloat(button.dataset.aspectRatio) === aspectRatio) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

function updateActiveButton(activeButtonId) {
    document.querySelectorAll('[data-aspect-ratio]').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(activeButtonId).classList.add('active');
}

function zoomIn() {
    if (cropper) {
        cropper.zoom(0.1);
        currentZoomLevel += 0.1;
        saveImageSettings();
    }
}

function zoomOut() {
    if (cropper) {
        cropper.zoom(-0.1);
        currentZoomLevel -= 0.1;
        saveImageSettings();
    }
}

function rotateLeft() {
    if (cropper) {
        cropper.rotate(-45);
        currentRotationDegree -= 45;
        saveImageSettings();
    }
}

function rotateRight() {
    if (cropper) {
        cropper.rotate(45);
        currentRotationDegree += 45;
        saveImageSettings();
    }
}

function moveLeft() {
    if (cropper) {
        cropper.move(-10, 0);
        currentCropperX -= 10;
        saveImageSettings();
    }
}

function moveRight() {
    if (cropper) {
        cropper.move(10, 0);
        currentCropperX += 10;
        saveImageSettings();
    }
}

function moveUp() {
    if (cropper) {
        cropper.move(0, -10);
        currentCropperY -= 10;
        saveImageSettings();
    }
}

function moveDown() {
    if (cropper) {
        cropper.move(0, 10);
        currentCropperY += 10;
        saveImageSettings();
    }
}
